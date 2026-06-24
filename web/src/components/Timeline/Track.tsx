import { useEditor, placeTrack, type TrackKind, type PlacedSegment } from "../../state/editor.ts";
import Clip from "./Clip.tsx";

export default function Track({
  kind,
  onClipContext,
  onReorder,
  snapPoints,
}: {
  kind: TrackKind;
  onClipContext?: (placed: PlacedSegment, x: number, y: number) => void;
  onReorder?: (id: string, dropCenterSec: number) => void;
  snapPoints?: number[];
}) {
  const segments = useEditor((s) => s.segments);
  const placed = placeTrack(segments, kind);

  return (
    <div className={"tl-track" + (kind === "audio" ? " audio" : "")}>
      <span className="tl-track-label">{kind === "audio" ? "A1 — Audio" : "V1 — Video"}</span>
      {placed.map((p) => (
        <Clip
          key={p.id}
          placed={p}
          onContext={onClipContext}
          onReorder={onReorder}
          snapPoints={snapPoints}
        />
      ))}
    </div>
  );
}
