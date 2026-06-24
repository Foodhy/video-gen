import { useRef } from "react";
import { useEditor, hasFx, type PlacedSegment } from "../../state/editor.ts";

export default function Clip({
  placed,
  onContext,
}: {
  placed: PlacedSegment;
  onContext?: (placed: PlacedSegment, x: number, y: number) => void;
}) {
  const pxPerSec = useEditor((s) => s.pxPerSec);
  const assets = useEditor((s) => s.assets);
  const selected = useEditor((s) => s.selectedSegmentId === placed.id);
  const selectSegment = useEditor((s) => s.selectSegment);
  const trimSegment = useEditor((s) => s.trimSegment);
  const record = useEditor((s) => s.record);
  const dragState = useRef<{ side: "l" | "r"; startX: number; in0: number; out0: number } | null>(
    null,
  );

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
    if (d.side === "l") trimSegment(placed.id, { in: d.in0 + deltaSec });
    else trimSegment(placed.id, { out: d.out0 + deltaSec });
  }
  function onHandleUp(e: React.PointerEvent) {
    if (dragState.current) {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      dragState.current = null;
    }
  }

  const isAudio = placed.track === "audio";
  const thumbs = asset?.thumbs ?? [];

  return (
    <div
      className={"seg" + (selected ? " sel" : "") + (isAudio ? " audio" : "")}
      style={{ left, width }}
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
