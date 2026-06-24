import { useRef, useState } from "react";
import {
  useEditor,
  timelineDuration,
  placeCaptions,
  placeTrack,
  buildSnapPoints,
  snapValue,
  type PlacedSegment,
} from "../../state/editor.ts";
import { tc } from "../../lib/format.ts";
import { separateAudio, extractAudioRange } from "../../lib/api.ts";
import { logger } from "../../lib/logger.ts";
import Track from "./Track.tsx";
import ContextMenu, { type MenuItem } from "../ContextMenu.tsx";

export default function Timeline() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const segments = useEditor((s) => s.segments);
  const captions = useEditor((s) => s.captions);
  const texts = useEditor((s) => s.texts);
  const selectedTextId = useEditor((s) => s.selectedTextId);
  const selectText = useEditor((s) => s.selectText);
  const setPlayheadRaw = useEditor((s) => s.setPlayhead);
  const setSelection = useEditor((s) => s.setSelection);
  const pxPerSec = useEditor((s) => s.pxPerSec);
  const playhead = useEditor((s) => s.playhead);
  const selSeg = useEditor((s) => s.selectedSegmentId);
  const selCount = useEditor((s) => s.selectedIds.length);
  const setPlayhead = useEditor((s) => s.setPlayhead);
  const setZoom = useEditor((s) => s.setZoom);
  const splitAtPlayhead = useEditor((s) => s.splitAtPlayhead);
  const deleteSelected = useEditor((s) => s.deleteSelected);
  const deleteSegment = useEditor((s) => s.deleteSegment);
  const duplicateSegment = useEditor((s) => s.duplicateSegment);
  const toggleMute = useEditor((s) => s.toggleMute);
  const setFade = useEditor((s) => s.setFade);
  const setXfade = useEditor((s) => s.setXfade);
  const setFx = useEditor((s) => s.setFx);
  const clearFx = useEditor((s) => s.clearFx);
  const moveSegmentBefore = useEditor((s) => s.moveSegmentBefore);
  const sendToTrack = useEditor((s) => s.sendToTrack);
  const snapEnabled = useEditor((s) => s.snapEnabled);
  const toggleSnap = useEditor((s) => s.toggleSnap);
  const snapPoints = buildSnapPoints(segments, texts);

  function reorder(id: string, dropCenterSec: number) {
    const seg = segments.find((x) => x.id === id);
    if (!seg) return;
    const others = placeTrack(segments, seg.track).filter((p) => p.id !== id);
    const before = others.find((o) => o.start + o.dur / 2 > dropCenterSec);
    moveSegmentBefore(id, before?.id ?? null);
  }
  const projectId = useEditor((s) => s.projectId);
  const assets = useEditor((s) => s.assets);
  const addAsset = useEditor((s) => s.addAsset);
  const addSegmentForAsset = useEditor((s) => s.addSegmentForAsset);
  const showToast = useEditor((s) => s.showToast);

  const [menu, setMenu] = useState<{ x: number; y: number; seg: PlacedSegment } | null>(null);
  // Marquee rubber-band selection (client coords).
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const marqueeMoved = useRef(false);

  function onInnerPointerDown(e: React.PointerEvent) {
    // Only start a marquee on empty timeline background (clips stop propagation).
    if (e.button !== 0) return;
    const el = e.target as HTMLElement;
    if (el.closest(".seg")) return;
    marqueeMoved.current = false;
    setMarquee({ x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY });
  }
  function onInnerPointerMove(e: React.PointerEvent) {
    if (!marquee) return;
    if (Math.abs(e.clientX - marquee.x0) > 3 || Math.abs(e.clientY - marquee.y0) > 3)
      marqueeMoved.current = true;
    setMarquee({ ...marquee, x1: e.clientX, y1: e.clientY });
  }
  function onInnerPointerUp(e: React.PointerEvent) {
    if (!marquee) return;
    if (marqueeMoved.current && scrollRef.current) {
      const L = Math.min(marquee.x0, e.clientX);
      const R = Math.max(marquee.x0, e.clientX);
      const T = Math.min(marquee.y0, e.clientY);
      const B = Math.max(marquee.y0, e.clientY);
      const ids: string[] = [];
      scrollRef.current.querySelectorAll<HTMLElement>("[data-segid]").forEach((node) => {
        const r = node.getBoundingClientRect();
        const hit = r.left < R && r.right > L && r.top < B && r.bottom > T;
        if (hit) ids.push(node.dataset.segid!);
      });
      setSelection(ids);
    } else {
      seek(e); // treat as a plain click → move playhead
    }
    setMarquee(null);
  }

  const total = timelineDuration(segments);
  const contentW = Math.max(total * pxPerSec + 200, 800);
  const placedCaps = placeCaptions(segments, captions);

  // pick a "nice" ruler interval so ticks are ~80px apart
  const targetPx = 90;
  const rawSec = targetPx / pxPerSec;
  const steps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
  const stepSec = steps.find((s) => s >= rawSec) ?? 600;
  const tickCount = Math.ceil(total / stepSec) + 4;

  function seek(e: React.MouseEvent) {
    const el = scrollRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left + el.scrollLeft;
    let t = Math.max(0, x / pxPerSec);
    if (snapEnabled) t = snapValue(t, snapPoints, 8 / pxPerSec);
    setPlayhead(t);
  }

  function jumpEdit(dir: -1 | 1) {
    const cur = playhead;
    const sorted = snapPoints;
    const next =
      dir > 0
        ? sorted.find((p) => p > cur + 1e-4)
        : [...sorted].reverse().find((p) => p < cur - 1e-4);
    if (next !== undefined) setPlayhead(next);
  }

  async function extractSection(seg: PlacedSegment) {
    if (!projectId) return;
    try {
      logger.info("audio", `Extracting audio ${seg.in.toFixed(1)}–${seg.out.toFixed(1)}s…`, seg.clipId);
      const res = await extractAudioRange(projectId, seg.clipId, seg.in, seg.out, "m4a");
      logger.success("audio", "Section audio extracted", res.name);
      showToast("Audio extracted — downloading");
      const a = document.createElement("a");
      a.href = res.file;
      a.download = res.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e: any) {
      logger.error("audio", "Extract failed", e?.message ?? String(e));
      showToast(e.message ?? "extract failed", true);
    }
  }

  async function separateAudioFor(clipId: string) {
    if (!projectId) return;
    try {
      logger.info("audio", "Separating audio…", clipId);
      const res = await separateAudio(projectId, clipId);
      addAsset({ ...res.clip, mediaUrl: res.mediaUrl, thumbs: [] });
      addSegmentForAsset(res.clip.id);
      logger.success("audio", "Audio track created", res.clip.name);
      showToast("Audio track created");
    } catch (e: any) {
      logger.error("audio", "Separate audio failed", e?.message ?? String(e));
      showToast(e.message ?? "separate failed", true);
    }
  }

  function menuItems(seg: PlacedSegment): MenuItem[] {
    const asset = assets[seg.clipId];
    const insideThis = playhead > seg.start + 0.02 && playhead < seg.start + seg.dur - 0.02;
    const vids = placeTrack(segments, "video");
    const vIdx = vids.findIndex((p) => p.id === seg.id);
    const hasNext = seg.track === "video" && vIdx >= 0 && vIdx < vids.length - 1;
    const items: MenuItem[] = [
      {
        label: "Split here",
        hint: "S",
        disabled: seg.track !== "video" || !insideThis,
        onClick: () => splitAtPlayhead(),
      },
      { label: "Duplicate", onClick: () => duplicateSegment(seg.id) },
      {
        label: seg.muted ? "Unmute audio" : "Mute this section",
        onClick: () => toggleMute(seg.id),
      },
      { separator: true, label: "" },
      {
        label: "Fade in — 0.5s",
        hint: "↗",
        onClick: () => setFade(seg.id, { fadeIn: 0.5 }),
      },
      {
        label: "Fade out — 0.5s",
        hint: "↘",
        onClick: () => setFade(seg.id, { fadeOut: 0.5 }),
      },
      {
        label: "Fade in + out — 0.5s",
        onClick: () => setFade(seg.id, { fadeIn: 0.5, fadeOut: 0.5 }),
      },
      {
        label: "Clear fades",
        disabled: !seg.fadeIn && !seg.fadeOut,
        onClick: () => setFade(seg.id, { fadeIn: 0, fadeOut: 0 }),
      },
      { separator: true, label: "" },
      {
        label: seg.xfadeAfter ? "Crossfade next — clear" : "Crossfade with next — 0.5s",
        hint: "⤬",
        disabled: !hasNext,
        onClick: () => setXfade(seg.id, seg.xfadeAfter ? 0 : 0.5),
      },
      { separator: true, label: "" },
      {
        label: seg.fx?.grayscale ? "Color (undo B&W)" : "Black & white",
        onClick: () => setFx(seg.id, { grayscale: !seg.fx?.grayscale }),
      },
      {
        label: "Clear effects",
        disabled: !seg.fx,
        onClick: () => clearFx(seg.id),
      },
      { separator: true, label: "" },
      {
        label: seg.track === "overlay" ? "Send to main track (V1)" : "Send to overlay (V2 / PiP)",
        disabled: seg.track === "audio",
        onClick: () => sendToTrack(seg.id, seg.track === "overlay" ? "video" : "overlay"),
      },
      { separator: true, label: "" },
      {
        label: "Separate audio → track",
        disabled: seg.track !== "video" || !asset?.hasAudio,
        onClick: () => separateAudioFor(seg.clipId),
      },
      {
        label: "Extract section audio → file",
        hint: ".m4a",
        disabled: !asset?.hasAudio,
        onClick: () => extractSection(seg),
      },
      { separator: true, label: "" },
      { label: "Delete", hint: "⌫", danger: true, onClick: () => deleteSegment(seg.id) },
    ];
    return items;
  }

  return (
    <section className="timeline">
      <div className="tl-toolbar">
        <button className="tl-btn" onClick={splitAtPlayhead} title="Split at playhead (S)">
          ✂ Split
        </button>
        <button
          className="tl-btn"
          onClick={deleteSelected}
          disabled={!selSeg && selCount === 0}
          title="Delete selected (⌫)"
        >
          🗑 Delete{selCount > 1 ? ` (${selCount})` : ""}
        </button>
        <button className="tl-btn" onClick={() => jumpEdit(-1)} title="Previous edit (,)">
          ⟸
        </button>
        <button className="tl-btn" onClick={() => jumpEdit(1)} title="Next edit (.)">
          ⟹
        </button>
        <button
          className={"tl-btn" + (snapEnabled ? " on" : "")}
          onClick={toggleSnap}
          title="Snap to edges (magnet)"
        >
          🧲 Snap
        </button>
        <span className="tc" style={{ marginLeft: 6 }}>
          {tc(playhead)}
        </span>
        <div className="tl-zoom">
          <span className="label">Zoom</span>
          <input
            type="range"
            min={10}
            max={300}
            value={pxPerSec}
            onChange={(e) => setZoom(Number(e.target.value))}
          />
        </div>
      </div>

      <div className="tl-scroll" ref={scrollRef}>
        <div
          className="tl-inner"
          style={{ width: contentW }}
          onPointerDown={onInnerPointerDown}
          onPointerMove={onInnerPointerMove}
          onPointerUp={onInnerPointerUp}
        >
          <div className="tl-ruler" style={{ width: contentW }}>
            {Array.from({ length: tickCount }, (_, i) => {
              const t = i * stepSec;
              return (
                <div key={i} className="tl-tick" style={{ left: t * pxPerSec }}>
                  {tc(t).slice(3)}
                </div>
              );
            })}
          </div>

          <Track
            kind="overlay"
            onClipContext={(seg, x, y) => setMenu({ x, y, seg })}
            onReorder={reorder}
            snapPoints={snapPoints}
          />
          <Track
            kind="video"
            onClipContext={(seg, x, y) => setMenu({ x, y, seg })}
            onReorder={reorder}
            snapPoints={snapPoints}
          />
          <Track
            kind="audio"
            onClipContext={(seg, x, y) => setMenu({ x, y, seg })}
            onReorder={reorder}
            snapPoints={snapPoints}
          />

          {placedCaps.length > 0 && (
            <div className="tl-track caption">
              <span className="tl-track-label">C1 — Captions</span>
              {placedCaps.map((c) => (
                <div
                  key={c.id}
                  className="seg caption-seg"
                  style={{ left: c.tStart * pxPerSec, width: Math.max(2, (c.tEnd - c.tStart) * pxPerSec) }}
                  title={c.text}
                >
                  <span className="cap-text">{c.text}</span>
                </div>
              ))}
            </div>
          )}

          {texts.length > 0 && (
            <div className="tl-track caption">
              <span className="tl-track-label">T1 — Text</span>
              {texts.map((t) => (
                <div
                  key={t.id}
                  className={"seg caption-seg text-seg" + (t.id === selectedTextId ? " sel" : "")}
                  style={{
                    left: t.start * pxPerSec,
                    width: Math.max(2, (t.end - t.start) * pxPerSec),
                  }}
                  title={t.text}
                  onClick={(e) => {
                    e.stopPropagation();
                    selectText(t.id);
                    setPlayheadRaw(t.start + 0.05);
                  }}
                >
                  <span className="cap-text">T · {t.text}</span>
                </div>
              ))}
            </div>
          )}

          <div className="tl-playhead" style={{ left: playhead * pxPerSec }} />
        </div>
      </div>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems(menu.seg)}
          onClose={() => setMenu(null)}
        />
      )}
      {marquee && marqueeMoved.current && (
        <div
          className="tl-marquee"
          style={{
            left: Math.min(marquee.x0, marquee.x1),
            top: Math.min(marquee.y0, marquee.y1),
            width: Math.abs(marquee.x1 - marquee.x0),
            height: Math.abs(marquee.y1 - marquee.y0),
          }}
        />
      )}
    </section>
  );
}
