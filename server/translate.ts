import { join } from "node:path";
import { existsSync } from "node:fs";

// Offline translation via the argostranslate python helper (server/translate.py),
// run through the project venv. Fully local after first model download.
const ROOT = join(import.meta.dir, "..");
const PY =
  process.env.TRANSLATE_PYTHON ??
  (existsSync(join(ROOT, ".venv", "bin", "python"))
    ? join(ROOT, ".venv", "bin", "python")
    : "python3");
const SCRIPT = join(import.meta.dir, "translate.py");

export function translateAvailable(): boolean {
  return existsSync(SCRIPT) && (PY !== "python3" || existsSync(SCRIPT));
}

async function callPy(req: unknown, timeoutMs = 600_000): Promise<any> {
  const proc = Bun.spawn([PY, SCRIPT], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  proc.stdin.write(JSON.stringify(req));
  proc.stdin.end();
  const timer = setTimeout(() => proc.kill(), timeoutMs);
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  await proc.exited;
  clearTimeout(timer);
  const line = out.trim().split("\n").filter(Boolean).pop() ?? "";
  if (!line) throw new Error("translate helper produced no output: " + err.slice(-300));
  return JSON.parse(line);
}

export async function capabilities(): Promise<{ ok: boolean; installed: [string, string][] }> {
  try {
    return await callPy({ action: "capabilities" }, 20_000);
  } catch {
    return { ok: false, installed: [] };
  }
}

export async function translateLines(
  from: string,
  to: string,
  lines: string[],
): Promise<string[]> {
  const res = await callPy({ action: "translate", from, to, lines });
  if (!res.ok) throw new Error(res.error ?? "translation failed");
  return res.lines as string[];
}
