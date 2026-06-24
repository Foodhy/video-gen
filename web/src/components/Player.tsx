import { useEffect, useRef } from "react";
import {
  useEditor,
  placeTrack,
  placeCaptions,
  captionAt,
  locate,
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
  const total = timelineDuration(segments);
  const loadedClip = useRef<string | null>(null);

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
    v.muted = !!hit.seg.muted; // honor per-segment mute
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

  // React to scrubbing while paused.
  useEffect(() => {
    if (!playing) syncToTimeline(playhead, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playhead, segments.length]);

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
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  const hasContent = placed.length > 0;

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
        {hasContent ? (
          <>
            <video ref={videoRef} playsInline />
            {fade < 1 && (
              <div className="fade-overlay" style={{ opacity: 1 - fade }} />
            )}
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
            <div className="sub label">Import media to begin</div>
          </div>
        )}
      </div>
      <div className="player-bar">
        <button
          className="transport"
          onClick={() => setPlaying(!playing)}
          disabled={!hasContent}
          title="Play / Pause (space)"
        >
          {playing ? "❚❚" : "►"}
        </button>
        <span className="tc">
          <span className="cur">{tc(playhead)}</span> / {tc(total)}
        </span>
      </div>
    </section>
  );
}
