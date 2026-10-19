#!/bin/sh
# Synthetic stand-in for cezarion's .ai/scripts/test-env-up.sh: reuse or kill-and-reboot.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
QA="$ROOT/.qa"; DESC="$QA/env.json"; LOCK="$QA/env.lock"; TTL=$(cat "$ROOT/ttl" 2>/dev/null || echo 600)
mkdir -p "$QA"
log() { echo "[env-up $$] $*" >> "$QA/env.log"; }
until mkdir "$LOCK" 2>/dev/null; do sleep 0.1; done
trap 'rm -rf "$LOCK"' EXIT
if [ -f "$DESC" ]; then
  pid=$(node -p 'require(process.argv[1]).pid' "$DESC")
  age=$(node -p 'Math.round((Date.now()-require(process.argv[1]).startedAt)/1000)' "$DESC")
  if kill -0 "$pid" 2>/dev/null && [ "$age" -le "$TTL" ]; then log "reusing pid $pid (age ${age}s)"; exit 0; fi
  log "not reusing (age ${age}s > ${TTL}s); stopping stale instance pid $pid"
  kill "$pid" 2>/dev/null || true
  rm -f "$DESC"
fi
setsid nohup node "$ROOT/server.mjs" "$QA/port" >/dev/null 2>&1 &
i=0; until [ -s "$QA/port" ] || [ $i -ge 50 ]; do sleep 0.1; i=$((i+1)); done
port=$(cat "$QA/port"); rm -f "$QA/port"
pid=$(node -e 'process.stdout.write(require("fs").readFileSync(process.argv[1],"utf8"))' "$QA/pid")
printf '{"pid":%s,"url":"http://127.0.0.1:%s","startedAt":%s}\n' "$pid" "$port" "$(node -p 'Date.now()')" > "$DESC"
log "booted pid $pid on port $port"
