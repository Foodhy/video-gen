import { test, expect, beforeAll, afterAll } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

// HTTP integration tests: spin up the real server on a test port and drive the
// import -> separate-audio -> export flow that the UI uses.
const PORT = 8911;
const BASE = `http://localhost:${PORT}`;
const DIR = join(import.meta.dir, "..", ".tmp-test-srv");
const SRC = join(DIR, "clip.mp4");
let proc: ReturnType<typeof Bun.spawn> | null = null;

async function sh(cmd: string[]) {
  const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
  await p.exited;
}

async function waitReady(ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(BASE + "/api/capabilities");
      if (r.ok) return;
    } catch {}
    await Bun.sleep(150);
  }
  throw new Error("server did not start");
}

beforeAll(async () => {
  await mkdir(DIR, { recursive: true });
  await sh([
    "ffmpeg", "-y",
    "-f", "lavfi", "-i", "testsrc=size=320x240:rate=30:duration=5",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=5",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", SRC,
  ]);
  proc = Bun.spawn(["bun", join(import.meta.dir, "..", "server", "index.ts")], {
    env: { ...process.env, PORT: String(PORT) },
    stdout: "ignore",
    stderr: "ignore",
  });
  await waitReady();
});

afterAll(async () => {
  proc?.kill();
  await rm(DIR, { recursive: true, force: true });
});

async function importClip(projectId?: string) {
  const fd = new FormData();
  fd.append("file", new Blob([await Bun.file(SRC).arrayBuffer()], { type: "video/mp4" }), "clip.mp4");
  if (projectId) fd.append("projectId", projectId);
  const r = await fetch(BASE + "/api/import", { method: "POST", body: fd });
  expect(r.ok).toBe(true);
  return r.json();
}

test("separate-audio then export still works (timeline not broken)", async () => {
  const imp = await importClip();
  const pid = imp.projectId;
  const videoClip = imp.clip.id;

  // Separate audio — adds an audio asset/clip to the project.
  const sep = await fetch(BASE + "/api/separate-audio", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId: pid, clipId: videoClip }),
  });
  expect(sep.ok).toBe(true);
  const sepBody = await sep.json();
  expect(sepBody.clip.kind).toBe("audio");
  expect(sepBody.clip.duration).toBeGreaterThan(0);

  // Project reload must include both clips and stay loadable.
  const proj = await (await fetch(`${BASE}/api/project/${pid}`)).json();
  expect(proj.assets.length).toBe(2);

  // Export the video EDL (audio track is the editing spine via V1) — must succeed.
  const exp = await fetch(BASE + "/api/export", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId: pid, edl: [{ clipId: videoClip, in: 0, out: 3 }] }),
  });
  expect(exp.ok).toBe(true);
  const { jobId } = await exp.json();

  let job: any;
  for (let i = 0; i < 80; i++) {
    job = await (await fetch(`${BASE}/api/job/${jobId}`)).json();
    if (job.status !== "running") break;
    await Bun.sleep(200);
  }
  expect(job.status).toBe("done");
}, 60000);

test("extract section audio returns a downloadable file", async () => {
  const imp = await importClip();
  const r = await fetch(BASE + "/api/extract-audio", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId: imp.projectId, clipId: imp.clip.id, in: 1, out: 3, format: "m4a" }),
  });
  expect(r.ok).toBe(true);
  const { file } = await r.json();
  const media = await fetch(BASE + file);
  expect(media.ok).toBe(true);
}, 60000);
