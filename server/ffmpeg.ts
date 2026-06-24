import { mkdir, readdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";

export interface ProbeResult {
  duration: number;
  width?: number;
  height?: number;
  fps?: number;
  vcodec?: string;
  acodec?: string;
  hasAudio: boolean;
}

async function run(cmd: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  return { code, stdout, stderr };
}

// Probe a media file via ffprobe -> normalized metadata.
export async function probe(path: string): Promise<ProbeResult> {
  const { code, stdout, stderr } = await run([
    "ffprobe", "-v", "error", "-print_format", "json",
    "-show_format", "-show_streams", path,
  ]);
  if (code !== 0) throw new Error("ffprobe failed: " + stderr);
  const data = JSON.parse(stdout);
  const streams: any[] = data.streams ?? [];
  const v = streams.find((s) => s.codec_type === "video");
  const a = streams.find((s) => s.codec_type === "audio");
  let fps: number | undefined;
  if (v?.r_frame_rate && v.r_frame_rate !== "0/0") {
    const [n, d] = v.r_frame_rate.split("/").map(Number);
    if (d) fps = +(n / d).toFixed(3);
  }
  const duration = Number(data.format?.duration ?? v?.duration ?? a?.duration ?? 0) || 0;
  return {
    duration,
    width: v?.width,
    height: v?.height,
    fps,
    vcodec: v?.codec_name,
    acodec: a?.codec_name,
    hasAudio: !!a,
  };
}

// Generate evenly-spaced JPG thumbnails for the timeline strip.
export async function thumbnails(
  path: string,
  outDir: string,
  duration: number,
  count = 12,
): Promise<string[]> {
  await mkdir(outDir, { recursive: true });
  const step = Math.max(duration / count, 0.001);
  // fps filter: one frame every `step` seconds, scaled to a small height.
  const { code, stderr } = await run([
    "ffmpeg", "-y", "-i", path,
    "-vf", `fps=1/${step},scale=-1:80`,
    "-frames:v", String(count),
    join(outDir, "thumb_%03d.jpg"),
  ]);
  if (code !== 0) throw new Error("thumbnail gen failed: " + stderr);
  const files = (await readdir(outDir)).filter((f) => f.endsWith(".jpg")).sort();
  return files;
}

// Extract audio to AAC (.m4a). Used by separate-audio.
export async function extractAudio(input: string, out: string): Promise<void> {
  const { code, stderr } = await run([
    "ffmpeg", "-y", "-i", input, "-vn", "-c:a", "aac", "-b:a", "192k", out,
  ]);
  if (code !== 0) throw new Error("extractAudio failed: " + stderr);
}

// Extract a time range [in, in+dur] of audio to m4a or mp3.
export async function extractAudioRange(
  input: string,
  out: string,
  start: number,
  dur: number,
  format: "m4a" | "mp3",
): Promise<void> {
  const codec = format === "mp3" ? ["-c:a", "libmp3lame", "-q:a", "2"] : ["-c:a", "aac", "-b:a", "192k"];
  const { code, stderr } = await run([
    "ffmpeg", "-y", "-ss", String(start), "-i", input, "-t", String(dur),
    "-vn", ...codec, out,
  ]);
  if (code !== 0) throw new Error("extractAudioRange failed: " + stderr);
}

export interface EdlSegment {
  src: string; // absolute path to source media
  in: number; // seconds
  out: number; // seconds
  muted?: boolean; // silence this segment's audio
  fadeIn?: number; // seconds — video+audio fade in
  fadeOut?: number; // seconds — video+audio fade out
  xfadeAfter?: number; // seconds — crossfade overlap into the NEXT segment
  fx?: {
    brightness?: number;
    contrast?: number;
    saturation?: number;
    grayscale?: boolean;
    blur?: number;
  };
}

// Build eq/gblur filter strings from an fx object.
function fxFilters(fx: EdlSegment["fx"]): string[] {
  if (!fx) return [];
  const f: string[] = [];
  const eq: string[] = [];
  if (fx.brightness) eq.push(`brightness=${fx.brightness}`);
  if (fx.contrast !== undefined && fx.contrast !== 1) eq.push(`contrast=${fx.contrast}`);
  const sat = fx.grayscale ? 0 : fx.saturation;
  if (sat !== undefined && sat !== 1) eq.push(`saturation=${sat}`);
  if (eq.length) f.push("eq=" + eq.join(":"));
  if (fx.blur) f.push(`gblur=sigma=${fx.blur}`);
  return f;
}

export interface OverlayItem {
  src: string;
  in: number; // source seconds
  out: number;
  tStart: number; // timeline seconds where it appears
  ox: number; // 0..1 center
  oy: number;
  oscale: number; // width fraction of frame
  animate?: boolean;
  ox2?: number;
  oy2?: number;
}

// Composite picture-in-picture overlays onto a finished base video.
async function compositeOverlays(
  baseFile: string,
  overlays: OverlayItem[],
  outPath: string,
): Promise<void> {
  const meta = await probe(baseFile);
  const W = meta.width ?? 1280;
  const inputs: string[] = ["-i", baseFile];
  for (const o of overlays) {
    inputs.push("-ss", String(o.in), "-t", String(Math.max(0.05, o.out - o.in)), "-i", o.src);
  }
  const filters: string[] = [];
  let base = "[0:v]";
  overlays.forEach((o, i) => {
    const k = i + 1;
    const ow = Math.max(2, Math.round((W * o.oscale) / 2) * 2);
    const dur = Math.max(0.05, o.out - o.in);
    const tEnd = o.tStart + dur;
    // Position expressions (linear interp start->end when animated). Commas escaped for filtergraph.
    const prog = `clip((t-${o.tStart})/${dur}\\,0\\,1)`;
    const xExpr =
      o.animate && o.ox2 !== undefined
        ? `(${o.ox}+(${o.ox2 - o.ox})*${prog})*W-w/2`
        : `${o.ox}*W-w/2`;
    const yExpr =
      o.animate && o.oy2 !== undefined
        ? `(${o.oy}+(${o.oy2 - o.oy})*${prog})*H-h/2`
        : `${o.oy}*H-h/2`;
    filters.push(`[${k}:v]scale=${ow}:-2,setpts=PTS-STARTPTS+${o.tStart}/TB[ov${k}]`);
    const next = `[b${k}]`;
    filters.push(
      `${base}[ov${k}]overlay=x=${xExpr}:y=${yExpr}:enable='between(t\\,${o.tStart}\\,${tEnd})'${next}`,
    );
    base = next;
  });
  const { code, stderr } = await run([
    "ffmpeg", "-y", ...inputs,
    "-filter_complex", filters.join(";"),
    "-map", base, "-map", "0:a?",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
    "-c:a", "aac", "-b:a", "192k",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart", outPath,
  ]);
  if (code !== 0) throw new Error("overlay composite failed: " + stderr.slice(-400));
}

// Build a single xfade+acrossfade chain over a run of parts joined by crossfades.
// durs[i] = part i duration; trans[i] = crossfade between part i and i+1 (len = parts-1).
async function xfadeChain(
  partFiles: string[],
  durs: number[],
  trans: number[],
  outPath: string,
): Promise<void> {
  const inputs: string[] = [];
  for (const f of partFiles) inputs.push("-i", f);
  const filters: string[] = [];
  // Normalize each input (fps/format/sar/tb) so xfade accepts them.
  for (let i = 0; i < partFiles.length; i++) {
    filters.push(`[${i}:v]settb=AVTB,fps=30,format=yuv420p,setsar=1[v${i}n]`);
  }
  let vlabel = "[v0n]";
  let alabel = "[0:a]";
  let acc = durs[0];
  for (let j = 1; j < partFiles.length; j++) {
    const d = Math.max(0.05, trans[j - 1]);
    const off = Math.max(0, acc - d);
    filters.push(`${vlabel}[v${j}n]xfade=transition=fade:duration=${d}:offset=${off}[vx${j}]`);
    filters.push(`${alabel}[${j}:a]acrossfade=d=${d}[ax${j}]`);
    vlabel = `[vx${j}]`;
    alabel = `[ax${j}]`;
    acc = acc + durs[j] - d;
  }
  const { code, stderr } = await run([
    "ffmpeg", "-y", ...inputs,
    "-filter_complex", filters.join(";"),
    "-map", vlabel, "-map", alabel,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
    "-c:a", "aac", "-b:a", "192k",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart", outPath,
  ]);
  if (code !== 0) throw new Error("xfade chain failed: " + stderr.slice(-400));
}

// Format seconds -> SRT timestamp HH:MM:SS,mmm
function srtTime(s: number): string {
  const ms = Math.round(s * 1000);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const sec = Math.floor((ms % 60000) / 1000);
  const milli = ms % 1000;
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(h)}:${p(m)}:${p(sec)},${p(milli, 3)}`;
}

export interface BurnCaption {
  start: number; // timeline seconds
  end: number;
  text: string;
}

export interface BurnText {
  text: string;
  start: number; // timeline seconds
  end: number;
  x: number; // 0..1
  y: number; // 0..1
  size: number; // px at 1080p reference
  color: string; // #RRGGBB
}

const TEXT_FONT =
  process.env.TEXT_FONT ?? "/System/Library/Fonts/Supplemental/Arial Bold.ttf";

// Escape a string for use inside a drawtext text='...' value.
function escDraw(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/%/g, "\\%")
    .replace(/\n/g, " ");
}

function drawtextFilters(texts: BurnText[]): string[] {
  return texts
    .filter((t) => t.text.trim().length)
    .map((t) => {
      const k = t.size / 1080; // fontsize = h*k
      const col = "0x" + (t.color || "#FFFFFF").replace("#", "");
      return [
        `drawtext=fontfile='${TEXT_FONT}'`,
        `text='${escDraw(t.text)}'`,
        `fontcolor=${col}`,
        `fontsize=(h*${k})`,
        `x=${t.x}*w-text_w/2`,
        `y=${t.y}*h-text_h/2`,
        `borderw=2:bordercolor=0x000000AA`,
        `enable='between(t\\,${t.start}\\,${t.end})'`,
      ].join(":");
    });
}

// Render an EDL: trim each segment, then concat. Re-encodes for safe concat.
// Optional burnSubs are burned into the final video (timeline-time SRT).
// onProgress receives 0..1 based on parsed ffmpeg `time=` vs total output duration.
export async function render(
  segments: EdlSegment[],
  outPath: string,
  tmpDir: string,
  onProgress?: (p: number) => void,
  burnSubs?: BurnCaption[],
  texts?: BurnText[],
  overlays?: OverlayItem[],
): Promise<void> {
  await mkdir(tmpDir, { recursive: true });
  const totalDur = segments.reduce((s, seg) => s + Math.max(0, seg.out - seg.in), 0);
  const parts: string[] = [];
  const durs: number[] = [];

  // 1. Trim each segment to its own normalized mp4 (uniform codec for concat).
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const part = join(tmpDir, `part_${String(i).padStart(3, "0")}.mp4`);
    const dur = Math.max(0, seg.out - seg.in);
    const args = [
      "ffmpeg", "-y",
      "-ss", String(seg.in), "-i", seg.src, "-t", String(dur),
    ];

    // Build video + audio filter chains for fades / mute.
    const fi = Math.min(seg.fadeIn ?? 0, dur);
    const fo = Math.min(seg.fadeOut ?? 0, dur);
    const vf: string[] = [...fxFilters(seg.fx)]; // color/blur before fades
    const af: string[] = [];
    if (fi > 0) {
      vf.push(`fade=t=in:st=0:d=${fi}`);
      af.push(`afade=t=in:st=0:d=${fi}`);
    }
    if (fo > 0) {
      vf.push(`fade=t=out:st=${Math.max(0, dur - fo)}:d=${fo}`);
      af.push(`afade=t=out:st=${Math.max(0, dur - fo)}:d=${fo}`);
    }
    if (seg.muted) af.push("volume=0"); // silence overrides audio fades
    if (vf.length) args.push("-vf", vf.join(","));
    if (af.length) args.push("-af", af.join(","));

    args.push(
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
      "-c:a", "aac", "-b:a", "192k",
      "-pix_fmt", "yuv420p", "-movflags", "+faststart", part,
    );
    const proc = Bun.spawn(args, { stdout: "ignore", stderr: "pipe" });
    await trackProgress(proc, totalDur, i, segments.length, onProgress);
    const code = await proc.exited;
    if (code !== 0) throw new Error(`render: segment ${i} failed`);
    parts.push(part);
    durs.push(dur);
  }

  // 2. Combine parts. Boundaries with xfadeAfter>0 crossfade; others hard-cut.
  // Partition into runs separated by hard cuts; xfade within a run, concat the runs.
  const trans = segments.map((s, i) =>
    i < segments.length - 1
      ? Math.min(s.xfadeAfter ?? 0, durs[i], durs[i + 1])
      : 0,
  );
  const hasOverlay = !!overlays?.length;
  const hasBurn = !!burnSubs?.length || !!texts?.length;
  const needFinal = hasOverlay || hasBurn;
  const concatOut = needFinal ? join(tmpDir, "concat.mp4") : outPath;

  if (trans.some((t) => t > 0)) {
    // Build groups of indices connected by crossfades.
    const groups: number[][] = [];
    let cur = [0];
    for (let i = 1; i < parts.length; i++) {
      if (trans[i - 1] > 0) cur.push(i);
      else {
        groups.push(cur);
        cur = [i];
      }
    }
    groups.push(cur);

    const groupFiles: string[] = [];
    for (let g = 0; g < groups.length; g++) {
      const idxs = groups[g];
      if (idxs.length === 1) {
        groupFiles.push(parts[idxs[0]]);
      } else {
        const gOut = join(tmpDir, `group_${g}.mp4`);
        await xfadeChain(
          idxs.map((i) => parts[i]),
          idxs.map((i) => durs[i]),
          idxs.slice(0, -1).map((i) => trans[i]),
          gOut,
        );
        groupFiles.push(gOut);
      }
    }

    const listFile = join(tmpDir, "concat.txt");
    await writeFile(listFile, groupFiles.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"));
    // Group files may differ in codec params after xfade re-encode → re-encode on concat.
    const { code, stderr } = await run([
      "ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", listFile,
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
      "-c:a", "aac", "-b:a", "192k",
      "-pix_fmt", "yuv420p", "-movflags", "+faststart", concatOut,
    ]);
    if (code !== 0) throw new Error("render: concat (xfade) failed: " + stderr.slice(-400));
  } else {
    // No crossfades — fast stream-copy concat.
    const listFile = join(tmpDir, "concat.txt");
    await writeFile(listFile, parts.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"));
    const { code, stderr } = await run([
      "ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", listFile,
      "-c", "copy", "-movflags", "+faststart", concatOut,
    ]);
    if (code !== 0) throw new Error("render: concat failed: " + stderr);
  }

  // 3. Optional PiP overlay composite.
  let cur = concatOut;
  if (hasOverlay) {
    const o = hasBurn ? join(tmpDir, "overlay.mp4") : outPath;
    await compositeOverlays(cur, overlays!, o);
    cur = o;
  }

  // 4. Optional final burn pass: subtitles (SRT) and/or text overlays (drawtext).
  if (hasBurn) {
    const vfParts: string[] = [];
    if (burnSubs?.length) {
      const srt = burnSubs
        .map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`)
        .join("\n");
      const srtPath = join(tmpDir, "subs.srt");
      await writeFile(srtPath, srt);
      const esc = srtPath.replace(/'/g, "\\'");
      vfParts.push(
        `subtitles='${esc}':force_style='FontName=Helvetica,FontSize=22,PrimaryColour=&H00FFFFFF,BackColour=&H80000000,BorderStyle=3,Outline=1'`,
      );
    }
    if (texts?.length) vfParts.push(...drawtextFilters(texts));

    const burn = await run([
      "ffmpeg", "-y", "-i", cur,
      "-vf", vfParts.join(","),
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
      "-c:a", "copy", "-movflags", "+faststart", outPath,
    ]);
    if (burn.code !== 0) throw new Error("render: burn pass failed: " + burn.stderr.slice(-400));
  }
  onProgress?.(1);

  await rm(tmpDir, { recursive: true, force: true });
}

// Parse ffmpeg stderr `time=HH:MM:SS.xx` to drive progress across N segments.
async function trackProgress(
  proc: ReturnType<typeof Bun.spawn>,
  totalDur: number,
  index: number,
  count: number,
  onProgress?: (p: number) => void,
): Promise<void> {
  if (!onProgress || !proc.stderr) return;
  const reader = (proc.stderr as ReadableStream<Uint8Array>).getReader();
  const dec = new TextDecoder();
  const base = index / count;
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const m = buf.match(/time=(\d+):(\d+):(\d+\.\d+)/g);
    if (m && m.length) {
      const last = m[m.length - 1];
      const t = last.match(/time=(\d+):(\d+):(\d+\.\d+)/)!;
      const secs = +t[1] * 3600 + +t[2] * 60 + +t[3];
      const frac = totalDur > 0 ? Math.min(secs / totalDur, 1) : 0;
      onProgress(Math.min(base + frac / count, 0.99));
      buf = buf.slice(-200);
    }
  }
}
