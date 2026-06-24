import { useEffect, useState } from "react";
import { useEditor, type Asset } from "../state/editor.ts";
import {
  listProjects,
  createProject,
  loadProject,
  deleteProject,
  type ProjectSummary,
  type ProjectSettings,
} from "../lib/api.ts";
import NewProjectModal from "./NewProjectModal.tsx";

export default function ProjectMenu() {
  const [open, setOpen] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [root, setRoot] = useState("");
  const projectId = useEditor((s) => s.projectId);
  const assets = useEditor((s) => s.assets);
  const showToast = useEditor((s) => s.showToast);

  const current =
    Object.values(assets).find((a) => a.kind === "video")?.name ??
    (projectId ? "Untitled" : "No project");

  const refresh = () => listProjects().then((r) => {
    setProjects(r.projects);
    setRoot(r.root);
  });

  useEffect(() => {
    if (open) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectId]);

  async function onCreate(settings: ProjectSettings) {
    setShowNew(false);
    setOpen(false);
    try {
      const pid = await createProject(settings);
      useEditor.getState().resetTo(pid);
      showToast(`New project "${settings.name}" (${settings.width}×${settings.height})`);
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
      showToast("Opened project");
    } catch (e: any) {
      showToast(e.message ?? "open failed", true);
    }
  }

  async function onDelete(p: ProjectSummary) {
    if (!confirm(`Delete project "${p.name}" and all its media?\n\n${p.dir}`)) return;
    try {
      await deleteProject(p.id);
      showToast("Deleted " + p.name);
      if (p.id === projectId) {
        localStorage.removeItem("video-gen:pid");
        const pid = await createProject();
        useEditor.getState().resetTo(pid);
      }
      refresh();
    } catch (e: any) {
      showToast(e.message ?? "delete failed", true);
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
            <button
              className="proj-new"
              onClick={() => {
                setOpen(false);
                setShowNew(true);
              }}
            >
              + New Project…
            </button>
            <div className="proj-list">
              {projects.length === 0 ? (
                <div className="proj-empty">No saved projects</div>
              ) : (
                projects.map((p) => (
                  <div key={p.id} className={"proj-item" + (p.id === projectId ? " cur" : "")}>
                    <button className="pi-open" onClick={() => onSwitch(p.id)} title={p.dir}>
                      <span className="pi-name">{p.name}</span>
                      <span className="pi-meta mono">{p.clipCount} clips</span>
                    </button>
                    <button
                      className="pi-del"
                      title={"Delete project\n" + p.dir}
                      onClick={() => onDelete(p)}
                    >
                      ✕
                    </button>
                  </div>
                ))
              )}
            </div>
            {root && (
              <div className="proj-footer mono" title={root}>
                Stored in {root}
              </div>
            )}
          </div>
        </>
      )}
      {showNew && <NewProjectModal onCreate={onCreate} onClose={() => setShowNew(false)} />}
    </div>
  );
}
