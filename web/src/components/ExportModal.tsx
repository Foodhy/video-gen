import { useRef, useState } from "react";
import { useEditor, placeTrack, placeCaptions, audioLaneCount } from "../state/editor.ts";
import { startExport, getJob, type JobState } from "../lib/api.ts";

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
  const [saveName, setSaveName] = useState<string>("");
  const [savedTo, setSavedTo] = useState<string>("");
  const saveHandle = useRef<any>(null);
  const wrote = useRef(false);
  const poll = useRef<number | null>(null);
  const showToast = useEditor((s) => s.showToast);

  // Pick the destination on the Mac BEFORE exporting.
  async function chooseDestination() {
    const picker = (window as any).showSaveFilePicker;
    if (!picker) {
      showToast("This browser can't pick a folder — it'll download to your Downloads folder", true);
      return;
    }
    try {
      const h = await picker({
        suggestedName: "video-gen-export.mp4",
        types: [{ description: "MP4 video", accept: { "video/mp4": [".mp4"] } }],
      });
      saveHandle.current = h;
      setSaveName(h.name);
    } catch {
      /* cancelled */
    }
  }

  // Write the finished export to the chosen handle.
  async function writeToChosen(url: string) {
    if (!saveHandle.current || wrote.current) return;
    wrote.current = true;
    try {
      const w = await saveHandle.current.createWritable();
      const res = await fetch(url);
      await res.body!.pipeTo(w);
      setSavedTo(saveName);
      showToast("Saved to " + saveName);
    } catch (e: any) {
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
          if (j.status === "done" && j.outputFile) writeToChosen(j.outputFile);
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

  // Let the user pick where to save (folder + name) and write the bytes there.
  async function saveAs() {
    if (!job?.outputFile) return;
    const name = job.outputFile.split("/").pop() || "export.mp4";
    const picker = (window as any).showSaveFilePicker;
    try {
      if (picker) {
        const handle = await picker({
          suggestedName: name,
          types: [{ description: "MP4 video", accept: { "video/mp4": [".mp4"] } }],
        });
        const writable = await handle.createWritable();
        const res = await fetch(job.outputFile);
        await res.body!.pipeTo(writable); // streams + closes the file
      } else {
        const a = document.createElement("a");
        a.href = job.outputFile;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
    } catch {
      /* user cancelled the picker */
    }
  }

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
              <span className="label">Save to</span>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 5 }}>
                <button className="btn-line" style={{ width: "auto" }} onClick={chooseDestination}>
                  📁 Choose location…
                </button>
                <span className="mono" style={{ fontSize: 11, color: saveName ? "var(--accent-0)" : "var(--text-muted)" }}>
                  {saveName || "Downloads (default)"}
                </span>
              </div>
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
            {done && job?.outputFile && (
              <>
                <button className="btn-cta" onClick={saveAs}>
                  💾 Save As…
                </button>
                <a className="btn-line" style={{ width: "auto" }} href={job.outputFile} download>
                  ⬇ Download
                </a>
              </>
            )}
            <button className="btn-line" style={{ width: "auto" }} onClick={onClose}>
              Close
            </button>
          </div>
        )}
        {done && (
          <span className="mono" style={{ fontSize: 9, color: "var(--text-muted)" }}>
            “Save As…” lets you choose the folder; the file also stays in the project workspace.
          </span>
        )}
      </div>
    </div>
  );
}
