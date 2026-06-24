import { useEditor, type LogLevel } from "../state/editor.ts";

// Central logger: pushes structured entries into the store (shown in the
// in-app Console) and mirrors to the browser console.
export function log(level: LogLevel, source: string, msg: string, detail?: string): void {
  try {
    useEditor.getState().pushLog({ level, source, msg, detail });
  } catch {
    /* store not ready yet */
  }
  const tag = `[${source}]`;
  if (level === "error") console.error(tag, msg, detail ?? "");
  else if (level === "warn") console.warn(tag, msg, detail ?? "");
  else console.log(tag, msg, detail ?? "");
}

export const logger = {
  debug: (s: string, m: string, d?: string) => log("debug", s, m, d),
  info: (s: string, m: string, d?: string) => log("info", s, m, d),
  success: (s: string, m: string, d?: string) => log("success", s, m, d),
  warn: (s: string, m: string, d?: string) => log("warn", s, m, d),
  error: (s: string, m: string, d?: string) => log("error", s, m, d),
};
