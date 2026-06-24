import { useEffect, useRef, useState } from "react";
import { getLevels, setMonitorMode, type MonitorMode } from "../lib/audioGraph.ts";

const MODES: MonitorMode[] = ["stereo", "mono", "left", "right"];

export default function MasterMeter({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<MonitorMode>("stereo");
  const lRef = useRef<HTMLDivElement>(null);
  const rRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const { l, r } = getLevels();
      if (lRef.current) lRef.current.style.height = Math.round(l * 100) + "%";
      if (rRef.current) rRef.current.style.height = Math.round(r * 100) + "%";
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="master-meter">
      <div className="mm-head">
        <span className="label">Master — monitor only</span>
        <button className="clog-btn" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="mm-bars">
        <div className="mm-col">
          <div className="mm-track">
            <div ref={lRef} className="mm-fill" />
          </div>
          <span className="mono">L</span>
        </div>
        <div className="mm-col">
          <div className="mm-track">
            <div ref={rRef} className="mm-fill" />
          </div>
          <span className="mono">R</span>
        </div>
      </div>
      <div className="mm-modes">
        {MODES.map((m) => (
          <button
            key={m}
            className={"fx-preset" + (mode === m ? " on" : "")}
            onClick={() => {
              setMode(m);
              setMonitorMode(m);
            }}
          >
            {m}
          </button>
        ))}
      </div>
      <span className="mono" style={{ fontSize: 9, color: "var(--text-muted)" }}>
        Changes only what you hear — export is unaffected.
      </span>
    </div>
  );
}
