import { useRef, useState } from "react";
import { useEditor, type Asset } from "../state/editor.ts";
import { importFile, deleteClip } from "../lib/api.ts";
import { logger } from "../lib/logger.ts";
import ContextMenu, { type MenuItem } from "./ContextMenu.tsx";

const ASSET_DND = "application/x-asset-id";

export default function MediaPanel() {
  const fileRef = useRef<HTMLInputElement>(null);
  const projectId = useEditor((s) => s.projectId);
  const assets = useEditor((s) => s.assets);
  const folders = useEditor((s) => s.folders);
  const folderOf = useEditor((s) => s.folderOf);
  const selectedAssetId = useEditor((s) => s.selectedAssetId);
  const setProject = useEditor((s) => s.setProject);
  const addAsset = useEditor((s) => s.addAsset);
  const addSegmentForAsset = useEditor((s) => s.addSegmentForAsset);
  const removeAsset = useEditor((s) => s.removeAsset);
  const selectAsset = useEditor((s) => s.selectAsset);
  const setPreview = useEditor((s) => s.setPreview);
  const addFolder = useEditor((s) => s.addFolder);
  const renameFolder = useEditor((s) => s.renameFolder);
  const deleteFolder = useEditor((s) => s.deleteFolder);
  const moveToFolder = useEditor((s) => s.moveToFolder);
  const showToast = useEditor((s) => s.showToast);

  const [menu, setMenu] = useState<{ x: number; y: number; asset: Asset } | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [dropTarget, setDropTarget] = useState<string | "root" | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);

  async function importFiles(files: File[], folderId: string | null) {
    for (const f of files) {
      try {
        showToast("Importing " + f.name + "…");
        const res = await importFile(f, projectId ?? undefined);
        setProject(res.projectId);
        const asset: Asset = { ...res.clip, mediaUrl: res.mediaUrl, thumbs: res.thumbs };
        addAsset(asset); // lands in the library only — not the timeline
        if (folderId) moveToFolder(asset.id, folderId);
        logger.success("media", "Imported", f.name);
        showToast("Imported " + f.name);
      } catch (err: any) {
        logger.error("media", "Import failed", err?.message ?? String(err));
        showToast(err.message ?? "import failed", true);
      }
    }
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    importFiles(files, null);
  }

  async function onDelete(asset: Asset) {
    if (!confirm(`Remove "${asset.name}" from this project? This deletes the media file.`)) return;
    try {
      if (projectId) await deleteClip(projectId, asset.id);
      removeAsset(asset.id);
      showToast("Removed " + asset.name);
    } catch (e: any) {
      logger.error("media", "Delete failed", e?.message ?? String(e));
      showToast(e.message ?? "delete failed", true);
    }
  }

  function itemsFor(asset: Asset): MenuItem[] {
    const inFolder = folderOf[asset.id];
    return [
      { label: "Add to timeline", onClick: () => addSegmentForAsset(asset.id) },
      ...(folders.length
        ? folders
            .filter((f) => f.id !== inFolder)
            .map((f) => ({ label: `Move to “${f.name}”`, onClick: () => moveToFolder(asset.id, f.id) }))
        : []),
      ...(inFolder ? [{ label: "Move out of folder", onClick: () => moveToFolder(asset.id, null) }] : []),
      { separator: true, label: "" },
      { label: "Remove from project", danger: true, onClick: () => onDelete(asset) },
    ];
  }

  // Generic drop handler for a folder header/body or the root area.
  function onDropInto(folderId: string | null) {
    return (e: React.DragEvent) => {
      e.preventDefault();
      setDropTarget(null);
      if (e.dataTransfer.files.length) {
        importFiles(Array.from(e.dataTransfer.files), folderId);
        return;
      }
      const id = e.dataTransfer.getData(ASSET_DND);
      if (id) moveToFolder(id, folderId);
    };
  }
  const allowDrop = (key: string | "root") => (e: React.DragEvent) => {
    e.preventDefault();
    setDropTarget(key);
  };

  function renderItem(a: Asset) {
    return (
      <div
        key={a.id}
        className={"media-item" + (a.id === selectedAssetId ? " sel" : "")}
        draggable
        onDragStart={(e) => e.dataTransfer.setData(ASSET_DND, a.id)}
        onClick={() => {
          selectAsset(a.id);
          setPreview(a.id); // single click previews it in the player
        }}
        onDoubleClick={() => addSegmentForAsset(a.id)}
        onContextMenu={(e) => {
          e.preventDefault();
          selectAsset(a.id);
          setMenu({ x: e.clientX, y: e.clientY, asset: a });
        }}
        title={a.name + " — click to preview · double-click to add to timeline · drag to a folder · right-click for options"}
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
    );
  }

  const rootItems = Object.values(assets).filter((a) => !folderOf[a.id]);

  return (
    <aside className="panel media">
      <div className="panel-head">
        <span className="label">Media — Library</span>
        <button className="cap-clear" onClick={addFolder} title="Create a folder">
          + folder
        </button>
      </div>
      <div
        className={"panel-body" + (dropTarget === "root" ? " drop-here" : "")}
        onDragOver={allowDrop("root")}
        onDragLeave={() => setDropTarget(null)}
        onDrop={onDropInto(null)}
      >
        <input ref={fileRef} type="file" accept="video/*,audio/*" multiple hidden onChange={onPick} />
        <button className="btn-import" onClick={() => fileRef.current?.click()}>
          + Import Media
          <span className="import-hint">or drop files here</span>
        </button>

        {/* folders */}
        {folders.map((f) => {
          const items = Object.values(assets).filter((a) => folderOf[a.id] === f.id);
          const open = !collapsed.has(f.id);
          return (
            <div
              key={f.id}
              className={"media-folder" + (dropTarget === f.id ? " drop-here" : "")}
              onDragOver={allowDrop(f.id)}
              onDragLeave={() => setDropTarget(null)}
              onDrop={onDropInto(f.id)}
            >
              <div className="folder-head">
                <button
                  className="folder-toggle"
                  onClick={() =>
                    setCollapsed((c) => {
                      const n = new Set(c);
                      n.has(f.id) ? n.delete(f.id) : n.add(f.id);
                      return n;
                    })
                  }
                >
                  {open ? "▾" : "▸"}
                </button>
                {renaming === f.id ? (
                  <input
                    className="folder-rename"
                    defaultValue={f.name}
                    autoFocus
                    onBlur={(e) => {
                      renameFolder(f.id, e.target.value.trim() || f.name);
                      setRenaming(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    }}
                  />
                ) : (
                  <span className="folder-name" onDoubleClick={() => setRenaming(f.id)} title="Double-click to rename">
                    {f.name} <span className="folder-count">({items.length})</span>
                  </span>
                )}
                <button className="folder-del" title="Delete folder (keeps media)" onClick={() => deleteFolder(f.id)}>
                  ✕
                </button>
              </div>
              {open && <div className="media-grid">{items.map(renderItem)}</div>}
            </div>
          );
        })}

        {/* root (unfiled) */}
        <div className="media-grid">{rootItems.map(renderItem)}</div>
      </div>
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={itemsFor(menu.asset)} onClose={() => setMenu(null)} />
      )}
    </aside>
  );
}
