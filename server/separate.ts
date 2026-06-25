import { join, basename } from "node:path";
import { existsSync } from "node:fs";
import { mkdir, readdir } from "node:fs/promises";

// Offline audio source separation (split a mix into stems). Multiple selectable
// engines, run through the project venv — same "optional offline feature that
// degrades gracefully" pattern as transcribe.ts (whisper) and translate.ts.
//
//   demucs          — Meta htdemucs (PyTorch). 4 stems: vocals/drums/bass/other.
//                     Best for musical material. Model downloads on first run.
//   audio-separator — UVR/MDX (onnxruntime). 2 stems: vocals/instrumental.
//                     Best for isolating voice from everything else (SFX+music).
//
// Each engine produces a different set of stems in a different output layout;
// separateStems() normalizes both to a { stemName -> wavPath } map.

const ROOT = join(import.meta.dir, "..");
const VENV_BIN = join(ROOT, ".venv", "bin");
const PY = process.env.SEPARATE_PYTHON ??
  (existsSync(join(VENV_BIN, "python")) ? join(VENV_BIN, "python") : "python3");

export type Engine = "demucs" | "audio-separator";

function binPath(name: string): string | null {
  const p = join(VENV_BIN, name);
  return existsSync(p) ? p : null;
}

// Each engine ships a console script in the venv when pip-installed.
export function separateCapabilities(): Record<Engine, boolean> {
  return { demucs: !!binPath("demucs"), "audio-separator": !!binPath("audio-separator") };
}

async function runTool(cmd: string[]): Promise<void> {
  const p = Bun.spawn(cmd, { stdout: "ignore", stderr: "pipe" });
  const stderr = await new Response(p.stderr).text();
  const code = await p.exited;
  if (code !== 0) throw new Error(`${basename(cmd[0])} failed: ` + stderr.slice(-500));
}

// Separate `input` into stems. Returns { stemName -> absolute wav path }.
// demucs → vocals/drums/bass/other; audio-separator → vocals/instrumental.
export async function separateStems(
  input: string,
  outDir: string,
  engine: Engine,
): Promise<Record<string, string>> {
  await mkdir(outDir, { recursive: true });
  const base = basename(input).replace(/\.[^.]+$/, "");
  const result: Record<string, string> = {};

  if (engine === "demucs") {
    const bin = binPath("demucs");
    const cmd = bin ? [bin] : [PY, "-m", "demucs"];
    cmd.push("-n", "htdemucs", "-o", outDir, input);
    await runTool(cmd);
    const stemDir = join(outDir, "htdemucs", base); // outDir/htdemucs/<base>/<stem>.wav
    for (const stem of ["vocals", "drums", "bass", "other"]) {
      const wav = join(stemDir, stem + ".wav");
      if (existsSync(wav)) result[stem] = wav;
    }
  } else {
    const bin = binPath("audio-separator") ?? "audio-separator";
    // Default roformer model → two files named "<base>_(Vocals)_<model>.wav" etc.
    await runTool([bin, input, "--output_dir", outDir, "--output_format", "WAV"]);
    for (const f of await readdir(outDir)) {
      const low = f.toLowerCase();
      if (!low.endsWith(".wav")) continue;
      const stem = low.includes("vocal")
        ? "vocals"
        : low.includes("instrument") || low.includes("no_vocal")
          ? "instrumental"
          : null;
      if (stem && !result[stem]) result[stem] = join(outDir, f);
    }
  }

  if (!Object.keys(result).length) throw new Error(`${engine} produced no stems`);
  return result;
}
