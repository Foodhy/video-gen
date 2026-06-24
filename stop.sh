#!/usr/bin/env bash
# Stop everything VIDEO—GEN started: the Bun server, dev watchers, and Vite.
# Safe to run anytime; only kills this project's processes + whatever holds the port.
set -uo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-8787}"
VITE_PORT="${VITE_PORT:-5173}"
say() { printf "\033[36m[video-gen]\033[0m %s\n" "$1"; }

killed=0
kill_pids() {
  local pids="$1" label="$2"
  [ -z "$pids" ] && return
  say "stopping $label ($(echo "$pids" | tr '\n' ' '))"
  echo "$pids" | xargs kill 2>/dev/null || true
  killed=1
}

# 1. Project processes by command pattern (server, dev runner, watchers).
kill_pids "$(pgrep -f 'bun .*server/index.ts' 2>/dev/null || true)" "bun server"
kill_pids "$(pgrep -f 'concurrently .*dev:server' 2>/dev/null || true)" "dev runner"
kill_pids "$(pgrep -f 'vite' 2>/dev/null || true)" "vite"

# 2. Anything still holding the serving ports.
if command -v lsof >/dev/null 2>&1; then
  kill_pids "$(lsof -ti "tcp:${PORT}" 2>/dev/null || true)" "port ${PORT}"
  kill_pids "$(lsof -ti "tcp:${VITE_PORT}" 2>/dev/null || true)" "port ${VITE_PORT}"
fi

sleep 0.5

# 3. Escalate to SIGKILL if the ports are still occupied.
if command -v lsof >/dev/null 2>&1; then
  stubborn="$(lsof -ti "tcp:${PORT}" "tcp:${VITE_PORT}" 2>/dev/null || true)"
  if [ -n "$stubborn" ]; then
    say "force-killing stubborn processes"
    echo "$stubborn" | xargs kill -9 2>/dev/null || true
    killed=1
  fi
fi

[ "$killed" = "1" ] && say "stopped." || say "nothing running."
