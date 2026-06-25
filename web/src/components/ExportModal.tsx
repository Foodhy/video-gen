import { useRef, useState } from "react";
import { useEditor, placeTrack, placeCaptions, audioLaneCount } from "../state/editor.ts";
import { startExport, getJob, saveExportAs, type JobState } from "../lib/api.ts";

export default function ExportModal({ onClose }: { onClose: () => void }) {
  const projectId = useEditor((s) => s.projectId);
  const segments = useEditor((s) => s.segments);
  const captions = useEditor((s) => s.captions);
  const texts = useEditor((s) => s.texts);
  const trackHidden = useEditor((s) => s.trackHidden);
  const trackMuted = useEditor((s) => s.trackMuted);
  const placedCaps = placeCaptions(segments, captions);
  const hasCaps = placedCaps.length > 0;

  const [started, setStarted] = useState(false);
  const [burn, setBurn] = useState(hasCaps);
  const [job, setJob] = useState<JobState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [destDir, setDestDir] = useState<string>("~/Desktop");
  const [fileName, setFileName] = useState<string>("video-gen-export.mp4");
  const [savedTo, setSavedTo] = useState<string>("");
  const wrote = useRef(false);
  const poll = useRef<number | null>(null);
  const showToast = useEditor((s) => s.showToast);

  // Copy the finished export to the chosen folder on disk (server-side).
  async function saveToDisk(src: string) {
    if (wrote.current || !destDir.trim()) return;
    wrote.current = true;
    try {
      const saved = await saveExportAs(src, destDir.trim(), fileName.trim());
      setSavedTo(saved);
      showToast("Saved to " + saved);
    } catch (e: any) {
      wrote.current = false;
      showToast("Save failed: " + (e?.message ?? e), true);
    }
  }

  async function run() {
    if (!projectId) return;
    setStarted(true);
    // Crossfade is inferred from how much each clip overlaps the next on the
    // timeline; gaps are compacted (clips render back-to-back in order).
    const vplaced = placeTrack(segments, "video");
    const edl = vplaced.map((p, i) => {
      const next = vplaced[i + 1];
      const overlap = next ? Math.max(0, p.start + p.dur - next.start) : 0;
      return {
        clipId: p.clipId,
        in: p.in,
        out: p.out,
        speed: p.speed,
        volume: p.volume,
        muted: !!p.muted || !!trackMuted.video, // track-level mute
        fadeIn: p.fadeIn,
        fadeOut: p.fadeOut,
        xfadeAfter: overlap,
        fx: p.fx,
      };
    });
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
    const overlays = (trackHidden.overlay ? [] : placeTrack(segments, "overlay")).map((p) => ({
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
    // All audio lanes (A1/A2/A3…) flattened; each item carries its absolute
    // timeline `start` so the server can mix overlapping lanes (amix by offset).
    const a1Off = !!trackMuted.audio || !!trackHidden.audio;
    const lanes = a1Off ? 0 : audioLaneCount(segments);
    const audioTrack = Array.from({ length: lanes }, (_, lane) =>
      placeTrack(segments, "audio", lane),
    )
      .flat()
      .map((p) => ({
        clipId: p.clipId,
        in: p.in,
        out: p.out,
        start: p.start,
        speed: p.speed,
        volume: p.volume,
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
          if (j.status === "done" && j.outputFile) saveToDisk(j.outputFile);
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

            <div style={{ marginTop: 14 }}>
              <span className="label">Save to folder</span>
              <div className="fx-presets" style={{ marginTop: 5 }}>
                {[
                  ["Desktop", "~/Desktop"],
                  ["Movies", "~/Movies"],
                  ["Downloads", "~/Downloads"],
                  ["Home", "~"],
                ].map(([lbl, p]) => (
                  <button
                    key={p}
                    className={"fx-preset" + (destDir === p ? " on" : "")}
                    onClick={() => setDestDir(p)}
                  >
                    {lbl}
                  </button>
                ))}
              </div>
              <input
                className="select-line"
                style={{ marginTop: 6 }}
                value={destDir}
                onChange={(e) => setDestDir(e.target.value)}
                placeholder="/Users/you/Desktop"
              />
              <input
                className="select-line"
                style={{ marginTop: 6 }}
                value={fileName}
                onChange={(e) => setFileName(e.target.value)}
                placeholder="filename.mp4"
              />
            </div>

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
            <p style={{ color: "var(--text-1)" }}>
              {savedTo ? `Saved to ${savedTo}` : "Render complete."}
            </p>
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
            {done && job?.outputFile && !savedTo && (
              <button
                className="btn-cta"
                onClick={() => {
                  wrote.current = false;
                  saveToDisk(job.outputFile!);
                }}
              >
                💾 Save to {destDir}
              </button>
            )}
            {done && job?.outputFile && (
              <a className="btn-line" style={{ width: "auto" }} href={job.outputFile} download>
                ⬇ Download
              </a>
            )}
            <button className="btn-line" style={{ width: "auto" }} onClick={onClose}>
              Close
            </button>
          </div>
        )}
        {done && (
          <span className="mono" style={{ fontSize: 9, color: "var(--text-muted)" }}>
            {savedTo ? "✓ " + savedTo : "Saved to the folder above; also kept in the project workspace."}
          </span>
        )}
      </div>
    </div>
  );
}
