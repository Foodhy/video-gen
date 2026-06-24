import { useRef, useState } from "react";
import { useEditor, placeTrack, placeCaptions } from "../state/editor.ts";
import { startExport, getJob, type JobState } from "../lib/api.ts";

export default function ExportModal({ onClose }: { onClose: () => void }) {
  const projectId = useEditor((s) => s.projectId);
  const segments = useEditor((s) => s.segments);
  const captions = useEditor((s) => s.captions);
  const texts = useEditor((s) => s.texts);
  const placedCaps = placeCaptions(segments, captions);
  const hasCaps = placedCaps.length > 0;

  const [started, setStarted] = useState(false);
  const [burn, setBurn] = useState(hasCaps);
  const [job, setJob] = useState<JobState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const poll = useRef<number | null>(null);

  async function run() {
    if (!projectId) return;
    setStarted(true);
    const edl = placeTrack(segments, "video").map((p) => ({
      clipId: p.clipId,
      in: p.in,
      out: p.out,
      muted: !!p.muted,
      fadeIn: p.fadeIn,
      fadeOut: p.fadeOut,
      xfadeAfter: p.xfadeAfter,
      fx: p.fx,
    }));
    if (!edl.length) {
      setError("No video segments to export.");
      return;
    }
    const subs = burn && hasCaps
      ? placedCaps.map((c) => ({ start: c.tStart, end: c.tEnd, text: c.text }))
      : undefined;
    const textItems = texts.length
      ? texts.map((t) => ({
          text: t.text,
          start: t.start,
          end: t.end,
          x: t.x,
          y: t.y,
          size: t.size,
          color: t.color,
        }))
      : undefined;
    const overlays = placeTrack(segments, "overlay").map((p) => ({
      clipId: p.clipId,
      in: p.in,
      out: p.out,
      tStart: p.start,
      ox: p.ox ?? 0.5,
      oy: p.oy ?? 0.5,
      oscale: p.oscale ?? 0.4,
      animate: p.animate,
      ox2: p.ox2,
      oy2: p.oy2,
    }));
    const audioTrack = placeTrack(segments, "audio").map((p) => ({
      clipId: p.clipId,
      in: p.in,
      out: p.out,
      muted: !!p.muted,
      fadeIn: p.fadeIn,
      fadeOut: p.fadeOut,
    }));
    try {
      const jobId = await startExport(
        projectId,
        edl,
        subs,
        textItems,
        overlays,
        audioTrack.length ? audioTrack : undefined,
      );
      poll.current = window.setInterval(async () => {
        try {
          const j = await getJob(jobId);
          setJob(j);
          if (j.status !== "running" && poll.current) {
            clearInterval(poll.current);
            poll.current = null;
          }
        } catch (e: any) {
          setError(e.message);
          if (poll.current) clearInterval(poll.current);
        }
      }, 400);
    } catch (e: any) {
      setError(e.message ?? "export failed");
    }
  }

  const pct = Math.round((job?.progress ?? 0) * 100);
  const done = job?.status === "done";
  const failed = job?.status === "error" || !!error;

  return (
    <div className="overlay" onClick={!started || done || failed ? onClose : undefined}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="display">Export — MP4</h3>

        {!started ? (
          <>
            <p style={{ color: "var(--text-1)" }}>
              Render the timeline to a single MP4 with ffmpeg.
            </p>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginTop: 14,
                color: hasCaps ? "var(--text-0)" : "var(--text-muted)",
                fontSize: 12,
              }}
            >
              <input
                type="checkbox"
                checked={burn}
                disabled={!hasCaps}
                onChange={(e) => setBurn(e.target.checked)}
              />
              Burn subtitles into video {hasCaps ? `(${placedCaps.length} lines)` : "(none — transcribe first)"}
            </label>
            <div className="actions">
              <button className="btn-cta" onClick={run}>
                ⬇ Start Export
              </button>
              <button className="btn-line" style={{ width: "auto" }} onClick={onClose}>
                Cancel
              </button>
            </div>
          </>
        ) : failed ? (
          <p style={{ color: "#f0c0c0" }}>{error ?? job?.error}</p>
        ) : done ? (
          <>
            <p style={{ color: "var(--text-1)" }}>Render complete.</p>
            <p className="mono" style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>
              {job?.outputPath}
            </p>
          </>
        ) : (
          <p style={{ color: "var(--text-1)" }}>
            Rendering with ffmpeg{burn ? " + burning subtitles" : ""}… <span className="spin">◷</span>
          </p>
        )}

        {started && !failed && (
          <>
            <div className="progress">
              <i style={{ width: pct + "%" }} />
            </div>
            <span className="mono" style={{ fontSize: 11, color: "var(--text-1)" }}>
              {pct}%
            </span>
          </>
        )}

        {(done || failed) && (
          <div className="actions">
            {done && job?.outputFile && (
              <a className="btn-cta" href={job.outputFile} download>
                ⬇ Download
              </a>
            )}
            <button className="btn-line" style={{ width: "auto" }} onClick={onClose}>
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
