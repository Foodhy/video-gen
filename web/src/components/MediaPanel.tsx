import { useRef, useState } from "react";
import { useEditor, type Asset } from "../state/editor.ts";
import { importFile, deleteClip } from "../lib/api.ts";
import { logger } from "../lib/logger.ts";
import ContextMenu, { type MenuItem } from "./ContextMenu.tsx";

export default function MediaPanel() {
  const fileRef = useRef<HTMLInputElement>(null);
  const projectId = useEditor((s) => s.projectId);
  const assets = useEditor((s) => s.assets);
  const selectedAssetId = useEditor((s) => s.selectedAssetId);
  const setProject = useEditor((s) => s.setProject);
  const addAsset = useEditor((s) => s.addAsset);
  const addSegmentForAsset = useEditor((s) => s.addSegmentForAsset);
  const removeAsset = useEditor((s) => s.removeAsset);
  const selectAsset = useEditor((s) => s.selectAsset);
  const showToast = useEditor((s) => s.showToast);
  const [menu, setMenu] = useState<{ x: number; y: number; asset: Asset } | null>(null);

  async function onDelete(asset: Asset) {
    if (!confirm(`Remove "${asset.name}" from this project? This deletes the media file.`)) return;
    try {
      if (projectId) await deleteClip(projectId, asset.id);
      removeAsset(asset.id);
      logger.success("media", "Removed media", asset.name);
      showToast("Removed " + asset.name);
    } catch (e: any) {
      logger.error("media", "Delete failed", e?.message ?? String(e));
      showToast(e.message ?? "delete failed", true);
    }
  }

  function itemsFor(asset: Asset): MenuItem[] {
    return [
      { label: "Add to timeline", onClick: () => addSegmentForAsset(asset.id) },
      { separator: true, label: "" },
      { label: "Remove from project", danger: true, onClick: () => onDelete(asset) },
    ];
  }

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    for (const f of files) {
      try {
        showToast("Importing " + f.name + "…");
        const res = await importFile(f, projectId ?? undefined);
        setProject(res.projectId);
        const asset: Asset = { ...res.clip, mediaUrl: res.mediaUrl, thumbs: res.thumbs };
        addAsset(asset);
        addSegmentForAsset(asset.id); // drop onto timeline immediately
        showToast("Imported " + f.name);
      } catch (err: any) {
        showToast(err.message ?? "import failed", true);
      }
    }
  }

  const list = Object.values(assets);

  return (
    <aside className="panel media">
      <div className="panel-head">
        <span className="label">Media — Library</span>
      </div>
      <div className="panel-body">
        <input
          ref={fileRef}
          type="file"
          accept="video/*,audio/*"
          multiple
          hidden
          onChange={onPick}
        />
        <button className="btn-import" onClick={() => fileRef.current?.click()}>
          + Import Media
        </button>

        <div className="media-grid">
          {list.map((a) => (
            <div
              key={a.id}
              className={"media-item" + (a.id === selectedAssetId ? " sel" : "")}
              onClick={() => selectAsset(a.id)}
              onDoubleClick={() => addSegmentForAsset(a.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                selectAsset(a.id);
                setMenu({ x: e.clientX, y: e.clientY, asset: a });
              }}
              title={a.name + " — double-click to add · right-click for options"}
            >
              <button
                className="media-del"
                title="Remove from project"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(a);
                }}
              >
                ✕
              </button>
              {a.kind === "video" && a.thumbs[0] ? (
                <img className="thumb" src={a.thumbs[0]} alt="" />
              ) : (
                <div className="thumb" style={{ display: "grid", placeItems: "center" }}>
                  <span style={{ fontSize: 22, color: "var(--text-muted)" }}>
                    {a.kind === "audio" ? "♪" : "▦"}
                  </span>
                </div>
              )}
              <div className="nm">{a.name}</div>
              <div className="kind">{a.kind}</div>
            </div>
          ))}
        </div>
      </div>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={itemsFor(menu.asset)}
          onClose={() => setMenu(null)}
        />
      )}
    </aside>
  );
}
