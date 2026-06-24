import { test, expect, beforeEach } from "bun:test";
import {
  useEditor,
  placeTrack,
  placeCaptions,
  locate,
  timelineDuration,
  buildSnapPoints,
  snapValue,
  overlayPosAt,
  fxToCss,
  hasFx,
  serializeDoc,
  FX_PRESETS,
  type Segment,
  type Asset,
} from "../web/src/state/editor.ts";

const seg = (id: string, inn: number, out: number, extra: Partial<Segment> = {}): Segment => ({
  id,
  clipId: id,
  track: "video",
  in: inn,
  out,
  ...extra,
});

const asset = (id: string, duration: number, kind: "video" | "audio" = "video"): Asset => ({
  id,
  name: id,
  file: `source/${id}.mp4`,
  kind,
  duration,
  hasAudio: true,
  size: 1,
  mediaUrl: `/media/x/${id}`,
  thumbs: [],
});

// Reset store to a clean slate before each test.
beforeEach(() => {
  useEditor.setState({
    projectId: "p",
    assets: {},
    segments: [],
    captions: {},
    captionLang: {},
    texts: [],
    selectedSegmentId: null,
    selectedAssetId: null,
    selectedTextId: null,
    playhead: 0,
    playing: false,
    past: [],
    future: [],
  });
});

// ---------- pure helpers ----------

test("placeTrack lays segments end-to-end", () => {
  const p = placeTrack([seg("a", 0, 3), seg("b", 0, 2)], "video");
  expect(p.map((x) => [x.start, x.dur])).toEqual([
    [0, 3],
    [3, 2],
  ]);
});

test("placeTrack subtracts crossfade overlap", () => {
  const p = placeTrack([seg("a", 0, 3, { xfadeAfter: 1 }), seg("b", 0, 2)], "video");
  expect(p[1].start).toBe(2); // 3 - 1 overlap
});

test("timelineDuration is max across tracks", () => {
  const segs = [seg("a", 0, 4), seg("m", 0, 6, { track: "audio" })];
  expect(timelineDuration(segs)).toBe(6);
});

test("locate maps timeline time to source time", () => {
  const p = placeTrack([seg("a", 2, 5), seg("b", 0, 2)], "video"); // a:[0-3] src2-5, b:[3-5]
  expect(locate(p, 1)?.srcTime).toBe(3); // 2 + (1-0)
  expect(locate(p, 4)?.seg.id).toBe("b");
});

test("placeCaptions hides captions outside the trimmed range", () => {
  const segs = [seg("a", 5, 10)]; // shows source 5..10 at timeline 0..5
  const caps = { a: [{ id: "c1", start: 6, end: 7, text: "in" }, { id: "c2", start: 1, end: 2, text: "out" }] };
  const pc = placeCaptions(segs, caps as any);
  expect(pc.map((c) => c.text)).toEqual(["in"]);
  expect(pc[0].tStart).toBeCloseTo(1); // 0 + (6-5)
});

test("buildSnapPoints + snapValue", () => {
  const pts = buildSnapPoints([seg("a", 0, 3), seg("b", 0, 2)], []);
  expect(pts).toEqual([0, 3, 5]);
  expect(snapValue(2.95, pts, 0.1)).toBe(3);
  expect(snapValue(2.5, pts, 0.1)).toBe(2.5);
});

test("overlayPosAt static vs animated", () => {
  const s = placeTrack([seg("a", 0, 4, { track: "overlay", ox: 0.2, oy: 0.5, animate: true, ox2: 0.8, oy2: 0.5 })], "overlay")[0];
  expect(overlayPosAt(s, 0).x).toBeCloseTo(0.2);
  expect(overlayPosAt(s, 2).x).toBeCloseTo(0.5); // midpoint
  expect(overlayPosAt(s, 4).x).toBeCloseTo(0.8);
  const stat = placeTrack([seg("b", 0, 4, { track: "overlay", ox: 0.3, oy: 0.7 })], "overlay")[0];
  expect(overlayPosAt(stat, 2)).toEqual({ x: 0.3, y: 0.7 });
});

test("fxToCss + hasFx", () => {
  expect(fxToCss(undefined)).toBe("none");
  expect(fxToCss({ grayscale: true })).toBe("grayscale(1)");
  expect(fxToCss({ brightness: 0.5, blur: 3 })).toBe("brightness(1.5) blur(3px)");
  expect(hasFx({ contrast: 1 })).toBe(false);
  expect(hasFx({ contrast: 1.2 })).toBe(true);
});

test("serializeDoc keeps only persistable fields", () => {
  const doc = serializeDoc({ segments: [seg("a", 0, 1)], captions: {}, captionLang: {}, texts: [] });
  expect(Object.keys(doc).sort()).toEqual(["captionLang", "captions", "segments", "texts"]);
});

// ---------- store actions ----------

test("addSegmentForAsset adds a segment on the asset's track", () => {
  const s = useEditor.getState();
  s.addAsset(asset("v", 5));
  s.addSegmentForAsset("v");
  expect(useEditor.getState().segments).toHaveLength(1);
  expect(useEditor.getState().segments[0].out).toBe(5);
});

test("split at playhead divides the clip", () => {
  const s = useEditor.getState();
  s.addAsset(asset("v", 10));
  s.addSegmentForAsset("v");
  s.setPlayhead(4);
  s.splitAtPlayhead();
  const segs = useEditor.getState().segments;
  expect(segs).toHaveLength(2);
  expect(segs[0].out).toBeCloseTo(4);
  expect(segs[1].in).toBeCloseTo(4);
});

test("moveSegmentBefore reorders and is undoable", () => {
  useEditor.setState({ segments: [seg("a", 0, 1), seg("b", 0, 1), seg("c", 0, 1)] });
  useEditor.getState().moveSegmentBefore("c", "a");
  expect(useEditor.getState().segments.map((s) => s.id)).toEqual(["c", "a", "b"]);
  useEditor.getState().undo();
  expect(useEditor.getState().segments.map((s) => s.id)).toEqual(["a", "b", "c"]);
});

test("undo/redo round-trips a delete", () => {
  useEditor.setState({ segments: [seg("a", 0, 1), seg("b", 0, 1)] });
  useEditor.getState().deleteSegment("a");
  expect(useEditor.getState().segments.map((s) => s.id)).toEqual(["b"]);
  useEditor.getState().undo();
  expect(useEditor.getState().segments.map((s) => s.id)).toEqual(["a", "b"]);
  useEditor.getState().redo();
  expect(useEditor.getState().segments.map((s) => s.id)).toEqual(["b"]);
});

test("applyFxPreset replaces fx; clearFx removes it", () => {
  useEditor.setState({ segments: [seg("a", 0, 2, { fx: { blur: 5 } })] });
  const noir = FX_PRESETS.find((p) => p.name === "Noir")!.fx;
  useEditor.getState().applyFxPreset("a", noir);
  expect(useEditor.getState().segments[0].fx).toEqual({ grayscale: true, contrast: 1.4 });
  useEditor.getState().clearFx("a");
  expect(useEditor.getState().segments[0].fx).toBeUndefined();
});

test("trimSegment clamps within source bounds and min length", () => {
  useEditor.setState({ assets: { a: asset("a", 5) }, segments: [seg("a", 1, 4)] });
  useEditor.getState().trimSegment("a", { out: 99 });
  expect(useEditor.getState().segments[0].out).toBeLessThanOrEqual(5);
  useEditor.getState().trimSegment("a", { in: 99 });
  expect(useEditor.getState().segments[0].in).toBeLessThan(useEditor.getState().segments[0].out);
});

test("sendToTrack to overlay seeds default transform", () => {
  useEditor.setState({ segments: [seg("a", 0, 3)] });
  useEditor.getState().sendToTrack("a", "overlay");
  const s = useEditor.getState().segments[0];
  expect(s.track).toBe("overlay");
  expect(s.oscale).toBeGreaterThan(0);
});

// ---------- separate-audio / multi-track integrity (regression) ----------

test("adding a separated audio track leaves the video timeline intact", () => {
  const s = useEditor.getState();
  s.addAsset(asset("v", 5, "video"));
  s.addSegmentForAsset("v");
  // separate-audio UI flow: add derived audio asset + its segment
  s.addAsset(asset("v_audio", 5, "audio"));
  s.addSegmentForAsset("v_audio");

  const st = useEditor.getState();
  expect(placeTrack(st.segments, "video").map((p) => [p.start, p.dur])).toEqual([[0, 5]]);
  expect(placeTrack(st.segments, "audio").map((p) => [p.start, p.dur])).toEqual([[0, 5]]);
  // video track duration unchanged; total = max(5,5)
  expect(timelineDuration(st.segments)).toBe(5);
  // export EDL is the video spine only and is still valid
  const edl = placeTrack(st.segments, "video");
  expect(edl.every((p) => p.out > p.in)).toBe(true);
});

test("splitting video after separate-audio does not touch the audio track", () => {
  const s = useEditor.getState();
  s.addAsset(asset("v", 6, "video"));
  s.addSegmentForAsset("v");
  s.addAsset(asset("v_audio", 6, "audio"));
  s.addSegmentForAsset("v_audio");
  s.setPlayhead(2);
  s.splitAtPlayhead();
  const st = useEditor.getState();
  expect(placeTrack(st.segments, "video")).toHaveLength(2);
  expect(placeTrack(st.segments, "audio")).toHaveLength(1); // untouched
});

test("removeAsset of the audio drops only audio segments", () => {
  const s = useEditor.getState();
  s.addAsset(asset("v", 5, "video"));
  s.addSegmentForAsset("v");
  s.addAsset(asset("v_audio", 5, "audio"));
  s.addSegmentForAsset("v_audio");
  s.removeAsset("v_audio");
  const st = useEditor.getState();
  expect(placeTrack(st.segments, "video")).toHaveLength(1);
  expect(placeTrack(st.segments, "audio")).toHaveLength(0);
  expect(st.assets["v_audio"]).toBeUndefined();
});

test("removeAsset of the video drops its segments but keeps the audio track", () => {
  const s = useEditor.getState();
  s.addAsset(asset("v", 5, "video"));
  s.addSegmentForAsset("v");
  s.addAsset(asset("v_audio", 5, "audio"));
  s.addSegmentForAsset("v_audio");
  s.removeAsset("v");
  const st = useEditor.getState();
  expect(placeTrack(st.segments, "video")).toHaveLength(0);
  expect(placeTrack(st.segments, "audio")).toHaveLength(1);
  expect(timelineDuration(st.segments)).toBe(5); // audio still defines length
});

test("zero-duration audio segment never matches locate (no NaN/crash)", () => {
  const segs = [seg("z", 0, 0, { track: "audio" }), seg("v", 0, 4)];
  expect(timelineDuration(segs)).toBe(4);
  expect(locate(placeTrack(segs, "audio"), 0)).toBeNull();
  expect(buildSnapPoints(segs, []).every((n) => Number.isFinite(n))).toBe(true);
});

test("reorder only touches segments of the same track", () => {
  useEditor.setState({
    segments: [seg("a", 0, 1), seg("b", 0, 1), seg("m", 0, 1, { track: "audio" })],
  });
  // move b before a; audio "m" relative order unaffected
  useEditor.getState().moveSegmentBefore("b", "a");
  const ids = useEditor.getState().segments.map((s) => s.id);
  expect(ids.indexOf("b")).toBeLessThan(ids.indexOf("a"));
  expect(ids).toContain("m");
});

test("marquee multi-select deletes all selected segments", () => {
  useEditor.setState({ segments: [seg("a", 0, 1), seg("b", 0, 1), seg("c", 0, 1)] });
  useEditor.getState().setSelection(["a", "c"]);
  expect(useEditor.getState().selectedIds).toEqual(["a", "c"]);
  expect(useEditor.getState().selectedSegmentId).toBe("a"); // primary
  useEditor.getState().deleteSelected();
  expect(useEditor.getState().segments.map((s) => s.id)).toEqual(["b"]);
  useEditor.getState().undo();
  expect(useEditor.getState().segments.map((s) => s.id)).toEqual(["a", "b", "c"]);
});

test("captions stay aligned after a split", () => {
  const s = useEditor.getState();
  s.addAsset(asset("v", 10, "video"));
  s.addSegmentForAsset("v");
  s.setCaptions("v", [{ start: 1, end: 2, text: "hi" }, { start: 6, end: 7, text: "bye" }]);
  s.setPlayhead(5);
  s.splitAtPlayhead(); // v -> [0-5],[5-10]
  const st = useEditor.getState();
  const pc = placeCaptions(st.segments, st.captions);
  // both captions still present, mapped onto timeline at their original times
  expect(pc.map((c) => c.text).sort()).toEqual(["bye", "hi"]);
  expect(pc.find((c) => c.text === "hi")!.tStart).toBeCloseTo(1);
  expect(pc.find((c) => c.text === "bye")!.tStart).toBeCloseTo(6);
});
