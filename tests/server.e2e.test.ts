import { test, expect, beforeAll, afterAll } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

// HTTP integration tests: spin up the real server on a test port and drive the
// import -> separate-audio -> export flow that the UI uses.
const PORT = 8911;
const BASE = `http://localhost:${PORT}`;
const DIR = join(import.meta.dir, "..", ".tmp-test-srv");
const SRC = join(DIR, "clip.mp4");
const RED = join(DIR, "red.mp4");
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
  await sh([
    "ffmpeg", "-y", "-f", "lavfi", "-i", "color=c=red:s=160x120:d=4",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", RED,
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

async function importClip(projectId?: string, path = SRC) {
  const fd = new FormData();
  const name = path.split("/").pop()!;
  fd.append("file", new Blob([await Bun.file(path).arrayBuffer()], { type: "video/mp4" }), name);
  if (projectId) fd.append("projectId", projectId);
  const r = await fetch(BASE + "/api/import", { method: "POST", body: fd });
  expect(r.ok).toBe(true);
  return r.json();
}

// Run an export body, poll to completion, download the result locally, return its path.
async function exportToFile(body: object, name: string): Promise<string> {
  const { jobId } = await (await fetch(BASE + "/api/export", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })).json();
  let job: any;
  for (let i = 0; i < 100; i++) {
    job = await (await fetch(`${BASE}/api/job/${jobId}`)).json();
    if (job.status !== "running") break;
    await Bun.sleep(200);
  }
  expect(job.status).toBe("done");
  const local = join(DIR, name);
  await Bun.write(local, await (await fetch(BASE + job.outputFile)).arrayBuffer());
  return local;
}

// Region luma/chroma via signalstats. crop = ffmpeg crop expr or "" for full frame.
async function frameStat(file: string, ss: number, crop: string): Promise<Record<string, number>> {
  const vf = (crop ? crop + "," : "") + "signalstats,metadata=print:file=-";
  const p = Bun.spawn(["ffmpeg", "-hide_banner", "-ss", String(ss), "-i", file, "-frames:v", "1", "-vf", vf, "-f", "null", "/dev/null"], { stdout: "pipe", stderr: "pipe" });
  const out = (await new Response(p.stdout).text()) + (await new Response(p.stderr).text());
  await p.exited;
  const g = (k: string) => {
    const m = out.match(new RegExp(`lavfi\\.signalstats\\.${k}=([\\d.]+)`));
    return m ? parseFloat(m[1]) : NaN;
  };
  return { Y: g("YAVG"), SAT: g("SATAVG"), V: g("VAVG") };
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

async function meanVolume(file: string, ss: number, t: number): Promise<number> {
  const p = Bun.spawn(
    ["ffmpeg", "-hide_banner", "-ss", String(ss), "-t", String(t), "-i", file, "-af", "volumedetect", "-f", "null", "/dev/null"],
    { stdout: "pipe", stderr: "pipe" },
  );
  const out = (await new Response(p.stderr).text()) + (await new Response(p.stdout).text());
  await p.exited;
  const m = out.match(/mean_volume:\s*(-?[\d.]+) dB/);
  return m ? parseFloat(m[1]) : 0;
}

test("A1 audio track replaces video audio on export (muted A1 -> silent)", async () => {
  const imp = await importClip();
  const pid = imp.projectId;
  const videoClip = imp.clip.id;
  const sep = await (await fetch(BASE + "/api/separate-audio", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId: pid, clipId: videoClip }),
  })).json();
  const audioClip = sep.clip.id;

  // Export: video has a 440Hz tone, but the A1 track (muted) is authoritative.
  const exp = await (await fetch(BASE + "/api/export", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      projectId: pid,
      edl: [{ clipId: videoClip, in: 0, out: 3 }],
      audioTrack: [{ clipId: audioClip, in: 0, out: 3, muted: true }],
    }),
  })).json();
  let job: any;
  for (let i = 0; i < 80; i++) {
    job = await (await fetch(`${BASE}/api/job/${exp.jobId}`)).json();
    if (job.status !== "running") break;
    await Bun.sleep(200);
  }
  expect(job.status).toBe("done");
  const local = join(DIR, "a1muted.mp4");
  await Bun.write(local, await (await fetch(BASE + job.outputFile)).arrayBuffer());
  expect(await meanVolume(local, 0, 3)).toBeLessThan(-60); // A1 muted -> silence wins
}, 90000);

test("export burns a text overlay (drawtext)", async () => {
  const imp = await importClip();
  const out = await exportToFile(
    {
      projectId: imp.projectId,
      edl: [{ clipId: imp.clip.id, in: 0, out: 4 }],
      texts: [{ text: "HELLO WORLD", start: 1, end: 3, x: 0.5, y: 0.5, size: 120, color: "#FFFFFF" }],
    },
    "text.mp4",
  );
  // Center strip is brighter while the white title is on screen.
  const withText = (await frameStat(out, 2, "crop=iw:ih/4:0:ih*0.4")).Y;
  const noText = (await frameStat(out, 3.8, "crop=iw:ih/4:0:ih*0.4")).Y;
  expect(withText).toBeGreaterThan(noText);
}, 90000);

test("export composites a PiP overlay at its position/time", async () => {
  const imp = await importClip();
  const ov = await importClip(imp.projectId, RED);
  const out = await exportToFile(
    {
      projectId: imp.projectId,
      edl: [{ clipId: imp.clip.id, in: 0, out: 5 }],
      overlays: [{ clipId: ov.clip.id, in: 0, out: 3, tStart: 0, ox: 0.8, oy: 0.2, oscale: 0.3 }],
    },
    "pip.mp4",
  );
  // Red PiP present top-right while active (t=1), gone after it ends (t=4).
  const active = (await frameStat(out, 1, "crop=iw*0.3:ih*0.3:iw*0.7:0")).V;
  const gone = (await frameStat(out, 4, "crop=iw*0.3:ih*0.3:iw*0.7:0")).V;
  expect(active).toBeGreaterThan(gone + 20); // red => high V chroma
}, 90000);

test("export animates an overlay from left to right", async () => {
  const imp = await importClip();
  const ov = await importClip(imp.projectId, RED);
  const out = await exportToFile(
    {
      projectId: imp.projectId,
      edl: [{ clipId: imp.clip.id, in: 0, out: 4 }],
      overlays: [{ clipId: ov.clip.id, in: 0, out: 3, tStart: 0, ox: 0.2, oy: 0.5, oscale: 0.25, animate: true, ox2: 0.8, oy2: 0.5 }],
    },
    "anim.mp4",
  );
  const earlyLeft = (await frameStat(out, 0.3, "crop=iw*0.3:ih:0:0")).V;
  const earlyRight = (await frameStat(out, 0.3, "crop=iw*0.3:ih:iw*0.7:0")).V;
  const lateLeft = (await frameStat(out, 2.6, "crop=iw*0.3:ih:0:0")).V;
  const lateRight = (await frameStat(out, 2.6, "crop=iw*0.3:ih:iw*0.7:0")).V;
  expect(earlyLeft).toBeGreaterThan(earlyRight); // red on the left early
  expect(lateRight).toBeGreaterThan(lateLeft); // red on the right late
}, 90000);

test("export bakes a grayscale effect (saturation ~0)", async () => {
  const imp = await importClip();
  const out = await exportToFile(
    {
      projectId: imp.projectId,
      edl: [{ clipId: imp.clip.id, in: 0, out: 3, fx: { grayscale: true } }],
    },
    "gray.mp4",
  );
  expect((await frameStat(out, 1, "")).SAT).toBeLessThan(5);
}, 90000);

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
