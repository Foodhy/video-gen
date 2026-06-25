import { useEffect, useRef, useState } from "react";
import {
  useEditor,
  placeTrack,
  placeCaptions,
  captionAt,
  locate,
  fxToCss,
  overlayPosAt,
  timelineDuration,
  type PlacedSegment,
} from "../state/editor.ts";
import { tc } from "../lib/format.ts";
import { logger } from "../lib/logger.ts";
import MasterMeter from "./MasterMeter.tsx";
import { registerElement, resume as resumeAudio } from "../lib/audioGraph.ts";

export default function Player() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const [monitor, setMonitor] = useState(false);
  // When the monitor is on, route the player's media into the Web Audio graph.
  useEffect(() => {
    if (!monitor) return;
    registerElement(videoRef.current);
    registerElement(audioElRef.current);
    resumeAudio();
  }, [monitor]);
  function toggleFullscreen() {
    const el = sectionRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else el.requestFullscreen().catch(() => {});
  }
  const segments = useEditor((s) => s.segments);
  const assets = useEditor((s) => s.assets);
  const playhead = useEditor((s) => s.playhead);
  const playing = useEditor((s) => s.playing);
  const setPlayhead = useEditor((s) => s.setPlayhead);
  const setPlaying = useEditor((s) => s.setPlaying);

  const previewAssetId = useEditor((s) => s.previewAssetId);
  const previewAutoplay = useEditor((s) => s.previewAutoplay);
  const playerNonce = useEditor((s) => s.playerNonce);
  const setPreview = useEditor((s) => s.setPreview);
  const previewAsset = previewAssetId ? assets[previewAssetId] : null;
  const texts = useEditor((s) => s.texts);
  const selectedTextId = useEditor((s) => s.selectedTextId);
  const updateText = useEditor((s) => s.updateText);
  const selectText = useEditor((s) => s.selectText);
  const record = useEditor((s) => s.record);
  const captions = useEditor((s) => s.captions);
  const showCaptions = useEditor((s) => s.showCaptions);
  const captionSplitMode = useEditor((s) => s.captionSplitMode);
  const splitCaptionByWords = useEditor((s) => s.splitCaptionByWords);
  const trackHidden = useEditor((s) => s.trackHidden);
  const trackMuted = useEditor((s) => s.trackMuted);
  const placed = placeTrack(segments, "video");
  const overlayPlaced = placeTrack(segments, "overlay");
  const audioPlaced = placeTrack(segments, "audio");
  const total = timelineDuration(segments);
  const loadedClip = useRef<string | null>(null);
  const overlayRef = useRef<HTMLVideoElement>(null);
  const loadedOverlay = useRef<string | null>(null);
  const activeOverlay = locate(overlayPlaced, playhead);
  const audioElRef = useRef<HTMLAudioElement>(null);
  const loadedAudio = useRef<string | null>(null);
  const hasAudioTrack = audioPlaced.length > 0;

  const placedCaps = placeCaptions(segments, captions);
  const activeCap = showCaptions ? captionAt(placedCaps, playhead) : null;

  // Fade factor (0..1) for a segment at timeline time t — drives video dimming + audio gain.
  function fadeFactor(seg: PlacedSegment, t: number): number {
    const p = t - seg.start;
    let f = 1;
    if (seg.fadeIn && p < seg.fadeIn) f = Math.min(f, p / seg.fadeIn);
    const rem = seg.dur - p;
    if (seg.fadeOut && rem < seg.fadeOut) f = Math.min(f, rem / seg.fadeOut);
    return Math.max(0, Math.min(1, f));
  }
  const activeHit = locate(placed, playhead);
  // Strict: is there actually a video clip under the playhead? In gaps / past the
  // end there isn't — hide the base video so the black stage shows (no stale frame).
  const videoVisible =
    !trackHidden.video &&
    placed.some((p) => p.dur > 0 && playhead >= p.start && playhead < p.start + p.dur);
  const fade = activeHit ? fadeFactor(activeHit.seg, playhead) : 1;

  // Text overlays visible at the playhead (plus the selected one, for editing).
  const visibleTexts = texts.filter(
    (t) => (playhead >= t.start && playhead < t.end) || t.id === selectedTextId,
  );
  const textDrag = useRef<{ id: string } | null>(null);
  function onTextDown(e: React.PointerEvent, id: string) {
    e.stopPropagation();
    selectText(id);
    record();
    textDrag.current = { id };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onTextMove(e: React.PointerEvent, id: string) {
    if (textDrag.current?.id !== id) return;
    const st = stageRef.current?.getBoundingClientRect();
    if (!st) return;
    updateText(id, {
      x: Math.max(0, Math.min(1, (e.clientX - st.left) / st.width)),
      y: Math.max(0, Math.min(1, (e.clientY - st.top) / st.height)),
    });
  }
  function onTextUp() {
    textDrag.current = null;
  }

  // Keep the <video> element pointed at the active segment's source + time.
  function syncToTimeline(t: number, forceSeek: boolean) {
    const v = videoRef.current;
    if (!v) return;
    const hit = locate(placed, t);
    if (!hit) {
      if (!v.paused) v.pause(); // in a gap — hold
      return;
    }
    const asset = assets[hit.seg.clipId];
    if (!asset) return;
    // If an A1 track exists, it OWNS the audio: the base video stays muted
    // everywhere (so once A1 ends → silence, no embedded video sound leaks).
    const a1Off = !!trackMuted.audio || !!trackHidden.audio;
    const hasA1 = !a1Off && useEditor.getState().segments.some((x) => x.track === "audio");
    const live = useEditor.getState().segments.find((x) => x.id === hit.seg.id) ?? hit.seg; // live gain while playing
    v.muted = !!live.muted || hasA1 || !!trackMuted.video;
    v.volume = Math.min(1, fadeFactor(hit.seg, t) * (live.volume ?? 1)); // fade × gain (preview caps at 1)
    v.playbackRate = hit.seg.speed ?? 1;
    if (loadedClip.current !== asset.id) {
      loadedClip.current = asset.id;
      v.src = asset.mediaUrl;
      v.load();
      const onMeta = () => {
        v.currentTime = hit.srcTime;
        if (playing) v.play().catch(() => {});
        v.removeEventListener("loadedmetadata", onMeta);
      };
      v.addEventListener("loadedmetadata", onMeta);
      return;
    }
    if ((forceSeek || playing) && Math.abs(v.currentTime - hit.srcTime) > 0.3) {
      v.currentTime = hit.srcTime;
    }
    if (playing && v.paused && !v.ended) v.play().catch(() => {});
  }

  // Keep the overlay <video> synced to the overlay track (muted PiP layer).
  function syncOverlay(t: number, forceSeek: boolean) {
    const v = overlayRef.current;
    if (!v) return;
    const hit = locate(overlayPlaced, t);
    if (!hit) {
      if (!v.paused) v.pause();
      loadedOverlay.current = null;
      return;
    }
    const asset = assets[hit.seg.clipId];
    if (!asset) return;
    v.playbackRate = hit.seg.speed ?? 1;
    if (loadedOverlay.current !== asset.id) {
      loadedOverlay.current = asset.id;
      v.src = asset.mediaUrl;
      v.muted = true;
      v.load();
      const onMeta = () => {
        v.currentTime = hit.srcTime;
        if (playing) v.play().catch(() => {});
        v.removeEventListener("loadedmetadata", onMeta);
      };
      v.addEventListener("loadedmetadata", onMeta);
      return;
    }
    if ((forceSeek || playing) && Math.abs(v.currentTime - hit.srcTime) > 0.3) v.currentTime = hit.srcTime;
    if (playing && v.paused && !v.ended) v.play().catch(() => {});
  }

  // Keep the A1 audio <audio> element synced to the audio track.
  function syncAudio(t: number, forceSeek: boolean) {
    const a = audioElRef.current;
    if (!a) return;
    const hit = locate(audioPlaced, t);
    if (!hit) {
      if (!a.paused) a.pause();
      loadedAudio.current = null;
      return;
    }
    const asset = assets[hit.seg.clipId];
    if (!asset) return;
    // Past the end of the audio media — stop (don't let the element loop/replay).
    if (hit.srcTime >= (asset.duration || Infinity) - 0.03) {
      if (!a.paused) a.pause();
      return;
    }
    a.playbackRate = hit.seg.speed ?? 1;
    const a1Off = !!trackMuted.audio || !!trackHidden.audio;
    const live = useEditor.getState().segments.find((x) => x.id === hit.seg.id) ?? hit.seg; // live gain
    a.volume = a1Off ? 0 : Math.min(1, fadeFactor(hit.seg, t) * (live.muted ? 0 : live.volume ?? 1));
    if (loadedAudio.current !== asset.id) {
      loadedAudio.current = asset.id;
      a.src = asset.mediaUrl;
      a.load();
      const onMeta = () => {
        a.currentTime = hit.srcTime;
        if (playing) a.play().catch(() => {});
        a.removeEventListener("loadedmetadata", onMeta);
      };
      a.addEventListener("loadedmetadata", onMeta);
      return;
    }
    if ((forceSeek || playing) && Math.abs(a.currentTime - hit.srcTime) > 0.3) a.currentTime = hit.srcTime;
    if (playing && a.paused && !a.ended) a.play().catch(() => {});
  }

  // React to scrubbing while paused.
  useEffect(() => {
    if (!playing) {
      syncToTimeline(playhead, true);
      syncOverlay(playhead, true);
      syncAudio(playhead, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playhead, segments.length]);

  // Recover the player when leaving a preview (the base <video> remounts and its
  // "loaded clip" cache would otherwise be stale -> black frame). Also triggered
  // by the Settings "Recover player" action. Logs the active media reference.
  useEffect(() => {
    loadedClip.current = null;
    loadedOverlay.current = null;
    loadedAudio.current = null;
    const id = requestAnimationFrame(() => {
      const t = useEditor.getState().playhead;
      const hit = locate(placed, t);
      const ref = hit ? assets[hit.seg.clipId]?.mediaUrl : null;
      logger.info("player", "Player reloaded media", ref ?? "(no clip at playhead)");
      syncToTimeline(t, true);
      syncOverlay(t, true);
      syncAudio(t, true);
    });
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewAssetId, playerNonce]);

  // Unified clock-driven playback. The wall clock advances the playhead; media
  // elements are slaved to it. Works with gaps, audio-only timelines, and lets
  // you seek while playing (the loop just reads the new playhead next frame).
  useEffect(() => {
    if (!playing) {
      videoRef.current?.pause();
      overlayRef.current?.pause();
      audioElRef.current?.pause();
      return;
    }
    if (monitor) {
      registerElement(videoRef.current);
      registerElement(audioElRef.current);
      resumeAudio();
    }
    let raf = 0;
    let last = performance.now();
    // align media to current playhead immediately
    syncToTimeline(useEditor.getState().playhead, true);
    syncOverlay(useEditor.getState().playhead, true);
    syncAudio(useEditor.getState().playhead, true);
    const tick = () => {
      const now = performance.now();
      const t = useEditor.getState().playhead + (now - last) / 1000;
      last = now;
      if (total > 0 && t >= total) {
        setPlayhead(total);
        setPlaying(false);
        return;
      }
      setPlayhead(t);
      syncToTimeline(t, false);
      syncOverlay(t, false);
      syncAudio(t, false);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  const hasVideo = placed.length > 0;
  const hasContent = hasVideo || audioPlaced.length > 0 || overlayPlaced.length > 0;

  // Transport helpers.
  const seekTo = (t: number) => setPlayhead(Math.max(0, Math.min(t, total)));

  return (
    <section className="panel player" ref={sectionRef}>
      <div className="panel-head">
        <span className="label">Player — Preview</span>
        <span style={{ flex: 1 }} />
        <span className="mono" style={{ fontSize: 10, color: "var(--text-muted)" }}>
          {assets[locate(placed, playhead)?.seg.clipId ?? ""]?.width ?? "—"}×
          {assets[locate(placed, playhead)?.seg.clipId ?? ""]?.height ?? "—"}
        </span>
        <button
          className={"transport" + (monitor ? " on" : "")}
          style={{ marginLeft: 10 }}
          onClick={() => setMonitor((m) => !m)}
          title="Master audio monitor (levels + mono/stereo) — does not affect export"
        >
          🎚
        </button>
        <button
          className="transport"
          onClick={toggleFullscreen}
          title="Fullscreen player (see it bigger)"
        >
          ⛶
        </button>
      </div>
      <div className="player-stage" ref={stageRef}>
        {previewAsset ? (
          <div className="preview-layer">
            <div className="preview-bar">
              <span className="label">Preview — {previewAsset.name}</span>
              <button className="clog-btn" onClick={() => setPreview(null)}>
                ✕ close
              </button>
            </div>
            {previewAsset.kind === "audio" ? (
              <div className="preview-audio">
                <span style={{ fontSize: 48, color: "var(--text-muted)" }}>♪</span>
                <audio src={previewAsset.mediaUrl} controls autoPlay={previewAutoplay} />
              </div>
            ) : (
              <video src={previewAsset.mediaUrl} controls autoPlay={previewAutoplay} className="preview-video" />
            )}
          </div>
        ) : hasVideo ? (
          <>
            <video
              ref={videoRef}
              playsInline
              style={{ filter: fxToCss(activeHit?.seg.fx), visibility: videoVisible ? "visible" : "hidden" }}
            />
            <video
              ref={overlayRef}
              playsInline
              muted
              className="overlay-video"
              style={{
                display: activeOverlay && !trackHidden.overlay ? "block" : "none",
                left: (activeOverlay ? overlayPosAt(activeOverlay.seg, playhead).x : 0.5) * 100 + "%",
                top: (activeOverlay ? overlayPosAt(activeOverlay.seg, playhead).y : 0.5) * 100 + "%",
                width: (activeOverlay?.seg.oscale ?? 0.4) * 100 + "%",
              }}
            />
            {fade < 1 && <div className="fade-overlay" style={{ opacity: 1 - fade }} />}
            {visibleTexts.map((t) => (
              <div
                key={t.id}
                className={"text-ov" + (t.id === selectedTextId ? " sel" : "")}
                style={{
                  left: t.x * 100 + "%",
                  top: t.y * 100 + "%",
                  fontSize: (t.size / 1080) * 100 + "cqh",
                  color: t.color,
                }}
                onPointerDown={(e) => onTextDown(e, t.id)}
                onPointerMove={(e) => onTextMove(e, t.id)}
                onPointerUp={onTextUp}
              >
                {t.text || " "}
              </div>
            ))}
            {activeCap &&
              (captionSplitMode ? (
                <div className="subtitle split-mode" title="Click ✂ between words to split">
                  {activeCap.text
                    .trim()
                    .split(/\s+/)
                    .filter(Boolean)
                    .map((w, i, arr) => (
                      <span key={i}>
                        <span className="cap-word">{w}</span>
                        {i < arr.length - 1 && (
                          <span
                            className="cap-gap"
                            onClick={() => splitCaptionByWords(activeCap.clipId, activeCap.id, i + 1)}
                          >
                            ✂
                          </span>
                        )}
                      </span>
                    ))}
                </div>
              ) : (
                <div className="subtitle">{activeCap.text}</div>
              ))}
          </>
        ) : (
          <div className="player-empty">
            <div className="big chrome">VIDEO—GEN</div>
            <div className="sub label">
              {hasContent ? "Audio-only timeline" : "Import media to begin"}
            </div>
          </div>
        )}
        {hasAudioTrack && <audio ref={audioElRef} style={{ display: "none" }} />}
        {monitor && <MasterMeter onClose={() => setMonitor(false)} />}
      </div>
      <div className="player-bar">
        <button className="transport" onClick={() => seekTo(0)} disabled={!hasContent} title="Go to start (Home)">
          |◀
        </button>
        <button className="transport" onClick={() => seekTo(playhead - 5)} disabled={!hasContent} title="Back 5s">
          ◀◀
        </button>
        <button
          className="transport play"
          onClick={() => setPlaying(!playing)}
          disabled={!hasContent}
          title="Play / Pause (space)"
        >
          {playing ? "❚❚" : "▶"}
        </button>
        <button className="transport" onClick={() => seekTo(playhead + 5)} disabled={!hasContent} title="Forward 5s">
          ▶▶
        </button>
        <button className="transport" onClick={() => seekTo(total)} disabled={!hasContent} title="Go to end (End)">
          ▶|
        </button>
        <span className="tc">
          <span className="cur">{tc(playhead)}</span> / {tc(total)}
        </span>
      </div>
    </section>
  );
}
