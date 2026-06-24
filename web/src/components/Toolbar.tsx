import { useEditor, timelineDuration } from "../state/editor.ts";
import ProjectMenu from "./ProjectMenu.tsx";
import { startTour } from "../lib/tour.ts";

const TOOLS = [
  { id: "media", ic: "▦", label: "Media", on: true },
  { id: "audio", ic: "♪", label: "Audio", on: true },
  { id: "effects", ic: "✶", label: "Effects", on: false },
];

export default function Toolbar({ onExport }: { onExport: () => void }) {
  const segments = useEditor((s) => s.segments);
  const showCaptions = useEditor((s) => s.showCaptions);
  const toggleCaptions = useEditor((s) => s.toggleCaptions);
  const hasCaptions = Object.keys(useEditor((s) => s.captions)).length > 0;
  const toggleLogs = useEditor((s) => s.toggleLogs);
  const showLogs = useEditor((s) => s.showLogs);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const errCount = useEditor((s) => s.logs).filter((l) => l.level === "error").length;
  const addText = useEditor((s) => s.addText);
  const hasVideo = timelineDuration(segments) > 0;

  return (
    <header className="toolbar">
      <span className="brand">VIDEO—GEN</span>
      <span data-tour="projects">
        <ProjectMenu />
      </span>
      <span style={{ width: 8 }} />
      <span data-tour="undo" style={{ display: "inline-flex" }}>
        <button className="tool" onClick={undo} disabled={!canUndo} title="Undo (⌘Z)">
          <span className="ic">↶</span>
          Undo
        </button>
        <button className="tool" onClick={redo} disabled={!canRedo} title="Redo (⌘⇧Z)">
          <span className="ic">↷</span>
          Redo
        </button>
      </span>
      <span style={{ width: 14 }} />
      {TOOLS.map((t) => (
        <button
          key={t.id}
          className={"tool" + (t.id === "media" ? " active" : "")}
          disabled={!t.on}
          title={t.on ? t.label : t.label + " — Phase 2"}
        >
          <span className="ic">{t.ic}</span>
          {t.label}
        </button>
      ))}
      <button
        className="tool"
        onClick={addText}
        disabled={!hasVideo}
        title="Add a text/title overlay at the playhead"
      >
        <span className="ic">T</span>
        Text
      </button>
      <button
        className={"tool" + (hasCaptions && showCaptions ? " active" : "")}
        onClick={toggleCaptions}
        disabled={!hasCaptions}
        title={hasCaptions ? "Toggle subtitle overlay" : "Transcribe a clip first"}
      >
        <span className="ic">❝</span>
        Captions
      </button>
      <span className="spacer" />
      <button className="tool" onClick={startTour} title="Guided tour of the editor">
        <span className="ic">?</span>
        Guide
      </button>
      <button
        data-tour="logs"
        className={"tool" + (showLogs ? " active" : "")}
        onClick={toggleLogs}
        title="Show event/error console"
      >
        <span className="ic" style={{ position: "relative" }}>
          ▤
          {errCount > 0 && <span className="log-badge">{errCount}</span>}
        </span>
        Logs
      </button>
      <button data-tour="export" className="btn-cta" onClick={onExport} disabled={!hasVideo}>
        ⬇ Export
      </button>
    </header>
  );
}
