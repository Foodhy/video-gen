import { log } from "./logger.ts";

// Wrapped fetch: logs method, url, status, latency, and network failures into
// the in-app Console so errors are visible without opening DevTools/Network.
async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? "GET").toUpperCase();
  const t0 = performance.now();
  try {
    const res = await fetch(input, init);
    const ms = Math.round(performance.now() - t0);
    if (res.ok) {
      log("debug", "api", `${method} ${input} → ${res.status}`, `${ms}ms`);
    } else {
      log("error", "api", `${method} ${input} → ${res.status} ${res.statusText}`, `${ms}ms`);
    }
    return res;
  } catch (e: any) {
    const ms = Math.round(performance.now() - t0);
    log(
      "error",
      "api",
      `${method} ${input} → network error: ${e?.message ?? e}`,
      `${ms}ms — is the server running? (default http://localhost:8787)`,
    );
    throw e;
  }
}

export interface ClipMeta {
  id: string;
  name: string;
  file: string;
  kind: "video" | "audio";
  duration: number;
  width?: number;
  height?: number;
  fps?: number;
  vcodec?: string;
  acodec?: string;
  hasAudio: boolean;
  size: number;
}

export interface ImportResult {
  projectId: string;
  clip: ClipMeta;
  mediaUrl: string;
  thumbs: string[];
}

export async function importFile(file: File, projectId?: string): Promise<ImportResult> {
  const fd = new FormData();
  fd.append("file", file);
  if (projectId) fd.append("projectId", projectId);
  const res = await apiFetch("/api/import", { method: "POST", body: fd });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "import failed");
  return res.json();
}

export async function separateAudio(
  projectId: string,
  clipId: string,
): Promise<{ clip: ClipMeta; mediaUrl: string }> {
  const res = await apiFetch("/api/separate-audio", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId, clipId }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "separate failed");
  return res.json();
}

export type SeparateEngine = "demucs" | "spleeter";

// Kick off stem separation (returns a jobId; poll getJob, read job.clips on done).
export async function separateStems(
  projectId: string,
  clipId: string,
  engine: SeparateEngine,
): Promise<string> {
  const res = await apiFetch("/api/separate-stems", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId, clipId, engine }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "separate failed");
  return (await res.json()).jobId;
}

export interface ExportEdlItem {
  clipId: string;
  in: number;
  out: number;
  speed?: number;
  volume?: number;
  muted?: boolean;
  fadeIn?: number;
  fadeOut?: number;
  xfadeAfter?: number;
  fx?: {
    brightness?: number;
    contrast?: number;
    saturation?: number;
    grayscale?: boolean;
    blur?: number;
  };
}

export interface TextOverlayItem {
  text: string;
  start: number;
  end: number;
  x: number;
  y: number;
  size: number;
  color: string;
}

export interface OverlayExportItem {
  clipId: string;
  in: number;
  out: number;
  tStart: number;
  ox: number;
  oy: number;
  oscale: number;
  animate?: boolean;
  ox2?: number;
  oy2?: number;
}

export async function startExport(
  projectId: string,
  edl: ExportEdlItem[],
  burnSubtitles?: CaptionLine[],
  texts?: TextOverlayItem[],
  overlays?: OverlayExportItem[],
  audioTrack?: ExportEdlItem[],
): Promise<string> {
  const res = await apiFetch("/api/export", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId, edl, burnSubtitles, texts, overlays, audioTrack }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "export failed");
  return (await res.json()).jobId;
}

export interface JobState {
  id: string;
  status: "running" | "done" | "error";
  progress: number;
  outputFile?: string;
  outputPath?: string;
  clips?: (ClipMeta & { mediaUrl: string })[];
  error?: string;
}

export interface ProjectSummary {
  id: string;
  createdAt: number;
  clipCount: number;
  name: string;
  dir: string;
}

export async function listProjects(): Promise<{ projects: ProjectSummary[]; root: string }> {
  const res = await apiFetch("/api/projects");
  if (!res.ok) return { projects: [], root: "" };
  const j = await res.json();
  return { projects: j.projects ?? [], root: j.root ?? "" };
}

export async function deleteProject(id: string): Promise<void> {
  const res = await apiFetch("/api/project/" + id, { method: "DELETE" });
  if (!res.ok) throw new Error("delete project failed");
}

export interface ProjectSettings {
  name?: string;
  width?: number;
  height?: number;
  fps?: number;
}

export async function createProject(settings?: ProjectSettings): Promise<string> {
  const res = await apiFetch("/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(settings ?? {}),
  });
  if (!res.ok) throw new Error("create project failed");
  return (await res.json()).projectId;
}

export interface LoadedProject {
  projectId: string;
  assets: (ClipMeta & { mediaUrl: string; thumbs: string[] })[];
  doc: unknown | null;
}

export async function loadProject(projectId: string): Promise<LoadedProject | null> {
  const res = await apiFetch("/api/project/" + projectId);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("load failed");
  return res.json();
}

export async function deleteClip(projectId: string, clipId: string): Promise<void> {
  const res = await apiFetch(`/api/project/${projectId}/clip/${clipId}`, { method: "DELETE" });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "delete failed");
}

export async function extractAudioRange(
  projectId: string,
  clipId: string,
  inSec: number,
  outSec: number,
  format: "m4a" | "mp3" = "m4a",
): Promise<{ file: string; name: string }> {
  const res = await apiFetch("/api/extract-audio", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId, clipId, in: inSec, out: outSec, format }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "extract failed");
  return res.json();
}

export async function saveDoc(projectId: string, doc: unknown): Promise<void> {
  await apiFetch(`/api/project/${projectId}/doc`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(doc),
  });
}

export async function getPeaks(projectId: string, clipId: string): Promise<number[]> {
  const res = await apiFetch(`/api/peaks/${projectId}/${clipId}`);
  if (!res.ok) return [];
  return (await res.json()).peaks ?? [];
}

export async function getJob(jobId: string): Promise<JobState> {
  const res = await apiFetch("/api/job/" + jobId);
  if (!res.ok) throw new Error("job poll failed");
  return res.json();
}

export interface CaptionLine {
  start: number;
  end: number;
  text: string;
}

export interface Capabilities {
  transcribe: boolean;
  translate: boolean;
  separate: { demucs: boolean; spleeter: boolean };
}

export async function getCapabilities(): Promise<Capabilities> {
  const fallback: Capabilities = {
    transcribe: false,
    translate: false,
    separate: { demucs: false, spleeter: false },
  };
  try {
    const res = await apiFetch("/api/capabilities");
    if (!res.ok) return fallback;
    return { ...fallback, ...(await res.json()) };
  } catch {
    return fallback;
  }
}

export async function transcribe(
  projectId: string,
  clipId: string,
  opts: { language?: string; translate?: boolean } = {},
): Promise<{ captions: CaptionLine[]; language: string; translated: boolean }> {
  const res = await apiFetch("/api/transcribe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId, clipId, ...opts }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "transcribe failed");
  return res.json();
}

export async function translateLines(
  from: string,
  to: string,
  lines: string[],
): Promise<string[]> {
  const res = await apiFetch("/api/translate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ from, to, lines }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "translate failed");
  return (await res.json()).lines;
}
