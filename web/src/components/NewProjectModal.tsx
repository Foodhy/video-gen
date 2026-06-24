import { useState } from "react";
import type { ProjectSettings } from "../lib/api.ts";

const PRESETS: { label: string; w: number; h: number }[] = [
  { label: "1080p — 1920×1080", w: 1920, h: 1080 },
  { label: "720p — 1280×720", w: 1280, h: 720 },
  { label: "Vertical — 1080×1920", w: 1080, h: 1920 },
  { label: "Square — 1080×1080", w: 1080, h: 1080 },
  { label: "4K — 3840×2160", w: 3840, h: 2160 },
];

export default function NewProjectModal({
  onCreate,
  onClose,
}: {
  onCreate: (s: ProjectSettings) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("Untitled");
  const [preset, setPreset] = useState(1); // 720p default
  const [custom, setCustom] = useState(false);
  const [w, setW] = useState(1280);
  const [h, setH] = useState(720);
  const [fps, setFps] = useState(30);

  function create() {
    const res = custom ? { w, h } : { w: PRESETS[preset].w, h: PRESETS[preset].h };
    onCreate({ name: name.trim() || "Untitled", width: res.w, height: res.h, fps });
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="display">New Project</h3>

        <label className="np-field">
          <span className="label">Name</span>
          <input className="select-line" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
        </label>

        <label className="np-field">
          <span className="label">Resolution</span>
          <select
            className="select-line"
            value={custom ? "custom" : String(preset)}
            onChange={(e) => {
              if (e.target.value === "custom") setCustom(true);
              else {
                setCustom(false);
                setPreset(Number(e.target.value));
              }
            }}
          >
            {PRESETS.map((p, i) => (
              <option key={i} value={i}>
                {p.label}
              </option>
            ))}
            <option value="custom">Custom…</option>
          </select>
        </label>

        {custom && (
          <div className="fade-row">
            <label>
              <span>Width</span>
              <input type="number" min={16} step={2} value={w} onChange={(e) => setW(Number(e.target.value))} />
            </label>
            <label>
              <span>Height</span>
              <input type="number" min={16} step={2} value={h} onChange={(e) => setH(Number(e.target.value))} />
            </label>
          </div>
        )}

        <label className="np-field">
          <span className="label">Frame rate</span>
          <select className="select-line" value={fps} onChange={(e) => setFps(Number(e.target.value))}>
            {[24, 25, 30, 50, 60].map((f) => (
              <option key={f} value={f}>
                {f} fps
              </option>
            ))}
          </select>
        </label>

        <span className="mono" style={{ fontSize: 10, color: "var(--text-muted)" }}>
          Used as the export resolution (clips are scaled to fit + letterboxed).
        </span>

        <div className="actions">
          <button className="btn-cta" onClick={create}>
            Create
          </button>
          <button className="btn-line" style={{ width: "auto" }} onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
