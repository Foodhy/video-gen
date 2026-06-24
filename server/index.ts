import { join, basename, extname } from "node:path";
import { mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import {
  createProject, loadProject, saveProject, resolveMedia, newClipId, listProjects,
  sourceDir, derivedDir, thumbsDir, outputDir, projectDir,
  type ClipMeta,
} from "./workspace.ts";
import {
  probe, thumbnails, extractAudio, extractAudioRange, render,
  type EdlSegment, type BurnCaption, type BurnText,
} from "./ffmpeg.ts";
import { createJob, getJob, updateJob } from "./jobs.ts";
import { transcribe, modelAvailable } from "./transcribe.ts";
import { translateLines, translateAvailable } from "./translate.ts";

const PORT = Number(process.env.PORT ?? 8787);
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const bad = (msg: string, status = 400) => json({ error: msg }, status);

const MIME: Record<string, string> = {
  ".mp4": "video/mp4", ".mov": "video/quicktime", ".m4v": "video/x-m4v",
  ".webm": "video/webm", ".mkv": "video/x-matroska",
  ".m4a": "audio/mp4", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".aac": "audio/aac",
  ".jpg": "image/jpeg", ".png": "image/png",
};
const mimeFor = (p: string) => MIME[extname(p).toLowerCase()] ?? "application/octet-stream";

// Range-aware file serving so <video> can scrub.
async function serveFile(path: string, req: Request): Promise<Response> {
  const file = Bun.file(path);
  const size = file.size;
  const type = mimeFor(path);
  const range = req.headers.get("range");
  if (range) {
    const m = range.match(/bytes=(\d*)-(\d*)/);
    if (m) {
      let start = m[1] ? parseInt(m[1], 10) : 0;
      let end = m[2] ? parseInt(m[2], 10) : size - 1;
      if (isNaN(start)) start = 0;
      if (isNaN(end) || end >= size) end = size - 1;
      if (start > end) return new Response("Range Not Satisfiable", { status: 416 });
      return new Response(file.slice(start, end + 1), {
        status: 206,
        headers: {
          "content-type": type,
          "content-range": `bytes ${start}-${end}/${size}`,
          "accept-ranges": "bytes",
          "content-length": String(end - start + 1),
        },
      });
    }
  }
  return new Response(file, {
    headers: { "content-type": type, "accept-ranges": "bytes", "content-length": String(size) },
  });
}

const server = Bun.serve({
  port: PORT,
  idleTimeout: 255,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;
    try {
      // ---- API ----
      if (path === "/api/projects" && req.method === "POST") {
        const p = await createProject();
        return json({ projectId: p.id });
      }

      if (path === "/api/projects" && req.method === "GET") {
        return json({ projects: await listProjects() });
      }

      if (path === "/api/import" && req.method === "POST") {
        return await handleImport(req);
      }

      const docMatch = path.match(/^\/api\/project\/([^/]+)\/doc$/);
      if (docMatch && req.method === "PUT") {
        const project = await loadProject(docMatch[1]);
        if (!project) return bad("project not found", 404);
        project.doc = await req.json();
        await saveProject(project);
        return json({ ok: true });
      }

      const clipDelMatch = path.match(/^\/api\/project\/([^/]+)\/clip\/([^/]+)$/);
      if (clipDelMatch && req.method === "DELETE") {
        const [, pid, cid] = clipDelMatch;
        const project = await loadProject(pid);
        if (!project) return bad("project not found", 404);
        const clip = project.clips.find((c) => c.id === cid);
        if (!clip) return bad("clip not found", 404);
        // Remove media file + thumbnails from disk (best-effort).
        const abs = resolveMedia(pid, clip.file);
        if (abs) await rm(abs, { force: true });
        await rm(thumbsDir(pid, cid), { recursive: true, force: true });
        project.clips = project.clips.filter((c) => c.id !== cid);
        await saveProject(project);
        return json({ ok: true });
      }

      const projMatch = path.match(/^\/api\/project\/([^/]+)$/);
      if (projMatch && req.method === "GET") {
        const project = await loadProject(projMatch[1]);
        if (!project) return bad("project not found", 404);
        const assets = project.clips.map((c) => ({
          ...c,
          mediaUrl: `/media/${project.id}/${c.file}`,
          thumbs: (c.thumbs ?? []).map((n) => `/media/${project.id}/thumbs/${c.id}/${n}`),
        }));
        return json({ projectId: project.id, assets, doc: project.doc ?? null });
      }

      if (path === "/api/separate-audio" && req.method === "POST") {
        return await handleSeparateAudio(req);
      }

      if (path === "/api/extract-audio" && req.method === "POST") {
        return await handleExtractAudio(req);
      }

      if (path === "/api/export" && req.method === "POST") {
        return await handleExport(req);
      }

      if (path === "/api/transcribe" && req.method === "POST") {
        return await handleTranscribe(req);
      }

      if (path === "/api/translate" && req.method === "POST") {
        return await handleTranslate(req);
      }

      if (path === "/api/capabilities" && req.method === "GET") {
        return json({ transcribe: modelAvailable(), translate: translateAvailable() });
      }

      const jobMatch = path.match(/^\/api\/job\/([^/]+)$/);
      if (jobMatch && req.method === "GET") {
        const j = getJob(jobMatch[1]);
        return j ? json(j) : bad("job not found", 404);
      }

      // ---- media streaming: /media/<projectId>/<...file> ----
      const mediaMatch = path.match(/^\/media\/([^/]+)\/(.+)$/);
      if (mediaMatch && req.method === "GET") {
        const [, projectId, file] = mediaMatch;
        const abs = resolveMedia(projectId, decodeURIComponent(file));
        if (!abs || !existsSync(abs)) return bad("not found", 404);
        return await serveFile(abs, req);
      }

      // ---- static SPA (production build) ----
      if (req.method === "GET") {
        const dist = join(import.meta.dir, "..", "dist");
        let f = join(dist, path === "/" ? "index.html" : path.slice(1));
        if (!existsSync(f) || !Bun.file(f).size) f = join(dist, "index.html");
        if (existsSync(f)) return new Response(Bun.file(f));
      }

      return bad("not found", 404);
    } catch (err: any) {
      console.error(err);
      return bad(err?.message ?? "server error", 500);
    }
  },
});

console.log(`[server] http://localhost:${server.port}`);

// ----- handlers -----

async function handleImport(req: Request): Promise<Response> {
  const form = await req.formData();
  let projectId = String(form.get("projectId") ?? "");
  const upload = form.get("file");
  if (!(upload instanceof File)) return bad("missing file");

  let project = projectId ? await loadProject(projectId) : null;
  if (!project) project = await createProject();
  projectId = project.id;

  const safeName = basename(upload.name).replace(/[^\w.\- ]+/g, "_");
  const clipId = newClipId();
  const fileName = `${clipId}_${safeName}`;
  const dest = join(sourceDir(projectId), fileName);
  await mkdir(sourceDir(projectId), { recursive: true });
  await Bun.write(dest, upload);

  const meta = await probe(dest);
  const clip: ClipMeta = {
    id: clipId,
    name: safeName,
    file: join("source", fileName),
    kind: "video",
    duration: meta.duration,
    width: meta.width,
    height: meta.height,
    fps: meta.fps,
    vcodec: meta.vcodec,
    acodec: meta.acodec,
    hasAudio: meta.hasAudio,
    size: upload.size,
  };
  // Generate thumbnails (best-effort; don't fail import if it errors).
  let thumbs: string[] = [];
  try {
    const tdir = thumbsDir(projectId, clipId);
    const names = await thumbnails(dest, tdir, meta.duration, 12);
    clip.thumbs = names;
    thumbs = names.map((n) => `/media/${projectId}/thumbs/${clipId}/${n}`);
  } catch (e) {
    console.warn("thumbnail gen failed:", e);
  }

  project.clips.push(clip);
  await saveProject(project);

  return json({
    projectId,
    clip,
    mediaUrl: `/media/${projectId}/${clip.file}`,
    thumbs,
  });
}

async function handleSeparateAudio(req: Request): Promise<Response> {
  const { projectId, clipId } = (await req.json()) as { projectId: string; clipId: string };
  const project = await loadProject(projectId);
  if (!project) return bad("project not found", 404);
  const src = project.clips.find((c) => c.id === clipId);
  if (!src) return bad("clip not found", 404);
  if (!src.hasAudio) return bad("clip has no audio track");

  const srcAbs = resolveMedia(projectId, src.file)!;
  const audioId = newClipId();
  const audioName = `${audioId}_${src.name.replace(/\.[^.]+$/, "")}.m4a`;
  await mkdir(derivedDir(projectId), { recursive: true });
  const out = join(derivedDir(projectId), audioName);
  await extractAudio(srcAbs, out);

  const audioMeta = await probe(out);
  const clip: ClipMeta = {
    id: audioId,
    name: src.name.replace(/\.[^.]+$/, "") + " — audio",
    file: join("derived", audioName),
    kind: "audio",
    duration: audioMeta.duration,
    acodec: audioMeta.acodec,
    hasAudio: true,
    size: Bun.file(out).size,
  };
  project.clips.push(clip);
  await saveProject(project);

  return json({ clip, mediaUrl: `/media/${projectId}/${clip.file}` });
}

async function handleExtractAudio(req: Request): Promise<Response> {
  const { projectId, clipId, in: inSec, out: outSec, format } = (await req.json()) as {
    projectId: string;
    clipId: string;
    in: number;
    out: number;
    format?: "m4a" | "mp3";
  };
  const project = await loadProject(projectId);
  if (!project) return bad("project not found", 404);
  const clip = project.clips.find((c) => c.id === clipId);
  if (!clip) return bad("clip not found", 404);
  if (!clip.hasAudio) return bad("clip has no audio");

  const srcAbs = resolveMedia(projectId, clip.file)!;
  const fmt = format === "mp3" ? "mp3" : "m4a";
  const base = clip.name.replace(/\.[^.]+$/, "");
  const stamp = Math.random().toString(36).slice(2, 8);
  const name = `${base}_${inSec.toFixed(1)}-${outSec.toFixed(1)}_${stamp}.${fmt}`;
  await mkdir(outputDir(projectId), { recursive: true });
  const outAbs = join(outputDir(projectId), name);
  await extractAudioRange(srcAbs, outAbs, inSec, Math.max(0.05, outSec - inSec), fmt);

  return json({ file: `/media/${projectId}/output/${name}`, name });
}

interface ExportBody {
  projectId: string;
  edl: {
    clipId: string;
    in: number;
    out: number;
    muted?: boolean;
    fadeIn?: number;
    fadeOut?: number;
    xfadeAfter?: number;
    fx?: EdlSegment["fx"];
  }[];
  burnSubtitles?: BurnCaption[];
  texts?: BurnText[];
}

async function handleExport(req: Request): Promise<Response> {
  const { projectId, edl, burnSubtitles, texts } = (await req.json()) as ExportBody;
  const project = await loadProject(projectId);
  if (!project) return bad("project not found", 404);
  if (!edl?.length) return bad("empty timeline");

  const segments: EdlSegment[] = [];
  for (const s of edl) {
    const clip = project.clips.find((c) => c.id === s.clipId);
    if (!clip) return bad("clip not found in edl: " + s.clipId);
    if (clip.kind !== "video") continue; // export uses the video track as the spine
    const abs = resolveMedia(projectId, clip.file)!;
    segments.push({
      src: abs,
      in: s.in,
      out: s.out,
      muted: s.muted,
      fadeIn: s.fadeIn,
      fadeOut: s.fadeOut,
      xfadeAfter: s.xfadeAfter,
      fx: s.fx,
    });
  }
  if (!segments.length) return bad("no video segments to export");

  const job = createJob();
  const stamp = job.id;
  await mkdir(outputDir(projectId), { recursive: true });
  const outName = `export_${stamp}.mp4`;
  const outAbs = join(outputDir(projectId), outName);
  const tmp = join(projectDir(projectId), "tmp_" + stamp);

  // Run render async; client polls /api/job/:id.
  (async () => {
    try {
      await render(
        segments, outAbs, tmp,
        (p) => updateJob(job.id, { progress: p }),
        burnSubtitles, texts,
      );
      updateJob(job.id, {
        status: "done",
        progress: 1,
        outputFile: `/media/${projectId}/output/${outName}`,
        outputPath: outAbs,
      });
    } catch (e: any) {
      updateJob(job.id, { status: "error", error: e?.message ?? String(e) });
    }
  })();

  return json({ jobId: job.id });
}

async function handleTranscribe(req: Request): Promise<Response> {
  if (!modelAvailable()) return bad("whisper model not installed", 503);
  const { projectId, clipId, language, translate } = (await req.json()) as {
    projectId: string;
    clipId: string;
    language?: string;
    translate?: boolean;
  };
  const project = await loadProject(projectId);
  if (!project) return bad("project not found", 404);
  const clip = project.clips.find((c) => c.id === clipId);
  if (!clip) return bad("clip not found", 404);
  if (!clip.hasAudio) return bad("clip has no audio to transcribe");

  const abs = resolveMedia(projectId, clip.file)!;
  const work = join(projectDir(projectId), "transcribe_" + clipId);
  await mkdir(work, { recursive: true });
  const result = await transcribe(abs, work, { language, translate });
  return json({
    clipId,
    captions: result.captions,
    language: result.language,
    translated: !!translate,
  });
}

interface TranslateBody {
  from: string;
  to: string;
  lines: string[];
}

async function handleTranslate(req: Request): Promise<Response> {
  if (!translateAvailable()) return bad("translation not available", 503);
  const { from, to, lines } = (await req.json()) as TranslateBody;
  if (!to || !Array.isArray(lines)) return bad("missing target language or lines");
  const out = await translateLines(from ?? "en", to, lines);
  return json({ lines: out });
}
