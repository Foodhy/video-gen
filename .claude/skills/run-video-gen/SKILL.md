---
name: run-video-gen
description: Initialize, run, and operate the VIDEO—GEN local Mac video editor (Bun + ffmpeg server + Vite/React UI). Use when asked to start, launch, set up, build, or test this project, enable its subtitle/translation features, or hit its API.
---

# Run VIDEO—GEN

Local video editor. Bun server shells out to `ffmpeg`; Vite/React UI. Fully local.

## Fast path — just run it

```bash
./start.sh
```

(or `bun run start`). Checks `bun`/`ffmpeg`/`ffprobe`, installs deps if missing,
builds the UI, serves on **http://localhost:8787**, opens the browser. Knobs:
`PORT=9000 ./start.sh`, `SKIP_BUILD=1 ./start.sh`.

## First-time setup

1. Requires `bun`, `ffmpeg`, `ffprobe` on PATH (`brew install ffmpeg`).
2. `bun install` (start.sh does this automatically if `node_modules` is missing).
3. Optional offline AI (skip for core editing):
   - Subtitles: `brew install whisper-cpp`, then
     `curl -L -o models/ggml-base.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin`
   - Translation: `python3 -m venv .venv && .venv/bin/pip install argostranslate`

Without the optional pieces the app still runs; `GET /api/capabilities` reports
`{transcribe:false}` / `{translate:false}` and those buttons disable.

## Modes

- **Dev (hot reload):** `bun run dev` → UI :5173 + API :8787 (proxied). Open :5173.
- **Single-port:** `bun run build && bun run serve` → :8787.

CRITICAL: in single-port mode the Bun server caches compiled code. After editing
anything under `server/`, **restart the server** or changes won't apply. Use
`bun run dev` while iterating (it `--watch`es). The browser tab must be on the
same port the server serves; a stale tab on a dead port shows
`ERR_CONNECTION_REFUSED` / "Failed to fetch" — restart/reopen on :8787, it is not
a permissions problem.

## Verify it works (headless smoke test)

```bash
# server must be running on :8787
curl -s localhost:8787/api/capabilities                 # feature flags
# make a test clip, import, export a cut, probe the result
ffmpeg -y -f lavfi -i testsrc=size=640x360:rate=30:d=6 -f lavfi -i sine=440:d=6 \
  -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest /tmp/t.mp4
R=$(curl -s -F file=@/tmp/t.mp4 localhost:8787/api/import)
# -> { projectId, clip:{id,...}, mediaUrl, thumbs }
```

Confirm rendered effects with `ffprobe` / `-vf signalstats` / `-af volumedetect`
(used in this repo's tests to prove fades/mute/fx/crossfade actually applied).

## Key API (all local, JSON unless noted)

- `POST /api/import` (multipart `file`) → clip + ffprobe metadata + thumbs
- `GET  /api/project/:id` / `PUT /api/project/:id/doc` — load / autosave editor doc
- `GET/POST /api/projects` — list / create
- `POST /api/separate-audio` · `POST /api/extract-audio` `{in,out,format}`
- `POST /api/transcribe` `{clipId,language,translate}` · `POST /api/translate` `{from,to,lines}`
- `POST /api/export` `{edl[],burnSubtitles?,texts?}` → `{jobId}`; poll `GET /api/job/:id`
- `GET /api/capabilities` → `{transcribe,translate}`

## Where things live

`server/` API+ffmpeg · `web/src/state/editor.ts` the zustand store + EDL helpers ·
`web/src/components/` UI · `workspace/<id>/` media + `project.json` (gitignored).
See `CLAUDE.md` for full architecture. Never commit `models/ .venv/ workspace/
node_modules/ dist/` (already gitignored).
