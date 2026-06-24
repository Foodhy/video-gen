# VIDEO—GEN

Local Mac video editor. CapCut-style layout, A24 "Dark Chrome Brutalist" skin. Fully local: a Bun server drives `ffmpeg` on native files; nothing leaves the machine.

## Requirements
- `bun`, `ffmpeg` + `ffprobe` on PATH (verified: bun 1.3, ffmpeg 7.1).
- Subtitles: `whisper-cli` (brew `whisper-cpp`) + a ggml model at `models/ggml-base.bin`:
  ```
  mkdir -p models
  curl -L -o models/ggml-base.bin \
    https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin
  ```
  Override with `WHISPER_MODEL` / `WHISPER_BIN` env vars. If absent, the Subtitles
  buttons disable gracefully (`/api/capabilities` reports `transcribe:false`).
- Translation (any language): a python venv with argostranslate:
  ```
  python3 -m venv .venv
  .venv/bin/pip install argostranslate
  ```
  Language models download on first use, then run offline. Override the interpreter
  with `TRANSLATE_PYTHON`. If absent, Translate disables (`translate:false`).

## Run

### One command (recommended)
```
./start.sh
```
or `bun run start`. The launcher:
1. checks `bun` / `ffmpeg` / `ffprobe` (fails fast with install hints),
2. reports whether subtitles (whisper) and translation (argos) are enabled,
3. `bun install` if needed,
4. builds the UI,
5. serves the whole app on one port and opens the browser.

It then runs at **http://localhost:8787**. Knobs:
- `PORT=9000 ./start.sh` — change the port.
- `SKIP_BUILD=1 ./start.sh` — reuse the last build (faster restart).

### Dev mode (hot reload)
```
bun install
bun run dev          # Vite UI :5173 + API :8787 (proxied) → open :5173
```

### Manual single-port
```
bun run build
bun run serve        # = bun server/index.ts, http://localhost:8787
```

First run only — enable the optional offline AI features (see **Requirements**):
download the whisper model into `models/` and create the `.venv` with argostranslate.
Without them the app still runs; the Subtitles/Translate buttons just stay disabled.

## Phase 1 features
- **Import + preview** — `+ Import Media`, ffprobe metadata in Details, range-streamed playback.
- **Cut / trim** — split at playhead (`S`), drag segment handles to trim, delete (`⌫`). Non-destructive EDL; sources never mutated until export.
- **Separate audio** — Details → `Separate Audio`, extracts an AAC track onto A1.
- **Export** — top-right `Export`, ffmpeg renders the timeline EDL to mp4 with live progress, then download.

Shortcuts: `Space` play/pause · `S` split · `⌫`/`Del` delete selected.

## Layout
`server/` Bun API + ffmpeg wrappers · `web/` Vite + React UI · `workspace/` per-project media (gitignored).

## Phase 2 — Subtitles (built)
- **Transcribe** — Details → pick spoken language → `Transcribe / Subtitles`. Local whisper.cpp (Metal), offline. Lines land on a C1 caption track + overlay on the player.
- **Translate** — `Transcribe → English` uses whisper's translate task (any source → English).
- **Captions toggle** — top toolbar `Captions` shows/hides the overlay.
- **Burn-in** — Export modal → `Burn subtitles into video` renders captions into the MP4 (ffmpeg `subtitles` filter); off = clean video. Caption timing maps through the EDL, so cuts/trims stay in sync.

Captions are stored in source time per clip and projected onto timeline time, so trimming/splitting keeps subtitles aligned.

## Phase 3 — Translate + edit captions (built)
- **Translate** — Details → pick a target language → `Translate`. Offline argostranslate, any language pair (pivots through English when needed). Source language is whisper's detected language; timings preserved.
- **Edit captions** — every caption line is an editable field in Details; edits flow to the overlay, the timeline track, and burn-in.
- **Clear** — drop a clip's captions.
- Verified end-to-end: EN transcribe → ES translate → burned accented subtitles render correctly in the exported MP4.

## Persistence (built)
Projects survive reloads. Media + clip metadata + thumbnails persist in `workspace/<id>/project.json`; the editor doc (segments, captions, caption languages) autosaves there (debounced) via `PUT /api/project/:id/doc`. On load the app rehydrates the last project id from `localStorage` (`GET /api/project/:id`); a missing project clears gracefully. Nothing is uploaded — state lives in the local workspace dir.

## Projects (built)
Top-left dropdown next to the wordmark. Shows the current project, lists all saved
projects (newest first, with clip counts), switches between them (loads media + doc),
and `+ New Project` starts a fresh one. Backed by `GET/POST /api/projects`.

## Phase 4 — Text, audio extract, crossfade (built)
- **Text/title overlays** — `Text` in toolbar adds a title at the playhead. Drag on the player to position, edit content/timing/size/color in Details, T1 timeline track. Burned into export via ffmpeg `drawtext`.
- **Extract section audio** — right-click a clip → *Extract section audio → file* renders just that `[in,out]` range to `.m4a` and downloads it.
- **Crossfade between clips** — right-click → *Crossfade with next*. Clips overlap on the timeline; export dissolves video (`xfade`) + audio (`acrossfade`). Boundaries without a crossfade stay hard cuts. Badge `⤬` marks a crossfade.

## Phase 5 — Effects / filters (built)
Per-clip color + blur. Select a segment → Details *Effects*: brightness, contrast, saturation, blur sliders + Black & white toggle (also in the right-click menu). One-click **presets** (Cinematic, Warm, Cold, Vivid, Vintage, Noir, B&W, Dreamy). Live CSS-filter preview on the player; export bakes them via ffmpeg `eq` + `gblur`. Badge `✦` marks a clip with effects. Undoable + persisted.

Clips can be **drag-reordered** on the timeline (drag a clip body; drop position by clip center).

## Multi-track overlay / PiP (built)
Right-click a video clip → *Send to overlay (V2 / PiP)*. The clip moves to a V2
track and composites over the main video as picture-in-picture. Details shows
X / Y / scale sliders; live second-video preview on the player; export composites
via ffmpeg `overlay` + `scale` with per-overlay timing (`enable`). Snapping,
undo, and persistence apply.

## Timeline editing aids (built)
Magnet **snapping** (🧲) — playhead seek and trim edges snap to clip/text edges;
jump to previous/next edit with `,` / `.`.
