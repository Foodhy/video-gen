import { test, expect, beforeAll, afterAll } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { render } from "../server/ffmpeg.ts";

// Integration tests for the real ffmpeg render pipeline. Requires ffmpeg/ffprobe.
const DIR = join(import.meta.dir, "..", ".tmp-test");
const SRC = join(DIR, "src.mp4");

async function sh(cmd: string[]): Promise<{ code: number; out: string }> {
  const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
  const out = (await new Response(p.stdout).text()) + (await new Response(p.stderr).text());
  return { code: await p.exited, out };
}

async function duration(file: string): Promise<number> {
  const { out } = await sh(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file]);
  return parseFloat(out.trim());
}

async function meanVolume(file: string, ss: number, t: number): Promise<number> {
  const { out } = await sh(["ffmpeg", "-hide_banner", "-ss", String(ss), "-t", String(t), "-i", file, "-af", "volumedetect", "-f", "null", "/dev/null"]);
  const m = out.match(/mean_volume:\s*(-?[\d.]+) dB/);
  return m ? parseFloat(m[1]) : 0;
}

beforeAll(async () => {
  await mkdir(DIR, { recursive: true });
  // 6s test clip with a 440Hz tone.
  await sh([
    "ffmpeg", "-y",
    "-f", "lavfi", "-i", "testsrc=size=320x240:rate=30:duration=6",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=6",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", SRC,
  ]);
});

afterAll(async () => {
  await rm(DIR, { recursive: true, force: true });
});

test("render concatenates cut segments to the summed duration", async () => {
  const out = join(DIR, "cut.mp4");
  await render(
    [
      { src: SRC, in: 0, out: 2 },
      { src: SRC, in: 4, out: 6 },
    ],
    out,
    join(DIR, "t1"),
  );
  expect(await duration(out)).toBeCloseTo(4, 0); // within ~0.5s
}, 60000);

test("render silences a muted segment", async () => {
  const out = join(DIR, "mute.mp4");
  await render([{ src: SRC, in: 0, out: 4, muted: true }], out, join(DIR, "t2"));
  expect(await meanVolume(out, 0, 3)).toBeLessThan(-60); // ~silence
}, 60000);

test("render keeps audio for an unmuted segment", async () => {
  const out = join(DIR, "loud.mp4");
  await render([{ src: SRC, in: 0, out: 4 }], out, join(DIR, "t3"));
  expect(await meanVolume(out, 0, 3)).toBeGreaterThan(-40);
}, 60000);

test("render applies a crossfade (shortens by the overlap)", async () => {
  const out = join(DIR, "xf.mp4");
  await render(
    [
      { src: SRC, in: 0, out: 3, xfadeAfter: 1 },
      { src: SRC, in: 3, out: 6 },
    ],
    out,
    join(DIR, "t4"),
  );
  const d = await duration(out); // 3 + 3 - 1 = 5
  expect(d).toBeGreaterThan(4.5);
  expect(d).toBeLessThan(5.6);
}, 90000);
