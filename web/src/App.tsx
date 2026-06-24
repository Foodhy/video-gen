import { useEffect, useRef, useState } from "react";
import {
  useEditor,
  serializeDoc,
  buildSnapPoints,
  timelineDuration,
  type Asset,
} from "./state/editor.ts";
import { loadProject, saveDoc } from "./lib/api.ts";
import Toolbar from "./components/Toolbar.tsx";
import MediaPanel from "./components/MediaPanel.tsx";
import Player from "./components/Player.tsx";
import Details from "./components/Details.tsx";
import Timeline from "./components/Timeline/Timeline.tsx";
import ExportModal from "./components/ExportModal.tsx";
import Console from "./components/Console.tsx";
import { logger } from "./lib/logger.ts";

const LS_KEY = "video-gen:pid";

export default function App() {
  const [exporting, setExporting] = useState(false);
  const hydrated = useRef(false);
  const playing = useEditor((s) => s.playing);
  const setPlaying = useEditor((s) => s.setPlaying);
  const splitAtPlayhead = useEditor((s) => s.splitAtPlayhead);
  const deleteSelected = useEditor((s) => s.deleteSelected);
  const toast = useEditor((s) => s.toast);

  // Hydrate last project from localStorage on first load.
  useEffect(() => {
    logger.info("app", "VIDEO—GEN ready");
    const pid = localStorage.getItem(LS_KEY);
    if (!pid) {
      hydrated.current = true;
      return;
    }
    logger.info("project", "Restoring last project", pid);
    loadProject(pid)
      .then((p) => {
        if (!p) {
          localStorage.removeItem(LS_KEY);
          logger.warn("project", "Saved project no longer exists — starting fresh", pid);
          return;
        }
        const doc = (p.doc ?? {}) as any;
        useEditor.getState().setProject(p.projectId);
        useEditor.getState().hydrate({
          assets: p.assets as Asset[],
          segments: doc.segments,
          captions: doc.captions,
          captionLang: doc.captionLang,
          texts: doc.texts,
          textComponents: doc.textComponents,
          folders: doc.folders,
          folderOf: doc.folderOf,
        });
        logger.success(
          "project",
          `Loaded project (${p.assets.length} assets)`,
          p.projectId,
        );
      })
      .catch((e) => logger.error("project", "Failed to restore project", e?.message ?? String(e)))
      .finally(() => {
        hydrated.current = true;
      });
  }, []);

  // Persist projectId + debounced autosave — only when the doc actually changes
  // (skip the 60fps playhead/playing churn during playback).
  useEffect(() => {
    let timer: number | undefined;
    let lastPid: string | null = null;
    let prev: unknown[] = [];
    const unsub = useEditor.subscribe((s) => {
      if (s.projectId && s.projectId !== lastPid) {
        lastPid = s.projectId;
        localStorage.setItem(LS_KEY, s.projectId);
      }
      if (!hydrated.current || !s.projectId) return;
      const sig = [s.segments, s.captions, s.captionLang, s.texts, s.textComponents, s.folders, s.folderOf];
      if (sig.every((v, i) => v === prev[i])) return; // doc unchanged → ignore
      prev = sig;
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        saveDoc(s.projectId!, serializeDoc(s)).catch(() => {});
      }, 700);
    });
    return () => {
      clearTimeout(timer);
      unsub();
    };
  }, []);

  // Keyboard shortcuts (skip when typing in inputs).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if ((e.metaKey || e.ctrlKey) && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        if (e.shiftKey) useEditor.getState().redo();
        else useEditor.getState().undo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === "y" || e.key === "Y")) {
        e.preventDefault();
        useEditor.getState().redo();
        return;
      }
      if (e.code === "Space") {
        e.preventDefault();
        setPlaying(!useEditor.getState().playing);
      } else if (e.key === "s" || e.key === "S") {
        splitAtPlayhead();
        useEditor.getState().splitCaptionAtPlayhead();
      } else if (e.key === "Backspace" || e.key === "Delete") {
        const st = useEditor.getState();
        if (st.selectedTextId) st.deleteText(st.selectedTextId);
        else deleteSelected();
      } else if (e.key === "Home") {
        e.preventDefault();
        useEditor.getState().setPlayhead(0);
      } else if (e.key === "End") {
        e.preventDefault();
        const st = useEditor.getState();
        st.setPlayhead(timelineDuration(st.segments));
      } else if (e.key === "," || e.key === ".") {
        const st = useEditor.getState();
        const pts = buildSnapPoints(st.segments, st.texts);
        const cur = st.playhead;
        const next =
          e.key === "."
            ? pts.find((p) => p > cur + 1e-4)
            : [...pts].reverse().find((p) => p < cur - 1e-4);
        if (next !== undefined) st.setPlayhead(next);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  return (
    <div className="app">
      <Toolbar onExport={() => setExporting(true)} />
      <MediaPanel />
      <Player />
      <Details />
      <Timeline />
      <Console />
      {exporting && <ExportModal onClose={() => setExporting(false)} />}
      {toast && <div className={"toast" + (toast.err ? " err" : "")}>{toast.msg}</div>}
    </div>
  );
}
