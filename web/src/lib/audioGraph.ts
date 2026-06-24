// A lazy Web Audio monitoring graph: taps the player's media elements to show
// L/R levels and to monitor in stereo / mono / left / right. It does NOT change
// what gets exported — only what you hear/see while previewing.
export type MonitorMode = "stereo" | "mono" | "left" | "right";

let ctx: AudioContext | null = null;
let input: GainNode | null = null;
let meterSplit: ChannelSplitterNode | null = null;
let analyserL: AnalyserNode | null = null;
let analyserR: AnalyserNode | null = null;
let monSplit: ChannelSplitterNode | null = null;
let monMerge: ChannelMergerNode | null = null;
const registered = new WeakSet<HTMLMediaElement>();
let mode: MonitorMode = "stereo";

function ensure(): boolean {
  if (ctx) return true;
  const AC: typeof AudioContext =
    (window.AudioContext as any) || (window as any).webkitAudioContext;
  if (!AC) return false;
  ctx = new AC();
  input = ctx.createGain();
  // metering taps (pre-monitor) — per-channel analysers
  meterSplit = ctx.createChannelSplitter(2);
  analyserL = ctx.createAnalyser();
  analyserR = ctx.createAnalyser();
  analyserL.fftSize = 1024;
  analyserR.fftSize = 1024;
  input.connect(meterSplit);
  meterSplit.connect(analyserL, 0);
  meterSplit.connect(analyserR, 1);
  // monitor path -> destination
  monSplit = ctx.createChannelSplitter(2);
  monMerge = ctx.createChannelMerger(2);
  input.connect(monSplit);
  monMerge.connect(ctx.destination);
  wire();
  return true;
}

function wire() {
  if (!monSplit || !monMerge) return;
  try {
    monSplit.disconnect();
  } catch {
    /* noop */
  }
  const s = monSplit, m = monMerge;
  if (mode === "stereo") {
    s.connect(m, 0, 0);
    s.connect(m, 1, 1);
  } else if (mode === "mono") {
    s.connect(m, 0, 0);
    s.connect(m, 1, 0);
    s.connect(m, 0, 1);
    s.connect(m, 1, 1);
  } else if (mode === "left") {
    s.connect(m, 0, 0);
    s.connect(m, 0, 1);
  } else {
    s.connect(m, 1, 0);
    s.connect(m, 1, 1);
  }
}

// Route a media element into the graph (once). Resumes the context.
export function registerElement(el: HTMLMediaElement | null) {
  if (!el || !ensure() || registered.has(el)) return;
  try {
    const src = ctx!.createMediaElementSource(el);
    src.connect(input!);
    registered.add(el);
  } catch {
    /* element already bound elsewhere */
  }
}

export function resume() {
  ctx?.resume().catch(() => {});
}

export function setMonitorMode(m: MonitorMode) {
  mode = m;
  wire();
}

// RMS level per channel (0..1).
export function getLevels(): { l: number; r: number } {
  const read = (a: AnalyserNode | null) => {
    if (!a) return 0;
    const buf = new Float32Array(a.fftSize);
    a.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    return Math.min(1, Math.sqrt(sum / buf.length) * 1.6);
  };
  return { l: read(analyserL), r: read(analyserR) };
}

export function isActive(): boolean {
  return !!ctx;
}
