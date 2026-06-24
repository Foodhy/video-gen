import { join } from "node:path";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";

// Local whisper.cpp transcription. Fully offline.
// Model resolved from $WHISPER_MODEL or ./models/ggml-base.bin.
export const MODEL_PATH =
  process.env.WHISPER_MODEL ?? join(import.meta.dir, "..", "models", "ggml-base.bin");
const WHISPER_BIN = process.env.WHISPER_BIN ?? "whisper-cli";

export function modelAvailable(): boolean {
  return existsSync(MODEL_PATH);
}

export interface Caption {
  start: number; // seconds
  end: number; // seconds
  text: string;
}

async function spawn(cmd: string[]): Promise<{ code: number; stderr: string }> {
  const p = Bun.spawn(cmd, { stdout: "ignore", stderr: "pipe" });
  const stderr = await new Response(p.stderr).text();
  const code = await p.exited;
  return { code, stderr };
}

// whisper-cli only accepts wav/flac/mp3/ogg -> normalize to 16k mono pcm wav.
async function extractWav(input: string, out: string): Promise<void> {
  const { code, stderr } = await spawn([
    "ffmpeg", "-y", "-i", input, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", out,
  ]);
  if (code !== 0) throw new Error("wav extract failed: " + stderr.slice(-400));
}

export interface TranscribeOpts {
  language?: string; // "auto" | "en" | "es" | ...
  translate?: boolean; // translate source -> English
}

export interface TranscribeResult {
  captions: Caption[];
  language: string; // detected (or "en" when translated to English)
}

export async function transcribe(
  mediaPath: string,
  workDir: string,
  opts: TranscribeOpts = {},
): Promise<TranscribeResult> {
  if (!modelAvailable()) throw new Error("whisper model missing: " + MODEL_PATH);
  const wav = join(workDir, "audio_16k.wav");
  const outBase = join(workDir, "transcript");
  await extractWav(mediaPath, wav);

  const cmd = [
    WHISPER_BIN, "-m", MODEL_PATH, "-f", wav,
    "-oj", "-of", outBase, "-t", "4",
  ];
  if (opts.language && opts.language !== "auto") cmd.push("-l", opts.language);
  if (opts.translate) cmd.push("-tr");

  const { code, stderr } = await spawn(cmd);
  if (code !== 0) throw new Error("whisper failed: " + stderr.slice(-400));

  const jsonPath = outBase + ".json";
  if (!existsSync(jsonPath)) throw new Error("whisper produced no output");
  const data = JSON.parse(await Bun.file(jsonPath).text());
  const language: string = opts.translate ? "en" : (data.result?.language ?? opts.language ?? "auto");
  const segs: any[] = data.transcription ?? [];
  const captions: Caption[] = segs
    .map((s) => ({
      start: (s.offsets?.from ?? 0) / 1000,
      end: (s.offsets?.to ?? 0) / 1000,
      text: String(s.text ?? "").trim(),
    }))
    .filter((c) => c.text.length > 0);

  await rm(wav, { force: true });
  return { captions, language };
}
