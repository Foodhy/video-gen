import { useEffect, useRef, useState } from "react";
import { useEditor, type LogLevel } from "../state/editor.ts";

const LEVELS: LogLevel[] = ["debug", "info", "success", "warn", "error"];
const ICON: Record<LogLevel, string> = {
  debug: "·",
  info: "i",
  success: "✓",
  warn: "!",
  error: "✕",
};

function clock(ts: number): string {
  const d = new Date(ts);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

export default function Console() {
  const logs = useEditor((s) => s.logs);
  const showLogs = useEditor((s) => s.showLogs);
  const toggleLogs = useEditor((s) => s.toggleLogs);
  const clearLogs = useEditor((s) => s.clearLogs);
  const [hidden, setHidden] = useState<Set<LogLevel>>(new Set());
  const [autoscroll, setAutoscroll] = useState(true);
  const bodyRef = useRef<HTMLDivElement>(null);

  const shown = logs.filter((l) => !hidden.has(l.level));

  useEffect(() => {
    if (autoscroll && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [shown.length, autoscroll, showLogs]);

  if (!showLogs) return null;

  function toggleLevel(lv: LogLevel) {
    setHidden((h) => {
      const n = new Set(h);
      n.has(lv) ? n.delete(lv) : n.add(lv);
      return n;
    });
  }

  return (
    <div className="console">
      <div className="console-head">
        <span className="label">Console — {shown.length}/{logs.length}</span>
        <div className="console-filters">
          {LEVELS.map((lv) => {
            const count = logs.filter((l) => l.level === lv).length;
            return (
              <button
                key={lv}
                className={"clog-flt lv-" + lv + (hidden.has(lv) ? " off" : "")}
                onClick={() => toggleLevel(lv)}
                title={`toggle ${lv}`}
              >
                {ICON[lv]} {lv} {count > 0 ? `(${count})` : ""}
              </button>
            );
          })}
        </div>
        <span style={{ flex: 1 }} />
        <label className="clog-auto">
          <input
            type="checkbox"
            checked={autoscroll}
            onChange={(e) => setAutoscroll(e.target.checked)}
          />
          auto
        </label>
        <button className="clog-btn" onClick={clearLogs}>
          clear
        </button>
        <button className="clog-btn" onClick={toggleLogs}>
          ✕ close
        </button>
      </div>
      <div className="console-body" ref={bodyRef}>
        {shown.length === 0 ? (
          <div className="clog-empty">No log entries.</div>
        ) : (
          shown.map((l) => (
            <div key={l.id} className={"clog-row lv-" + l.level}>
              <span className="clog-ts mono">{clock(l.ts)}</span>
              <span className={"clog-badge lv-" + l.level}>{ICON[l.level]}</span>
              <span className="clog-src mono">{l.source}</span>
              <span className="clog-msg">
                {l.msg}
                {l.detail ? <span className="clog-detail"> — {l.detail}</span> : null}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
