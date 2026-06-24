import { useState } from "react";
import { useEditor, timelineDuration } from "../state/editor.ts";
import ProjectMenu from "./ProjectMenu.tsx";
import ContextMenu from "./ContextMenu.tsx";
import About from "./About.tsx";
import { startTour } from "../lib/tour.ts";

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
  const createTextComponent = useEditor((s) => s.createTextComponent);
  const requestImport = useEditor((s) => s.requestImport);
  const selectedSegmentId = useEditor((s) => s.selectedSegmentId);
  const previewAutoplay = useEditor((s) => s.previewAutoplay);
  const setPreviewAutoplay = useEditor((s) => s.setPreviewAutoplay);
  const recoverPlayer = useEditor((s) => s.recoverPlayer);
  const showToast = useEditor((s) => s.showToast);
  const [settings, setSettings] = useState<{ x: number; y: number } | null>(null);
  const [showAbout, setShowAbout] = useState(false);
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
      <button className="tool" onClick={() => requestImport("all")} title="Import video/audio into the library">
        <span className="ic">▦</span>
        Media
      </button>
      <button className="tool" onClick={() => requestImport("audio")} title="Import audio into the library">
        <span className="ic">♪</span>
        Audio
      </button>
      <button
        className="tool"
        onClick={() =>
          showToast(
            selectedSegmentId
              ? "Effects are in Details (right panel) for the selected clip"
              : "Select a clip first — effects show in Details",
          )
        }
        title="Per-clip effects live in the Details panel"
      >
        <span className="ic">✶</span>
        Effects
      </button>
      <button
        className="tool"
        onClick={createTextComponent}
        title="Create a text component in the library"
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
      <button
        className="tool"
        onClick={(e) => setSettings({ x: e.clientX - 180, y: 46 })}
        title="Settings"
      >
        <span className="ic">⚙</span>
        Settings
      </button>
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
      {settings && (
        <ContextMenu
          x={settings.x}
          y={settings.y}
          items={[
            {
              label: (previewAutoplay ? "✓ " : "○ ") + "Auto-play preview",
              onClick: () => setPreviewAutoplay(!previewAutoplay),
            },
            { separator: true, label: "" },
            {
              label: "↻ Recover player (reload media)",
              onClick: () => {
                recoverPlayer();
                showToast("Player reloaded — see Logs for the media reference");
              },
            },
            { separator: true, label: "" },
            {
              label: "⛶ Enter fullscreen",
              onClick: () => document.documentElement.requestFullscreen().catch(() => {}),
            },
            {
              label: "⤡ Exit fullscreen",
              disabled: typeof document !== "undefined" && !document.fullscreenElement,
              onClick: () => document.exitFullscreen().catch(() => {}),
            },
            { separator: true, label: "" },
            {
              label: "ⓘ About VIDEO—GEN",
              onClick: () => setShowAbout(true),
            },
          ]}
          onClose={() => setSettings(null)}
        />
      )}
      {showAbout && <About onClose={() => setShowAbout(false)} />}
    </header>
  );
}
