# VIDEO—GEN — agent guide

Local Mac video editor. CapCut-style layout, A24 "Dark Chrome Brutalist" skin.
**Fully local**: a Bun server shells out to `ffmpeg` on native files; nothing
leaves the machine. No cloud, no API keys required for core editing.

## Run / init

One command (recommended): `./start.sh` (or `bun run start`).
It checks `bun`/`ffmpeg`/`ffprobe`, reports optional feature status, installs
deps if needed, builds the UI, serves on **http://localhost:8787**, opens browser.

- Dev with hot reload: `bun run dev` → UI on :5173, API on :8787 (proxied). Open :5173.
- Manual single-port: `bun run build && bun run serve`.
- `PORT=9000 ./start.sh` changes port; `SKIP_BUILD=1` reuses last build.

IMPORTANT: in single-port mode the server caches compiled code — **restart it
after editing `server/*`**. `bun run dev` (uses `--watch`) reloads automatically.
The browser must be open on the SAME origin/port the server serves, or fetches
fail with `ERR_CONNECTION_REFUSED` (this is not a permissions issue).

## Optional offline AI features (degrade gracefully if absent)

- **Subtitles** (whisper.cpp): needs `whisper-cli` (brew `whisper-cpp`) + a model at
  `models/ggml-base.bin`. Without it, `/api/capabilities` reports `transcribe:false`
  and the Subtitle buttons disable.
- **Translation** (argostranslate): `python3 -m venv .venv && .venv/bin/pip install argostranslate`.
  Language packs download on first use, then run offline. Else `translate:false`.

## Architecture

- `server/` — Bun HTTP API + ffmpeg wrappers.
  - `index.ts` REST + range-streamed `/media`, static SPA serving.
  - `ffmpeg.ts` probe / thumbnails / extract / **render** (trim → fade/mute/fx →
    crossfade groups → concat → subtitle+drawtext burn).
  - `transcribe.ts` (whisper-cli), `translate.ts`/`translate.py` (argos),
    `jobs.ts` (in-memory render jobs), `workspace.ts` (per-project dirs + project.json).
- `web/` — Vite + React + TS UI.
  - `state/editor.ts` — single zustand store: assets, **EDL segments**, captions,
    texts, fx, undo/redo history, logs. Pure helpers: `placeTrack` (lays segments
    end-to-end, subtracts crossfade overlaps), `placeCaptions`, `buildSnapPoints`,
    `fxToCss`, `serializeDoc`.
  - `components/` — Toolbar, MediaPanel, Player, Details, Timeline/*, Console,
    ExportModal, ProjectMenu, ContextMenu.
  - `lib/api.ts` — all fetches wrapped (logged to in-app Console); `logger.ts`.
- `workspace/<projectId>/` — source/derived/output media, thumbs, `project.json`
  (clips + editor `doc`). Gitignored.

## Editing model

Non-destructive **EDL**: the timeline is an array of segments referencing
`[in,out]` of source assets, laid end-to-end per track. Source files are never
mutated until **Export**, which POSTs the EDL (+fades, mute, crossfade, fx,
subtitles, texts) to ffmpeg. Edits autosave (debounced) to `project.json`;
last project rehydrates from `localStorage` on load.

## Features

import · drag-reorder · split/trim (snapping) · separate/extract/mute audio ·
fade in/out (video+audio) · crossfade between clips · per-clip effects + color
presets · V2 overlay / picture-in-picture · transcribe (whisper) · translate
(argos) · subtitles (overlay + burn) · text/title overlays · undo/redo · in-app
Console · project switcher · export mp4.

## Gotchas

- Don't commit `models/`, `.venv/`, `workspace/`, `node_modules/`, `dist/` (gitignored).
- `drawtext` uses a hardcoded mac font (`TEXT_FONT` env to override).
- Verify ffmpeg output with `ffprobe` / `signalstats` / `volumedetect` — used
  throughout to confirm fades, mute, fx, crossfade actually rendered.
