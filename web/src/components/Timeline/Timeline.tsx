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
  const setFx = useEditor((s) => s.setFx);
  const clearFx = useEditor((s) => s.clearFx);
  const setSegmentStart = useEditor((s) => s.setSegmentStart);
  const addSegmentAt = useEditor((s) => s.addSegmentAt);
  const sendToTrack = useEditor((s) => s.sendToTrack);

  // Accept media dragged from the library → drop it where you release it.
  function onTimelineDragOver(e: React.DragEvent) {
    if (e.dataTransfer.types.includes("application/x-asset-id")) e.preventDefault();
  }
  function onTimelineDrop(e: React.DragEvent) {
    const id = e.dataTransfer.getData("application/x-asset-id");
    if (!id) return;
    e.preventDefault();
    const asset = useEditor.getState().assets[id];
    if (!asset) return;
    const trackEl = (e.target as HTMLElement).closest<HTMLElement>("[data-track]");
    let track = (trackEl?.dataset.track as "video" | "audio" | "overlay") ?? asset.kind;
    if (asset.kind === "audio") track = "audio"; // audio media only on the audio track
    else if (track === "audio") track = "video"; // video media can't sit on A1
    const el = scrollRef.current;
    let start = 0;
    if (el) {
      const rect = el.getBoundingClientRect();
      start = Math.max(0, (e.clientX - rect.left + el.scrollLeft) / pxPerSec);
    }
    if (snapEnabled) start = snapValue(start, snapPoints, 8 / pxPerSec);
    addSegmentAt(id, track, start);
  }
  const snapEnabled = useEditor((s) => s.snapEnabled);
  const toggleSnap = useEditor((s) => s.toggleSnap);
  const snapPoints = buildSnapPoints(segments, texts);

  // Free reposition with edge snapping (the "click" near other clips' edges).
  function moveClip(id: string, rawStart: number) {
    const seg = segments.find((x) => x.id === id);
    if (!seg) return;
    const dur = seg.out - seg.in;
    let start = Math.max(0, rawStart);
    if (snapEnabled) {
      const thresh = 8 / pxPerSec;
      const cands = [0];
      for (const k of ["video", "audio", "overlay"] as const) {
        for (const p of placeTrack(segments, k)) {
          if (p.id === id) continue;
          cands.push(p.start, p.start + p.dur);
        }
      }
      for (const t of texts) cands.push(t.start, t.end);
      const sStart = snapValue(start, cands, thresh);
      const sEnd = snapValue(start + dur, cands, thresh);
      if (sStart !== start) start = sStart;
      else if (sEnd !== start + dur) start = Math.max(0, sEnd - dur);
    }
    setSegmentStart(id, start);
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
  const [bgMenu, setBgMenu] = useState<{ x: number; y: number } | null>(null);
  const [textMenu, setTextMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const addText = useEditor((s) => s.addText);
  const deleteText = useEditor((s) => s.deleteText);
  const selectTextFn = useEditor((s) => s.selectText);
  const updateText = useEditor((s) => s.updateText);
  const setCaptionTiming = useEditor((s) => s.setCaptionTiming);
  const record = useEditor((s) => s.record);
  const blockDrag = useRef<
    | { kind: "cap"; clipId: string; capId: string; startX: number; s0: number; e0: number }
    | { kind: "text"; id: string; startX: number; s0: number; e0: number }
    | null
  >(null);

  function onBlockMove(e: React.PointerEvent) {
    const d = blockDrag.current;
    if (!d) return;
    const dt = (e.clientX - d.startX) / pxPerSec;
    if (d.kind === "cap") setCaptionTiming(d.clipId, d.capId, d.s0 + dt, d.e0 + dt);
    else updateText(d.id, { start: Math.max(0, d.s0 + dt), end: Math.max(0.05, d.e0 + dt) });
  }
  function onBlockUp(e: React.PointerEvent) {
    if (blockDrag.current) (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    blockDrag.current = null;
  }

  function onInnerContextMenu(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest(".seg")) return; // clip menu handles its own
    e.preventDefault();
    setBgMenu({ x: e.clientX, y: e.clientY });
  }

  function bgMenuItems(): MenuItem[] {
    const vids = placeTrack(segments, "video");
    const insideClip = vids.some((p) => playhead > p.start + 0.02 && playhead < p.start + p.dur - 0.02);
    const allIds = segments.map((s) => s.id);
    return [
      { label: "Split at playhead", hint: "S", disabled: !insideClip, onClick: () => splitAtPlayhead() },
      { label: "Add text overlay here", onClick: () => addText() },
      { separator: true, label: "" },
      { label: "Select all clips", disabled: !allIds.length, onClick: () => setSelection(allIds) },
      { label: "Clear selection", disabled: selCount === 0, onClick: () => setSelection([]) },
      { separator: true, label: "" },
      { label: snapEnabled ? "Snap: on → turn off" : "Snap: off → turn on", onClick: () => toggleSnap() },
      { separator: true, label: "" },
      { label: "Go to start", hint: "Home", onClick: () => setPlayhead(0) },
      { label: "Go to end", hint: "End", onClick: () => setPlayhead(total) },
    ];
  }

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
        label: "Crossfade with next — 0.5s",
        hint: "⤬",
        disabled: !hasNext,
        // Overlap the next clip by 0.5s; export turns the overlap into a crossfade.
        onClick: () => {
          const next = vids[vIdx + 1];
          if (next) setSegmentStart(next.id, Math.max(0, seg.start + seg.dur - 0.5));
        },
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
        <button className="tl-btn" onClick={() => jumpEdit(-1)} title="Jump to previous edit (,)">
          ⇤ Prev
        </button>
        <button className="tl-btn" onClick={() => jumpEdit(1)} title="Jump to next edit (.)">
          Next ⇥
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
          onContextMenu={onInnerContextMenu}
          onDragOver={onTimelineDragOver}
          onDrop={onTimelineDrop}
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
            onMove={moveClip}
            snapPoints={snapPoints}
          />
          <Track
            kind="video"
            onClipContext={(seg, x, y) => setMenu({ x, y, seg })}
            onMove={moveClip}
            snapPoints={snapPoints}
          />
          <Track
            kind="audio"
            onClipContext={(seg, x, y) => setMenu({ x, y, seg })}
            onMove={moveClip}
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
                  title={c.text + " — drag to move timing"}
                  onPointerDown={(e) => {
                    if (e.button !== 0) return;
                    e.stopPropagation();
                    record();
                    blockDrag.current = { kind: "cap", clipId: c.clipId, capId: c.id, startX: e.clientX, s0: c.start, e0: c.end };
                    (e.target as HTMLElement).setPointerCapture(e.pointerId);
                  }}
                  onPointerMove={onBlockMove}
                  onPointerUp={onBlockUp}
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
                  title={t.text + " — drag to move · right-click for options"}
                  onPointerDown={(e) => {
                    if (e.button !== 0) return;
                    e.stopPropagation();
                    selectText(t.id);
                    record();
                    blockDrag.current = { kind: "text", id: t.id, startX: e.clientX, s0: t.start, e0: t.end };
                    (e.target as HTMLElement).setPointerCapture(e.pointerId);
                  }}
                  onPointerMove={onBlockMove}
                  onPointerUp={onBlockUp}
                  onClick={(e) => {
                    e.stopPropagation();
                    setPlayheadRaw(t.start + 0.05);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    selectText(t.id);
                    setTextMenu({ x: e.clientX, y: e.clientY, id: t.id });
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
      {bgMenu && (
        <ContextMenu x={bgMenu.x} y={bgMenu.y} items={bgMenuItems()} onClose={() => setBgMenu(null)} />
      )}
      {textMenu && (
        <ContextMenu
          x={textMenu.x}
          y={textMenu.y}
          items={[
            { label: "Edit text (inspector)", onClick: () => selectTextFn(textMenu.id) },
            { separator: true, label: "" },
            { label: "Delete text", danger: true, onClick: () => deleteText(textMenu.id) },
          ]}
          onClose={() => setTextMenu(null)}
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
