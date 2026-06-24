import { useRef, useState } from "react";
import { useEditor, hasFx, snapValue, type PlacedSegment } from "../../state/editor.ts";

export default function Clip({
  placed,
  onContext,
  onReorder,
  snapPoints,
}: {
  placed: PlacedSegment;
  onContext?: (placed: PlacedSegment, x: number, y: number) => void;
  onReorder?: (id: string, dropCenterSec: number) => void;
  snapPoints?: number[];
}) {
  const snapEnabled = useEditor((s) => s.snapEnabled);
  const playhead = useEditor((s) => s.playhead);
  const pxPerSec = useEditor((s) => s.pxPerSec);
  const assets = useEditor((s) => s.assets);
  const selected = useEditor((s) => s.selectedSegmentId === placed.id);
  const selectSegment = useEditor((s) => s.selectSegment);
  const trimSegment = useEditor((s) => s.trimSegment);
  const record = useEditor((s) => s.record);
  const dragState = useRef<{ side: "l" | "r"; startX: number; in0: number; out0: number } | null>(
    null,
  );
  const moveRef = useRef<{ startX: number; moved: boolean } | null>(null);
  const [dragDX, setDragDX] = useState(0);

  const asset = assets[placed.clipId];
  const left = placed.start * pxPerSec;
  const width = Math.max(2, placed.dur * pxPerSec);

  function onHandleDown(side: "l" | "r", e: React.PointerEvent) {
    e.stopPropagation();
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragState.current = { side, startX: e.clientX, in0: placed.in, out0: placed.out };
    selectSegment(placed.id);
    record(); // one undo step per trim gesture
  }
  function onHandleMove(e: React.PointerEvent) {
    const d = dragState.current;
    if (!d) return;
    const deltaSec = (e.clientX - d.startX) / pxPerSec;
    let nextIn = d.side === "l" ? d.in0 + deltaSec : d.in0;
    let nextOut = d.side === "r" ? d.out0 + deltaSec : d.out0;
    // Snap the moving right edge (start + dur) to nearby edges / playhead.
    if (snapEnabled) {
      const thresh = 8 / pxPerSec;
      const cands = [...(snapPoints ?? []), playhead].filter(
        (p) => Math.abs(p - (placed.start + placed.dur)) > 1e-6,
      );
      const edge = placed.start + (nextOut - nextIn);
      const snapped = snapValue(edge, cands, thresh);
      if (snapped !== edge) {
        const newDur = snapped - placed.start;
        if (d.side === "r") nextOut = nextIn + newDur;
        else nextIn = nextOut - newDur;
      }
    }
    if (d.side === "l") trimSegment(placed.id, { in: nextIn });
    else trimSegment(placed.id, { out: nextOut });
  }
  function onHandleUp(e: React.PointerEvent) {
    if (dragState.current) {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      dragState.current = null;
    }
  }

  // Body drag = reorder within the track.
  function onBodyDown(e: React.PointerEvent) {
    if (e.button !== 0) return;
    selectSegment(placed.id);
    moveRef.current = { startX: e.clientX, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onBodyMove(e: React.PointerEvent) {
    const m = moveRef.current;
    if (!m) return;
    const dx = e.clientX - m.startX;
    if (Math.abs(dx) > 3) m.moved = true;
    setDragDX(dx);
  }
  function onBodyUp(e: React.PointerEvent) {
    const m = moveRef.current;
    moveRef.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    if (m?.moved) {
      const centerSec = (left + dragDX + width / 2) / pxPerSec;
      onReorder?.(placed.id, centerSec);
    }
    setDragDX(0);
  }

  const isAudio = placed.track === "audio";
  const thumbs = asset?.thumbs ?? [];
  const dragging = !!moveRef.current && dragDX !== 0;

  return (
    <div
      className={"seg" + (selected ? " sel" : "") + (isAudio ? " audio" : "") + (dragging ? " dragging" : "")}
      style={{ left, width, transform: dragDX ? `translateX(${dragDX}px)` : undefined }}
      onPointerDown={onBodyDown}
      onPointerMove={onBodyMove}
      onPointerUp={onBodyUp}
      onClick={(e) => {
        e.stopPropagation();
        selectSegment(placed.id);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        selectSegment(placed.id);
        onContext?.(placed, e.clientX, e.clientY);
      }}
      title={asset?.name}
    >
      {placed.muted && <span className="seg-mute" title="Audio muted">🔇</span>}
      {placed.xfadeAfter ? (
        <span className="seg-xfade" title={`Crossfade ${placed.xfadeAfter}s into next`}>
          ⤬
        </span>
      ) : null}
      {hasFx(placed.fx) ? (
        <span className="seg-fx" title="Effects applied">
          ✦
        </span>
      ) : null}
      {placed.fadeIn ? (
        <div
          className="fade-tri l"
          style={{ width: Math.min((placed.fadeIn / placed.dur) * 100, 100) + "%" }}
        />
      ) : null}
      {placed.fadeOut ? (
        <div
          className="fade-tri r"
          style={{ width: Math.min((placed.fadeOut / placed.dur) * 100, 100) + "%" }}
        />
      ) : null}
      {isAudio ? (
        <div className="wave" />
      ) : (
        <div className="thumbs">
          {thumbs.map((t, i) => (
            <img key={i} src={t} alt="" draggable={false} />
          ))}
        </div>
      )}
      <span className="seg-name">{asset?.name}</span>
      <div
        className="handle l"
        onPointerDown={(e) => onHandleDown("l", e)}
        onPointerMove={onHandleMove}
        onPointerUp={onHandleUp}
      />
      <div
        className="handle r"
        onPointerDown={(e) => onHandleDown("r", e)}
        onPointerMove={onHandleMove}
        onPointerUp={onHandleUp}
      />
    </div>
  );
}
