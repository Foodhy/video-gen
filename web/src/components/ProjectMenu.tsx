import { useEffect, useState } from "react";
import { useEditor, type Asset, type Caption } from "../state/editor.ts";
import {
  listProjects,
  createProject,
  loadProject,
  type ProjectSummary,
} from "../lib/api.ts";

export default function ProjectMenu() {
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const projectId = useEditor((s) => s.projectId);
  const assets = useEditor((s) => s.assets);
  const showToast = useEditor((s) => s.showToast);

  const current =
    Object.values(assets).find((a) => a.kind === "video")?.name ??
    (projectId ? "Untitled" : "No project");

  useEffect(() => {
    if (open) listProjects().then(setProjects);
  }, [open, projectId]);

  async function onNew() {
    setOpen(false);
    try {
      const pid = await createProject();
      useEditor.getState().resetTo(pid);
      showToast("New project");
    } catch (e: any) {
      showToast(e.message ?? "create failed", true);
    }
  }

  async function onSwitch(pid: string) {
    setOpen(false);
    if (pid === projectId) return;
    try {
      const p = await loadProject(pid);
      if (!p) {
        showToast("project not found", true);
        return;
      }
      const doc = (p.doc ?? {}) as {
        segments?: any[];
        captions?: Record<string, Caption[]>;
        captionLang?: Record<string, string>;
        texts?: any[];
      };
      useEditor.getState().setProject(p.projectId);
      useEditor.getState().hydrate({
        assets: p.assets as Asset[],
        segments: doc.segments,
        captions: doc.captions,
        captionLang: doc.captionLang,
        texts: doc.texts,
      });
      showToast("Opened project");
    } catch (e: any) {
      showToast(e.message ?? "open failed", true);
    }
  }

  return (
    <div className="proj-menu">
      <button className="proj-btn" onClick={() => setOpen((o) => !o)} title="Projects">
        <span className="proj-name">{current}</span>
        <span className="proj-caret">▾</span>
      </button>
      {open && (
        <>
          <div className="proj-backdrop" onClick={() => setOpen(false)} />
          <div className="proj-drop">
            <button className="proj-new" onClick={onNew}>
              + New Project
            </button>
            <div className="proj-list">
              {projects.length === 0 ? (
                <div className="proj-empty">No saved projects</div>
              ) : (
                projects.map((p) => (
                  <button
                    key={p.id}
                    className={"proj-item" + (p.id === projectId ? " cur" : "")}
                    onClick={() => onSwitch(p.id)}
                  >
                    <span className="pi-name">{p.name}</span>
                    <span className="pi-meta mono">{p.clipCount} clips</span>
                  </button>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
