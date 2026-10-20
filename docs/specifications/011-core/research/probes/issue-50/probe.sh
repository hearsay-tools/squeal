#!/usr/bin/env bash
# Throwaway probe for gh-50 (research/issue-50.md). Not product code.
# usage: probe.sh <squeal.mjs> <deps dir with node_modules/vitest> <mode>
#   mode graceful: SIGTERM to the daemon pid only (the no-cancel #shutdown a
#                  sessions-gone exit also takes), then release the held tier
#   mode group:    SIGTERM to the daemon's whole process group (daemon and its
#                  Vitest fork workers), as a tree or group kill would
# Everything lives under one mktemp dir: HOME, XDG_RUNTIME_DIR, XDG_CONFIG_HOME,
# the fixture repository and its store (<repo>/.git/squeal). No real HOME, no
# shared pool, no other worktree's daemon.
set -u
CLI=$1 DEPS=$2 MODE=$3
T=$(mktemp -d /tmp/sq50-XXXX)
export HOME=$T/home XDG_RUNTIME_DIR=$T/run XDG_CONFIG_HOME=$T/config
unset NODE_OPTIONS VITEST
mkdir -p "$HOME" "$XDG_RUNTIME_DIR" "$XDG_CONFIG_HOME" && chmod 700 "$XDG_RUNTIME_DIR"
R=$T/repo; mkdir -p "$R/src" "$R/test"
ln -s "$DEPS/node_modules" "$R/node_modules"
printf 'node_modules\n' > "$R/.gitignore"
printf '{"private":true,"type":"module"}\n' > "$R/package.json"
printf '{"baseline":{"onStart":"lookup-only"},"runner":{"tierSize":2}}\n' > "$R/squeal.config.json"
printf 'import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { include: ["test/**/*.test.ts"], testTimeout: 200_000 } });\n' > "$R/vitest.config.ts"
printf 'export const shared = 1;\n' > "$R/src/shared.ts"
for i in 1 2 3 4 5 6; do cat > "$R/test/h$i.test.ts" <<TS
import { appendFileSync, existsSync } from "node:fs";
import { expect, it } from "vitest";
import { shared } from "../src/shared";
it("h$i holds while the flag exists", async () => {
  appendFileSync("$T/started", "h$i\n");
  const end = Date.now() + 150_000;
  while (existsSync("$T/hold") && Date.now() < end) await new Promise((d) => setTimeout(d, 100));
  expect(shared).toBeGreaterThan(0);
}, 170_000);
TS
done
git -C "$R" init -q -b main && git -C "$R" add -A && git -C "$R" -c user.email=p@p -c user.name=p commit -qm fixture
sq() { (cd "$R" && node "$CLI" "$@"); }
started() { [ -f "$T/started" ] && wc -l < "$T/started" || echo 0; }
log() { echo "[$(date +%T)] $*"; }
log "tmp=$T version=$(node "$CLI" --version) load=$(cut -d' ' -f1 /proc/loadavg) cpus=$(nproc) mode=$MODE"
sq start; log "start exit $?"
sq run --all --wait >/dev/null; log "baseline run --all --wait exit $? started=$(started)"
: > "$T/hold"; : > "$T/started"
echo 'export const shared = 2;' > "$R/src/shared.ts"; log "edited src/shared.ts with the hold on"
for _ in $(seq 1 600); do [ "$(started)" -ge 2 ] && break; sleep 0.2; done
sleep 1; log "running before the kill: $(tr '\n' ' ' < "$T/started")"
sq status 2>&1 | sed 's/^/  pre| /' | head -20
PID=$(pgrep -f "squeal.mjs daemon $R" | head -1); PGID=$(ps -o pgid= -p "$PID" | tr -d ' ')
log "daemon pid=$PID pgid=$PGID children: $(pgrep -P "$PID" | tr '\n' ' ')"
if [ "$MODE" = group ]; then kill -TERM -- "-$PGID"; else kill -TERM "$PID"; fi
log "sent SIGTERM ($MODE)"; sleep 2; rm -f "$T/hold"; log "hold released"
for _ in $(seq 1 300); do kill -0 "$PID" 2>/dev/null || break; sleep 0.2; done
log "old daemon gone: $(kill -0 "$PID" 2>/dev/null && echo no || echo yes)"
sq status 2>&1 | sed 's/^/  down| /' | head -25
: > "$T/started"
sq start; log "restart exit $? (same revision, no edit)"
sq status --wait 60000 test/h1.test.ts test/h2.test.ts test/h3.test.ts test/h4.test.ts test/h5.test.ts test/h6.test.ts 2>&1 | sed 's/^/  wait| /'
log "named wait exit ${PIPESTATUS[0]}; files the successor ran: $(tr '\n' ' ' < "$T/started")"
sq status 2>&1 | sed 's/^/  after| /' | head -25
sq stop >/dev/null 2>&1; log "stopped; tmp kept at $T"
