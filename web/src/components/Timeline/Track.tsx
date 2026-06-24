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
  const hidden = useEditor((s) => !!s.trackHidden[kind]);
  const muted = useEditor((s) => !!s.trackMuted[kind]);
  const toggleTrackHidden = useEditor((s) => s.toggleTrackHidden);
  const toggleTrackMuted = useEditor((s) => s.toggleTrackMuted);
  const placed = placeTrack(segments, kind);

  return (
    <div
      className={"tl-track" + (kind === "audio" ? " audio" : "") + (hidden ? " track-hidden" : "")}
      data-track={kind}
    >
      <span className="tl-track-label">
        {kind === "audio" ? "A1 — Audio" : kind === "overlay" ? "V2 — Overlay" : "V1 — Video"}
      </span>
      <div className="tl-track-ctrls">
        {kind !== "audio" && (
          <button
            className={"tk-btn" + (hidden ? " off" : "")}
            title={hidden ? "Show track" : "Hide track (disable)"}
            onClick={() => toggleTrackHidden(kind)}
          >
            {hidden ? "🚫" : "👁"}
          </button>
        )}
        <button
          className={"tk-btn" + (muted ? " off" : "")}
          title={muted ? "Unmute track" : "Mute track"}
          onClick={() => toggleTrackMuted(kind)}
        >
          {muted ? "🔇" : "🔊"}
        </button>
      </div>
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
