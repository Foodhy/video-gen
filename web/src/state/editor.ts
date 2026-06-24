import { create } from "zustand";
import type { ClipMeta } from "../lib/api.ts";

export interface Asset extends ClipMeta {
  mediaUrl: string;
  thumbs: string[];
}

export type TrackKind = "video" | "audio" | "overlay";

// A timeline segment references a portion [in,out] of a source asset.
// Segments on a track are laid end-to-end in array order, starting at t=0.
export interface Segment {
  id: string;
  clipId: string;
  track: TrackKind;
  in: number; // source seconds
  out: number; // source seconds
  muted?: boolean; // silence this segment's audio (preview + export)
  fadeIn?: number; // seconds — fade from black + audio fade-in at segment start
  fadeOut?: number; // seconds — fade to black + audio fade-out at segment end
  xfadeAfter?: number; // seconds — crossfade overlap into the next video segment
  fx?: Fx; // color/blur effects
  ox?: number; // overlay center x 0..1 (overlay track only)
  oy?: number; // overlay center y 0..1
  oscale?: number; // overlay width as fraction of frame (0..1)
  animate?: boolean; // animate overlay position from (ox,oy) -> (ox2,oy2) over the segment
  ox2?: number; // overlay end center x
  oy2?: number; // overlay end center y
}

// Visual effects. Defaults: brightness 0, contrast 1, saturation 1, blur 0.
export interface Fx {
  brightness?: number; // -1..1
  contrast?: number; // 0..2
  saturation?: number; // 0..2
  grayscale?: boolean;
  blur?: number; // px / sigma 0..20
}

export interface PlacedSegment extends Segment {
  start: number; // timeline seconds (computed)
  dur: number;
}

// A transcribed subtitle line, in SOURCE time of its clip.
export interface Caption {
  id: string;
  start: number; // source seconds
  end: number;
  text: string;
}

// A caption mapped onto timeline time through the EDL.
export interface PlacedCaption extends Caption {
  tStart: number;
  tEnd: number;
}

// A free text/title overlay, positioned in timeline time + relative coords.
export interface TextClip {
  id: string;
  text: string;
  start: number; // timeline seconds
  end: number;
  x: number; // 0..1 (center) relative to video box
  y: number; // 0..1
  size: number; // px at 1080p reference height
  color: string; // hex
}

interface EditorState {
  projectId: string | null;
  assets: Record<string, Asset>;
  segments: Segment[];
  selectedAssetId: string | null;
  selectedSegmentId: string | null;
  selectedIds: string[]; // multi-selection (marquee); selectedSegmentId is the primary
  playhead: number; // timeline seconds
  playing: boolean;
  pxPerSec: number;
  captions: Record<string, Caption[]>; // keyed by clipId, in source time
  captionLang: Record<string, string>; // language code per clip's captions
  texts: TextClip[];
  selectedTextId: string | null;
  snapEnabled: boolean;
  showCaptions: boolean;
  logs: LogEntry[];
  showLogs: boolean;
  past: HistoryDoc[];
  future: HistoryDoc[];
  toast: { msg: string; err?: boolean } | null;

  setProject: (id: string) => void;
  resetTo: (projectId: string) => void;
  hydrate: (data: {
    assets: Asset[];
    segments?: Segment[];
    captions?: Record<string, Caption[]>;
    captionLang?: Record<string, string>;
    texts?: TextClip[];
  }) => void;
  addAsset: (a: Asset) => void;
  removeAsset: (assetId: string) => void;
  addSegmentForAsset: (assetId: string) => void;
  selectAsset: (id: string | null) => void;
  selectSegment: (id: string | null) => void;
  setSelection: (ids: string[]) => void;
  splitAtPlayhead: () => void;
  trimSegment: (id: string, patch: { in?: number; out?: number }) => void;
  deleteSegment: (id: string) => void;
  deleteSelected: () => void;
  duplicateSegment: (id: string) => void;
  moveSegmentBefore: (id: string, beforeId: string | null) => void;
  sendToTrack: (id: string, track: TrackKind) => void;
  setOverlayTransform: (
    id: string,
    patch: { ox?: number; oy?: number; oscale?: number; ox2?: number; oy2?: number; animate?: boolean },
  ) => void;
  toggleMute: (id: string) => void;
  setFade: (id: string, patch: { fadeIn?: number; fadeOut?: number }) => void;
  setXfade: (id: string, secs: number) => void;
  setFx: (id: string, patch: Partial<Fx>) => void;
  applyFxPreset: (id: string, fx: Fx | undefined) => void;
  clearFx: (id: string) => void;
  setPlayhead: (t: number) => void;
  setPlaying: (p: boolean) => void;
  setZoom: (px: number) => void;
  setCaptions: (
    clipId: string,
    caps: { start: number; end: number; text: string }[],
    lang?: string,
  ) => void;
  updateCaptionText: (clipId: string, capId: string, text: string) => void;
  clearCaptions: (clipId: string) => void;
  toggleCaptions: () => void;
  addText: () => void;
  updateText: (id: string, patch: Partial<Omit<TextClip, "id">>) => void;
  deleteText: (id: string) => void;
  selectText: (id: string | null) => void;
  toggleSnap: () => void;
  pushLog: (e: Omit<LogEntry, "id" | "ts">) => void;
  clearLogs: () => void;
  toggleLogs: () => void;
  record: () => void; // snapshot current doc into undo history
  undo: () => void;
  redo: () => void;
  showToast: (msg: string, err?: boolean) => void;
}

export interface HistoryDoc {
  segments: Segment[];
  captions: Record<string, Caption[]>;
  captionLang: Record<string, string>;
  texts: TextClip[];
  assets: Record<string, Asset>;
}

export type LogLevel = "debug" | "info" | "success" | "warn" | "error";

export interface LogEntry {
  id: number;
  ts: number; // epoch ms
  level: LogLevel;
  source: string; // e.g. "api", "import", "export"
  msg: string;
  detail?: string;
}

let segCounter = 0;
const segId = () => "seg" + ++segCounter + "_" + Math.random().toString(36).slice(2, 6);
let logCounter = 0;
let txtCounter = 0;

// Snapshot only the persistable/undoable doc fields.
function snapDoc(s: {
  segments: Segment[];
  captions: Record<string, Caption[]>;
  captionLang: Record<string, string>;
  texts: TextClip[];
  assets: Record<string, Asset>;
}): HistoryDoc {
  return {
    segments: s.segments,
    captions: s.captions,
    captionLang: s.captionLang,
    texts: s.texts,
    assets: s.assets,
  };
}

export interface EditorDoc {
  segments: Segment[];
  captions: Record<string, Caption[]>;
  captionLang: Record<string, string>;
  texts: TextClip[];
}

// Serialize the persistable editor document (excludes media URLs/runtime UI).
export function serializeDoc(s: {
  segments: Segment[];
  captions: Record<string, Caption[]>;
  captionLang: Record<string, string>;
  texts: TextClip[];
}): EditorDoc {
  return {
    segments: s.segments,
    captions: s.captions,
    captionLang: s.captionLang,
    texts: s.texts,
  };
}

// Lay segments of a track end-to-end and compute start/dur.
export function placeTrack(segments: Segment[], track: TrackKind): PlacedSegment[] {
  const onTrack = segments.filter((s) => s.track === track);
  const out: PlacedSegment[] = [];
  let t = 0;
  for (let i = 0; i < onTrack.length; i++) {
    const s = onTrack[i];
    const dur = Math.max(0, s.out - s.in);
    out.push({ ...s, start: t, dur });
    // Crossfade with next segment overlaps the timeline by the transition duration.
    const nextDur = onTrack[i + 1] ? onTrack[i + 1].out - onTrack[i + 1].in : 0;
    const x = i < onTrack.length - 1 ? Math.min(s.xfadeAfter ?? 0, dur, nextDur) : 0;
    t += dur - x;
  }
  return out;
}

export function trackDuration(segments: Segment[], track: TrackKind): number {
  return placeTrack(segments, track).reduce((s, p) => s + p.dur, 0);
}

// Timeline positions worth snapping to: clip + text edges, plus 0.
export function buildSnapPoints(segments: Segment[], texts: TextClip[]): number[] {
  const pts = new Set<number>([0]);
  for (const track of ["video", "audio", "overlay"] as const) {
    for (const p of placeTrack(segments, track)) {
      pts.add(+p.start.toFixed(3));
      pts.add(+(p.start + p.dur).toFixed(3));
    }
  }
  for (const t of texts) {
    pts.add(+t.start.toFixed(3));
    pts.add(+t.end.toFixed(3));
  }
  return [...pts].sort((a, b) => a - b);
}

// Snap a value to the nearest candidate within threshold (returns value unchanged if none).
export function snapValue(v: number, points: number[], threshold: number): number {
  let best = v;
  let bestD = threshold;
  for (const p of points) {
    const d = Math.abs(p - v);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

export function timelineDuration(segments: Segment[]): number {
  return Math.max(
    trackDuration(segments, "video"),
    trackDuration(segments, "audio"),
    trackDuration(segments, "overlay"),
    0,
  );
}

// Map captions (source time) onto timeline time through the video EDL.
// A caption shows only while the playhead is over a segment of its clip that
// actually covers the caption's source range (so cuts hide cut-out captions).
export function placeCaptions(
  segments: Segment[],
  captions: Record<string, Caption[]>,
): PlacedCaption[] {
  const placed = placeTrack(segments, "video");
  const out: PlacedCaption[] = [];
  for (const seg of placed) {
    const caps = captions[seg.clipId];
    if (!caps) continue;
    for (const c of caps) {
      const s = Math.max(c.start, seg.in);
      const e = Math.min(c.end, seg.out);
      if (e <= s) continue; // caption falls outside this trimmed segment
      out.push({
        ...c,
        tStart: seg.start + (s - seg.in),
        tEnd: seg.start + (e - seg.in),
      });
    }
  }
  return out.sort((a, b) => a.tStart - b.tStart);
}

// Overlay center position at timeline time t (lerps start->end if animated).
export function overlayPosAt(
  seg: PlacedSegment,
  t: number,
): { x: number; y: number } {
  const x0 = seg.ox ?? 0.5;
  const y0 = seg.oy ?? 0.5;
  if (!seg.animate) return { x: x0, y: y0 };
  const p = seg.dur > 0 ? Math.max(0, Math.min(1, (t - seg.start) / seg.dur)) : 0;
  return {
    x: x0 + ((seg.ox2 ?? x0) - x0) * p,
    y: y0 + ((seg.oy2 ?? y0) - y0) * p,
  };
}

export function captionAt(placed: PlacedCaption[], t: number): PlacedCaption | null {
  return placed.find((c) => t >= c.tStart && t < c.tEnd) ?? null;
}

// Build a CSS `filter` string from Fx (for live preview on the <video>).
export function fxToCss(fx: Fx | undefined): string {
  if (!fx) return "none";
  const parts: string[] = [];
  if (fx.brightness) parts.push(`brightness(${1 + fx.brightness})`);
  if (fx.contrast !== undefined && fx.contrast !== 1) parts.push(`contrast(${fx.contrast})`);
  if (fx.saturation !== undefined && fx.saturation !== 1) parts.push(`saturate(${fx.saturation})`);
  if (fx.grayscale) parts.push("grayscale(1)");
  if (fx.blur) parts.push(`blur(${fx.blur}px)`);
  return parts.length ? parts.join(" ") : "none";
}

// One-click color looks (built on the same Fx engine: CSS preview + ffmpeg eq).
export const FX_PRESETS: { name: string; fx: Fx | undefined }[] = [
  { name: "None", fx: undefined },
  { name: "Cinematic", fx: { contrast: 1.25, saturation: 1.1, brightness: -0.05 } },
  { name: "Warm", fx: { saturation: 1.25, brightness: 0.06, contrast: 1.05 } },
  { name: "Cold", fx: { saturation: 0.8, brightness: -0.04, contrast: 1.1 } },
  { name: "Vivid", fx: { saturation: 1.6, contrast: 1.2 } },
  { name: "Vintage", fx: { saturation: 0.6, contrast: 0.9, brightness: 0.05 } },
  { name: "Noir", fx: { grayscale: true, contrast: 1.4 } },
  { name: "B&W", fx: { grayscale: true } },
  { name: "Dreamy", fx: { blur: 2, brightness: 0.08, saturation: 1.15 } },
];

export function hasFx(fx: Fx | undefined): boolean {
  if (!fx) return false;
  return !!(
    fx.brightness ||
    fx.grayscale ||
    fx.blur ||
    (fx.contrast !== undefined && fx.contrast !== 1) ||
    (fx.saturation !== undefined && fx.saturation !== 1)
  );
}

// Map timeline time -> active placed segment on a track + source time.
export function locate(
  placed: PlacedSegment[],
  t: number,
): { seg: PlacedSegment; srcTime: number } | null {
  for (const p of placed) {
    if (p.dur > 0 && t >= p.start && t < p.start + p.dur) {
      return { seg: p, srcTime: p.in + (t - p.start) };
    }
  }
  // Past the end: clamp to the last NON-degenerate segment (hold its last frame).
  // Zero-duration segments must never match (would freeze the player).
  for (let i = placed.length - 1; i >= 0; i--) {
    if (placed[i].dur > 0) {
      return t >= placed[i].start + placed[i].dur ? { seg: placed[i], srcTime: placed[i].out } : null;
    }
  }
  return null;
}

export const useEditor = create<EditorState>((set, get) => ({
  projectId: null,
  assets: {},
  segments: [],
  selectedAssetId: null,
  selectedSegmentId: null,
  selectedIds: [],
  playhead: 0,
  playing: false,
  captions: {},
  captionLang: {},
  texts: [],
  selectedTextId: null,
  snapEnabled: true,
  showCaptions: true,
  logs: [],
  showLogs: false,
  past: [],
  future: [],
  pxPerSec: 80,
  toast: null,

  setProject: (id) => set({ projectId: id }),

  resetTo: (projectId) =>
    set({
      projectId,
      assets: {},
      segments: [],
      captions: {},
      captionLang: {},
      texts: [],
      selectedTextId: null,
      selectedAssetId: null,
      selectedSegmentId: null,
      selectedIds: [],
      playhead: 0,
      playing: false,
      past: [],
      future: [],
    }),

  hydrate: ({ assets, segments, captions, captionLang, texts }) =>
    set({
      assets: Object.fromEntries(assets.map((a) => [a.id, a])),
      segments: segments ?? [],
      captions: captions ?? {},
      captionLang: captionLang ?? {},
      texts: texts ?? [],
      selectedTextId: null,
      selectedSegmentId: null,
      selectedIds: [],
      selectedAssetId: assets[0]?.id ?? null,
      playhead: 0,
      playing: false,
      past: [],
      future: [],
    }),

  addAsset: (a) =>
    set((s) => ({ assets: { ...s.assets, [a.id]: a }, selectedAssetId: a.id })),

  removeAsset: (assetId) => {
    get().record();
    set((s) => {
      const assets = { ...s.assets };
      delete assets[assetId];
      const captions = { ...s.captions };
      delete captions[assetId];
      const captionLang = { ...s.captionLang };
      delete captionLang[assetId];
      return {
        assets,
        captions,
        captionLang,
        segments: s.segments.filter((seg) => seg.clipId !== assetId),
        selectedAssetId: s.selectedAssetId === assetId ? null : s.selectedAssetId,
        selectedSegmentId: null,
      };
    });
  },

  addSegmentForAsset: (assetId) => {
    get().record();
    set((s) => {
      const a = s.assets[assetId];
      if (!a) return s;
      const seg: Segment = {
        id: segId(),
        clipId: a.id,
        track: a.kind,
        in: 0,
        out: a.duration,
      };
      return { segments: [...s.segments, seg], selectedSegmentId: seg.id };
    });
  },

  selectAsset: (id) => set({ selectedAssetId: id }),
  selectSegment: (id) =>
    set({ selectedSegmentId: id, selectedIds: id ? [id] : [], selectedTextId: null }),
  setSelection: (ids) =>
    set({ selectedIds: ids, selectedSegmentId: ids[0] ?? null, selectedTextId: null }),

  splitAtPlayhead: () => {
    const t0 = get().playhead;
    const placed0 = placeTrack(get().segments, "video");
    if (!placed0.find((p) => t0 > p.start + 0.02 && t0 < p.start + p.dur - 0.02)) return;
    get().record();
    set((s) => {
      const t = s.playhead;
      const placed = placeTrack(s.segments, "video");
      const hit = placed.find((p) => t > p.start + 0.02 && t < p.start + p.dur - 0.02);
      if (!hit) return s;
      const cut = hit.in + (t - hit.start);
      const left: Segment = { ...hit, id: segId(), in: hit.in, out: cut };
      const right: Segment = { ...hit, id: segId(), in: cut, out: hit.out };
      const idx = s.segments.findIndex((x) => x.id === hit.id);
      const next = [...s.segments];
      next.splice(idx, 1, left, right);
      return { segments: next, selectedSegmentId: right.id };
    });
  },

  trimSegment: (id, patch) =>
    set((s) => ({
      segments: s.segments.map((seg) => {
        if (seg.id !== id) return seg;
        const ni = patch.in ?? seg.in;
        const no = patch.out ?? seg.out;
        // keep at least 0.1s and within source bounds
        const a = get().assets[seg.clipId];
        const max = a ? a.duration : no;
        const inn = Math.max(0, Math.min(ni, no - 0.1));
        const outt = Math.min(max, Math.max(no, inn + 0.1));
        return { ...seg, in: inn, out: outt };
      }),
    })),

  deleteSegment: (id) => {
    get().record();
    set((s) => ({
      segments: s.segments.filter((x) => x.id !== id),
      selectedSegmentId: s.selectedSegmentId === id ? null : s.selectedSegmentId,
    }));
  },

  deleteSelected: () => {
    const ids = new Set(get().selectedIds.length ? get().selectedIds : [get().selectedSegmentId]);
    if (ids.size === 0 || (ids.size === 1 && ids.has(null as any))) return;
    get().record();
    set((s) => ({
      segments: s.segments.filter((x) => !ids.has(x.id)),
      selectedSegmentId: null,
      selectedIds: [],
    }));
  },

  duplicateSegment: (id) => {
    get().record();
    set((s) => {
      const idx = s.segments.findIndex((x) => x.id === id);
      if (idx < 0) return s;
      const copy: Segment = { ...s.segments[idx], id: segId() };
      const next = [...s.segments];
      next.splice(idx + 1, 0, copy);
      return { segments: next, selectedSegmentId: copy.id };
    });
  },

  moveSegmentBefore: (id, beforeId) => {
    if (id === beforeId) return;
    get().record();
    set((s) => {
      const arr = [...s.segments];
      const from = arr.findIndex((x) => x.id === id);
      if (from < 0) return s;
      const [item] = arr.splice(from, 1);
      let to = beforeId ? arr.findIndex((x) => x.id === beforeId) : arr.length;
      if (to < 0) to = arr.length;
      arr.splice(to, 0, item);
      return { segments: arr, selectedSegmentId: id };
    });
  },

  sendToTrack: (id, track) => {
    get().record();
    set((s) => ({
      segments: s.segments.map((x) => {
        if (x.id !== id) return x;
        const base = { ...x, track };
        // Give overlays sensible defaults the first time.
        if (track === "overlay") {
          return {
            ...base,
            ox: x.ox ?? 0.5,
            oy: x.oy ?? 0.5,
            oscale: x.oscale ?? 0.4,
            xfadeAfter: 0, // crossfade not meaningful on overlay
          };
        }
        return base;
      }),
      selectedSegmentId: id,
    }));
  },
  setOverlayTransform: (id, patch) => {
    get().record();
    const c01 = (v: number) => Math.max(0, Math.min(1, v));
    set((s) => ({
      segments: s.segments.map((x) => {
        if (x.id !== id) return x;
        const next = { ...x };
        if (patch.ox !== undefined) next.ox = c01(patch.ox);
        if (patch.oy !== undefined) next.oy = c01(patch.oy);
        if (patch.oscale !== undefined) next.oscale = Math.max(0.05, Math.min(1, patch.oscale));
        if (patch.ox2 !== undefined) next.ox2 = c01(patch.ox2);
        if (patch.oy2 !== undefined) next.oy2 = c01(patch.oy2);
        if (patch.animate !== undefined) {
          next.animate = patch.animate;
          // Seed end position from start the first time animation is enabled.
          if (patch.animate && next.ox2 === undefined) {
            next.ox2 = next.ox ?? 0.5;
            next.oy2 = next.oy ?? 0.5;
          }
        }
        return next;
      }),
    }));
  },

  toggleMute: (id) => {
    get().record();
    set((s) => ({
      segments: s.segments.map((x) => (x.id === id ? { ...x, muted: !x.muted } : x)),
    }));
  },

  setFade: (id, patch) => {
    get().record();
    set((s) => ({
      segments: s.segments.map((x) => {
        if (x.id !== id) return x;
        const dur = x.out - x.in;
        const clamp = (v: number | undefined) =>
          v === undefined ? undefined : Math.max(0, Math.min(v, dur));
        return {
          ...x,
          fadeIn: patch.fadeIn !== undefined ? clamp(patch.fadeIn) : x.fadeIn,
          fadeOut: patch.fadeOut !== undefined ? clamp(patch.fadeOut) : x.fadeOut,
        };
      }),
    }));
  },

  setXfade: (id, secs) => {
    get().record();
    set((s) => ({
      segments: s.segments.map((x) =>
        x.id === id ? { ...x, xfadeAfter: Math.max(0, Math.min(secs, x.out - x.in)) } : x,
      ),
    }));
  },

  setFx: (id, patch) => {
    get().record();
    set((s) => ({
      segments: s.segments.map((x) => (x.id === id ? { ...x, fx: { ...x.fx, ...patch } } : x)),
    }));
  },
  applyFxPreset: (id, fx) => {
    get().record();
    set((s) => ({
      segments: s.segments.map((x) => (x.id === id ? { ...x, fx: fx ? { ...fx } : undefined } : x)),
    }));
  },
  clearFx: (id) => {
    get().record();
    set((s) => ({
      segments: s.segments.map((x) => (x.id === id ? { ...x, fx: undefined } : x)),
    }));
  },

  setPlayhead: (t) => set({ playhead: Math.max(0, t) }),
  setPlaying: (p) => set({ playing: p }),
  setZoom: (px) => set({ pxPerSec: Math.max(10, Math.min(400, px)) }),

  setCaptions: (clipId, caps, lang) => {
    get().record();
    set((s) => ({
      captions: {
        ...s.captions,
        [clipId]: caps.map((c, i) => ({ id: clipId + "_c" + i, ...c })),
      },
      captionLang: lang ? { ...s.captionLang, [clipId]: lang } : s.captionLang,
      showCaptions: true,
    }));
  },
  updateCaptionText: (clipId, capId, text) =>
    set((s) => ({
      captions: {
        ...s.captions,
        [clipId]: (s.captions[clipId] ?? []).map((c) => (c.id === capId ? { ...c, text } : c)),
      },
    })),
  clearCaptions: (clipId) => {
    get().record();
    set((s) => {
      const next = { ...s.captions };
      delete next[clipId];
      return { captions: next };
    });
  },
  toggleCaptions: () => set((s) => ({ showCaptions: !s.showCaptions })),

  addText: () => {
    get().record();
    set((s) => {
      const total = timelineDuration(s.segments);
      const start = Math.min(s.playhead, Math.max(0, total - 0.5));
      const txt: TextClip = {
        id: "txt" + ++txtCounter + "_" + Math.random().toString(36).slice(2, 6),
        text: "TITLE",
        start,
        end: Math.min(start + 3, total || start + 3),
        x: 0.5,
        y: 0.5,
        size: 64,
        color: "#F5F0E8",
      };
      return { texts: [...s.texts, txt], selectedTextId: txt.id, selectedSegmentId: null };
    });
  },
  updateText: (id, patch) =>
    set((s) => ({ texts: s.texts.map((t) => (t.id === id ? { ...t, ...patch } : t)) })),
  deleteText: (id) => {
    get().record();
    set((s) => ({
      texts: s.texts.filter((t) => t.id !== id),
      selectedTextId: s.selectedTextId === id ? null : s.selectedTextId,
    }));
  },
  selectText: (id) => set({ selectedTextId: id, selectedSegmentId: null }),
  toggleSnap: () => set((s) => ({ snapEnabled: !s.snapEnabled })),

  pushLog: (e) =>
    set((s) => {
      logCounter += 1;
      const entry: LogEntry = { id: logCounter, ts: Date.now(), ...e };
      const logs = s.logs.length >= 500 ? [...s.logs.slice(-499), entry] : [...s.logs, entry];
      return { logs };
    }),
  clearLogs: () => set({ logs: [] }),
  toggleLogs: () => set((s) => ({ showLogs: !s.showLogs })),

  record: () => set((s) => ({ past: [...s.past, snapDoc(s)].slice(-100), future: [] })),
  undo: () =>
    set((s) => {
      if (!s.past.length) return s;
      const prev = s.past[s.past.length - 1];
      return {
        ...prev,
        past: s.past.slice(0, -1),
        future: [snapDoc(s), ...s.future].slice(0, 100),
        selectedSegmentId: null,
      };
    }),
  redo: () =>
    set((s) => {
      if (!s.future.length) return s;
      const next = s.future[0];
      return {
        ...next,
        past: [...s.past, snapDoc(s)].slice(-100),
        future: s.future.slice(1),
        selectedSegmentId: null,
      };
    }),

  showToast: (msg, err) => {
    set({ toast: { msg, err } });
    setTimeout(() => {
      if (get().toast?.msg === msg) set({ toast: null });
    }, 3200);
  },
}));
