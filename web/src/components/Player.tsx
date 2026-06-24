import { useEffect, useRef } from "react";
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

export default function Player() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const segments = useEditor((s) => s.segments);
  const assets = useEditor((s) => s.assets);
  const playhead = useEditor((s) => s.playhead);
  const playing = useEditor((s) => s.playing);
  const setPlayhead = useEditor((s) => s.setPlayhead);
  const setPlaying = useEditor((s) => s.setPlaying);

  const texts = useEditor((s) => s.texts);
  const selectedTextId = useEditor((s) => s.selectedTextId);
  const updateText = useEditor((s) => s.updateText);
  const selectText = useEditor((s) => s.selectText);
  const record = useEditor((s) => s.record);
  const captions = useEditor((s) => s.captions);
  const showCaptions = useEditor((s) => s.showCaptions);
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
    if (!hit) return;
    const asset = assets[hit.seg.clipId];
    if (!asset) return;
    // When the A1 audio track covers this time, it provides the sound → mute base.
    const a1Here = !!locate(audioPlaced, t);
    v.muted = !!hit.seg.muted || a1Here;
    v.volume = fadeFactor(hit.seg, t); // audio fade in/out
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
    if (forceSeek && Math.abs(v.currentTime - hit.srcTime) > 0.25) {
      v.currentTime = hit.srcTime;
    }
  }

  // Keep the overlay <video> synced to the overlay track (muted PiP layer).
  function syncOverlay(t: number, forceSeek: boolean) {
    const v = overlayRef.current;
    if (!v) return;
    const hit = locate(overlayPlaced, t);
    if (!hit) {
      loadedOverlay.current = null;
      return;
    }
    const asset = assets[hit.seg.clipId];
    if (!asset) return;
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
    if (forceSeek && Math.abs(v.currentTime - hit.srcTime) > 0.25) v.currentTime = hit.srcTime;
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
    a.volume = fadeFactor(hit.seg, t) * (hit.seg.muted ? 0 : 1);
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
    if (forceSeek && Math.abs(a.currentTime - hit.srcTime) > 0.25) a.currentTime = hit.srcTime;
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

  // Play/pause the A1 audio alongside the base.
  useEffect(() => {
    const a = audioElRef.current;
    if (!a) return;
    if (playing) {
      syncAudio(useEditor.getState().playhead, true);
      if (locate(audioPlaced, useEditor.getState().playhead)) a.play().catch(() => {});
    } else a.pause();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  // Play/pause the overlay alongside the base.
  useEffect(() => {
    const v = overlayRef.current;
    if (!v) return;
    if (playing) {
      syncOverlay(useEditor.getState().playhead, true);
      if (activeOverlay) v.play().catch(() => {});
    } else v.pause();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  // Playback loop: read element time -> advance timeline; hop across segments.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (!playing) {
      v.pause();
      return;
    }
    syncToTimeline(useEditor.getState().playhead, true);
    v.play().catch(() => {});
    let raf = 0;
    const tick = () => {
      const cur = useEditor.getState().playhead;
      const hit = locate(placed, cur);
      if (hit) {
        const tlTime = hit.seg.start + (v.currentTime - hit.seg.in);
        if (v.currentTime >= hit.seg.out - 0.03) {
          // advance to next segment
          const next: PlacedSegment | undefined = placed.find(
            (p) => p.start > hit.seg.start + 0.001,
          );
          if (next) {
            setPlayhead(next.start + 0.001);
            loadedClip.current = null;
            syncToTimeline(next.start + 0.001, true);
          } else {
            setPlaying(false);
            setPlayhead(total);
            return;
          }
        } else {
          v.volume = fadeFactor(hit.seg, tlTime);
          setPlayhead(tlTime);
          syncOverlay(tlTime, false);
          const ov = overlayRef.current;
          if (ov) {
            if (locate(overlayPlaced, tlTime)) {
              if (ov.paused) ov.play().catch(() => {});
            } else if (!ov.paused) ov.pause();
          }
          syncAudio(tlTime, false);
          const au = audioElRef.current;
          if (au) {
            if (locate(audioPlaced, tlTime)) {
              if (au.paused) au.play().catch(() => {});
            } else if (!au.paused) au.pause();
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  // Clock-driven playback for timelines with no video track (audio/overlay only).
  useEffect(() => {
    if (!playing || placed.length > 0) return; // video-driven loop handles the rest
    if (audioPlaced.length === 0 && overlayPlaced.length === 0) return;
    let raf = 0;
    let last = performance.now();
    const step = () => {
      const now = performance.now();
      const t = useEditor.getState().playhead + (now - last) / 1000;
      last = now;
      if (t >= total) {
        setPlaying(false);
        setPlayhead(total);
        return;
      }
      setPlayhead(t);
      syncAudio(t, false);
      syncOverlay(t, false);
      const au = audioElRef.current;
      if (au && locate(audioPlaced, t) && au.paused) au.play().catch(() => {});
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  const hasVideo = placed.length > 0;
  const hasContent = hasVideo || audioPlaced.length > 0 || overlayPlaced.length > 0;

  // Transport helpers.
  const seekTo = (t: number) => setPlayhead(Math.max(0, Math.min(t, total)));

  return (
    <section className="panel player">
      <div className="panel-head">
        <span className="label">Player — Preview</span>
        <span className="mono" style={{ fontSize: 10, color: "var(--text-muted)" }}>
          {assets[locate(placed, playhead)?.seg.clipId ?? ""]?.width ?? "—"}×
          {assets[locate(placed, playhead)?.seg.clipId ?? ""]?.height ?? "—"}
        </span>
      </div>
      <div className="player-stage" ref={stageRef}>
        {hasVideo ? (
          <>
            <video ref={videoRef} playsInline style={{ filter: fxToCss(activeHit?.seg.fx) }} />
            <video
              ref={overlayRef}
              playsInline
              muted
              className="overlay-video"
              style={{
                display: activeOverlay ? "block" : "none",
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
            {activeCap && <div className="subtitle">{activeCap.text}</div>}
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
      </div>
      <div className="player-bar">
        <button className="transport" onClick={() => seekTo(0)} disabled={!hasContent} title="Go to start (Home)">
          ⏮
        </button>
        <button className="transport" onClick={() => seekTo(playhead - 5)} disabled={!hasContent} title="Back 5s">
          ⏪
        </button>
        <button
          className="transport"
          onClick={() => setPlaying(!playing)}
          disabled={!hasContent}
          title="Play / Pause (space)"
        >
          {playing ? "❚❚" : "►"}
        </button>
        <button className="transport" onClick={() => seekTo(playhead + 5)} disabled={!hasContent} title="Forward 5s">
          ⏩
        </button>
        <button className="transport" onClick={() => seekTo(total)} disabled={!hasContent} title="Go to end (End)">
          ⏭
        </button>
        <span className="tc">
          <span className="cur">{tc(playhead)}</span> / {tc(total)}
        </span>
      </div>
    </section>
  );
}
