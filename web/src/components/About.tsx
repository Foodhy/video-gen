import { useEffect } from "react";

const FEATURES = [
  "Non-destructive EDL timeline — clips reference [in,out] of source files",
  "Drag-reorder · split / trim with snapping · separate / extract / mute audio",
  "Fade in/out · crossfade between clips · per-clip effects + color presets",
  "V2 overlay / picture-in-picture",
  "Transcribe (whisper.cpp) · translate (argostranslate) · burn subtitles",
  "Text / title overlays · undo/redo · in-app console · export mp4",
];

export default function About({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="about-page" role="dialog" aria-label="About VIDEO—GEN">
      <button className="about-close" onClick={onClose} title="Close (Esc)">
        ✕ Close
      </button>
      <div className="about-inner">
        <img className="about-wordmark" src="/wordmark.png" alt="VIDEO—GEN" />
        <p className="about-tagline">
          A fully-local, CapCut-style video editor for the Mac.
        </p>
        <p className="about-blurb">
          Everything runs on your machine — a Bun server shells out to native
          <code> ffmpeg </code> on local files. Nothing leaves the computer:
          no cloud, no accounts, no API keys for core editing. Optional offline
          AI (subtitles, translation) degrades gracefully when its tools aren't
          installed.
        </p>

        <h3 className="about-h">What it does</h3>
        <ul className="about-list">
          {FEATURES.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>

        <div className="about-foot">
          <span>Dark Chrome Brutalist · A24 skin</span>
          <span>Runs at localhost:8787 · 100% offline</span>
        </div>
      </div>
    </div>
  );
}
