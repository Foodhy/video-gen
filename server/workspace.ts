import { mkdir, readFile, writeFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

// All work lives under ./workspace/<projectId>/. Nothing leaves the machine.
export const ROOT = resolve(import.meta.dir, "..", "workspace");

export interface ClipMeta {
  id: string;
  name: string;
  file: string; // relative filename inside source/ or derived/
  kind: "video" | "audio";
  duration: number; // seconds
  width?: number;
  height?: number;
  fps?: number;
  vcodec?: string;
  acodec?: string;
  hasAudio: boolean;
  size: number;
  thumbs?: string[]; // relative thumb filenames (under thumbs/<id>/)
}

export interface Project {
  id: string;
  createdAt: number;
  clips: ClipMeta[];
  doc?: unknown; // opaque editor document (segments, captions) — owned by client
}

function rid(prefix: string): string {
  return prefix + "_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function projectDir(projectId: string): string {
  return join(ROOT, projectId);
}
export function sourceDir(projectId: string): string {
  return join(projectDir(projectId), "source");
}
export function derivedDir(projectId: string): string {
  return join(projectDir(projectId), "derived");
}
export function thumbsDir(projectId: string, clipId: string): string {
  return join(projectDir(projectId), "thumbs", clipId);
}
export function outputDir(projectId: string): string {
  return join(projectDir(projectId), "output");
}

// Resolve a media path and guard against path traversal outside the project.
export function resolveMedia(projectId: string, file: string): string | null {
  const base = projectDir(projectId);
  const p = resolve(base, file);
  if (!p.startsWith(base + "/") && p !== base) return null;
  return p;
}

const metaPath = (id: string) => join(projectDir(id), "project.json");

export async function createProject(): Promise<Project> {
  const id = rid("proj");
  const project: Project = { id, createdAt: Date.now(), clips: [] };
  await mkdir(sourceDir(id), { recursive: true });
  await mkdir(derivedDir(id), { recursive: true });
  await mkdir(outputDir(id), { recursive: true });
  await saveProject(project);
  return project;
}

export async function loadProject(id: string): Promise<Project | null> {
  if (!existsSync(metaPath(id))) return null;
  return JSON.parse(await readFile(metaPath(id), "utf8")) as Project;
}

export async function saveProject(p: Project): Promise<void> {
  await writeFile(metaPath(p.id), JSON.stringify(p, null, 2));
}

export function newClipId(): string {
  return rid("clip");
}

export interface ProjectSummary {
  id: string;
  createdAt: number;
  clipCount: number;
  name: string; // first clip name, or "Untitled"
  dir: string; // absolute storage path
}

// List all projects, newest first.
export async function listProjects(): Promise<ProjectSummary[]> {
  if (!existsSync(ROOT)) return [];
  const entries = await readdir(ROOT);
  const out: ProjectSummary[] = [];
  for (const id of entries) {
    const meta = metaPath(id);
    if (!existsSync(meta)) continue;
    try {
      const p = JSON.parse(await readFile(meta, "utf8")) as Project;
      out.push({
        id: p.id,
        createdAt: p.createdAt ?? (await stat(meta)).mtimeMs,
        clipCount: p.clips.length,
        name: p.clips.find((c) => c.kind === "video")?.name ?? p.clips[0]?.name ?? "Untitled",
        dir: projectDir(id),
      });
    } catch {
      /* skip corrupt project.json */
    }
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}
