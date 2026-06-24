#!/usr/bin/env bash
# One-command launcher for VIDEO—GEN.
# Checks deps, installs JS packages, builds the UI, then serves the whole app
# on a single port and opens the browser. Everything runs locally.
set -euo pipefail

cd "$(dirname "$0")"

PORT="${PORT:-8787}"
say() { printf "\033[36m[video-gen]\033[0m %s\n" "$1"; }
warn() { printf "\033[33m[video-gen] warning:\033[0m %s\n" "$1"; }
die() { printf "\033[31m[video-gen] error:\033[0m %s\n" "$1" >&2; exit 1; }

# --- required tools ---
command -v bun >/dev/null 2>&1 || die "bun not found — install from https://bun.sh"
command -v ffmpeg >/dev/null 2>&1 || die "ffmpeg not found — install with: brew install ffmpeg"
command -v ffprobe >/dev/null 2>&1 || die "ffprobe not found — install with: brew install ffmpeg"

# --- optional features (non-fatal) ---
if command -v whisper-cli >/dev/null 2>&1 && [ -f "models/ggml-base.bin" ]; then
  say "subtitles: enabled (whisper-cli + ggml-base model)"
else
  warn "subtitles disabled — install whisper-cpp and download models/ggml-base.bin (see README)"
fi
if [ -x ".venv/bin/python" ] && .venv/bin/python -c "import argostranslate" >/dev/null 2>&1; then
  say "translation: enabled (argostranslate)"
else
  warn "translation disabled — create .venv and pip install argostranslate (see README)"
fi

# --- install JS deps if missing ---
if [ ! -d "node_modules" ]; then
  say "installing dependencies…"
  bun install
fi

# --- build UI (skip with SKIP_BUILD=1 for faster restarts) ---
if [ "${SKIP_BUILD:-0}" != "1" ]; then
  say "building UI…"
  bunx vite build
fi

# --- handle a port already in use ---
if lsof -ti "tcp:${PORT}" >/dev/null 2>&1; then
  if curl -s "http://localhost:${PORT}/api/capabilities" >/dev/null 2>&1; then
    # An instance of this app is already serving — just open it.
    say "already running on http://localhost:${PORT} — opening browser"
    (command -v open >/dev/null && open "http://localhost:${PORT}") || true
    exit 0
  fi
  if [ "${FORCE_KILL:-0}" = "1" ]; then
    warn "port ${PORT} busy — killing the process holding it (FORCE_KILL=1)"
    lsof -ti "tcp:${PORT}" | xargs kill 2>/dev/null || true
    sleep 0.5
  else
    die "port ${PORT} is in use by another process. Re-run with FORCE_KILL=1 ./start.sh to free it, or PORT=9000 ./start.sh to use another port."
  fi
fi

# --- open browser shortly after the server boots ---
( sleep 1.2; (command -v open >/dev/null && open "http://localhost:${PORT}") || true ) &

say "serving on http://localhost:${PORT}  (Ctrl+C to stop)"
PORT="$PORT" exec bun server/index.ts
