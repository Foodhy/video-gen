import { useEditor, placeTrack, type TrackKind, type PlacedSegment } from "../../state/editor.ts";
import Clip from "./Clip.tsx";

export default function Track({
  kind,
  onClipContext,
  onMove,
  snapPoints,
}: {
  kind: TrackKind;
  onClipContext?: (placed: PlacedSegment, x: number, y: number) => void;
  onMove?: (id: string, newStartSec: number) => void;
  snapPoints?: number[];
}) {
  const segments = useEditor((s) => s.segments);
  const placed = placeTrack(segments, kind);

  return (
    <div className={"tl-track" + (kind === "audio" ? " audio" : "")} data-track={kind}>
      <span className="tl-track-label">
        {kind === "audio" ? "A1 — Audio" : kind === "overlay" ? "V2 — Overlay" : "V1 — Video"}
      </span>
      {placed.map((p) => (
        <Clip
          key={p.id}
          placed={p}
          onContext={onClipContext}
          onMove={onMove}
          snapPoints={snapPoints}
        />
      ))}
    </div>
  );
}
