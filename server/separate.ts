import { join, basename } from "node:path";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";

// Offline audio source separation (split a mix into stems: voice / drums /
// bass / other). Multiple selectable engines, run through the project venv —
// same "optional offline feature that degrades gracefully" pattern as
// transcribe.ts (whisper) and translate.ts (argos).
//
//   demucs   — Meta htdemucs (PyTorch). Best quality. Model downloads on first
//              run to ~/.cache/torch.
//   spleeter — Deezer (TensorFlow). Lighter / faster, lower quality.
//
// Both produce the same 4 stems but in different output sub-folders; we
// normalize that here.

const ROOT = join(import.meta.dir, "..");
const VENV_BIN = join(ROOT, ".venv", "bin");
const PY = process.env.SEPARATE_PYTHON ??
  (existsSync(join(VENV_BIN, "python")) ? join(VENV_BIN, "python") : "python3");

export type Engine = "demucs" | "spleeter";
export const STEMS = ["vocals", "drums", "bass", "other"] as const;
export type Stem = (typeof STEMS)[number];

function binPath(name: string): string | null {
  const p = join(VENV_BIN, name);
  return existsSync(p) ? p : null;
}

// Each engine ships a console script in the venv when pip-installed.
export function separateCapabilities(): Record<Engine, boolean> {
  return { demucs: !!binPath("demucs"), spleeter: !!binPath("spleeter") };
}

async function runTool(cmd: string[]): Promise<void> {
  const p = Bun.spawn(cmd, { stdout: "ignore", stderr: "pipe" });
  const stderr = await new Response(p.stderr).text();
  const code = await p.exited;
  if (code !== 0) throw new Error(`${basename(cmd[0])} failed: ` + stderr.slice(-500));
}

// Separate `input` into the 4 stems. Returns absolute paths to the stem WAVs.
export async function separateStems(
  input: string,
  outDir: string,
  engine: Engine,
): Promise<Record<Stem, string>> {
  await mkdir(outDir, { recursive: true });
  const base = basename(input).replace(/\.[^.]+$/, "");
  let stemDir: string;

  if (engine === "demucs") {
    const bin = binPath("demucs");
    const cmd = bin ? [bin] : [PY, "-m", "demucs"];
    cmd.push("-n", "htdemucs", "-o", outDir, input);
    await runTool(cmd);
    stemDir = join(outDir, "htdemucs", base); // outDir/htdemucs/<base>/<stem>.wav
  } else {
    const bin = binPath("spleeter") ?? "spleeter";
    await runTool([bin, "separate", "-p", "spleeter:4stems", "-o", outDir, input]);
    stemDir = join(outDir, base); // outDir/<base>/<stem>.wav
  }

  const result = {} as Record<Stem, string>;
  for (const stem of STEMS) {
    const wav = join(stemDir, stem + ".wav");
    if (!existsSync(wav)) throw new Error(`${engine} produced no ${stem} stem`);
    result[stem] = wav;
  }
  return result;
}
