import { useEditor } from "../state/editor.ts";

// Thin drag bars on the borders of the assets (left), details (right) and
// timeline (bottom) panels. Dragging updates the store's panelSizes, which
// App.tsx mirrors into the layout CSS vars. Clamping lives in the store.
type Kind = "media" | "details" | "timeline";

export default function ResizeHandles() {
  const setPanelSize = useEditor((s) => s.setPanelSize);

  function startDrag(kind: Kind, e: React.PointerEvent) {
    e.preventDefault();
    document.body.classList.add("resizing");
    const onMove = (ev: PointerEvent) => {
      const v =
        kind === "media"
          ? ev.clientX
          : kind === "details"
            ? window.innerWidth - ev.clientX
            : window.innerHeight - ev.clientY;
      setPanelSize({ [kind]: v });
    };
    const onUp = () => {
      document.body.classList.remove("resizing");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  return (
    <>
      <div
        className="resize-bar v media"
        onPointerDown={(e) => startDrag("media", e)}
        title="Drag to resize the Assets panel"
      />
      <div
        className="resize-bar v details"
        onPointerDown={(e) => startDrag("details", e)}
        title="Drag to resize the Details panel"
      />
      <div
        className="resize-bar h timeline"
        onPointerDown={(e) => startDrag("timeline", e)}
        title="Drag to resize the Timeline"
      />
    </>
  );
}
