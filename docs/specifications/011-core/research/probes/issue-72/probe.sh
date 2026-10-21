#!/usr/bin/env bash
# Throwaway probe for gh-72 (research/issue-72.md). Not product code.
# usage: probe.sh <plugin dir to copy> <deps dir with node_modules/vitest> [recover]
#   recover: then try `retry` against the old daemon, and `stop`, `start`,
#            `run --all --wait` through plugin-b
# Copies the plugin to $T/plugin-a and $T/plugin-b, starts a daemon from
# plugin-a, holds a tier with four files queued behind it, deletes plugin-a
# (as Codex deletes an old version directory), releases the hold, and reads
# the result through plugin-b's CLI. Everything lives under one mktemp dir:
# HOME, XDG_RUNTIME_DIR, XDG_CONFIG_HOME, the fixture repository and its store.
# The installed plugin and every other daemon are never touched.
set -u
SRC=$1 DEPS=$2 MODE=${3:-}
T=$(mktemp -d /tmp/sq72-XXXX)
export HOME=$T/home XDG_RUNTIME_DIR=$T/run XDG_CONFIG_HOME=$T/config
unset NODE_OPTIONS VITEST
mkdir -p "$HOME" "$XDG_RUNTIME_DIR" "$XDG_CONFIG_HOME" && chmod 700 "$XDG_RUNTIME_DIR"
cp -r "$SRC" "$T/plugin-a"; cp -r "$SRC" "$T/plugin-b"
A=$T/plugin-a/dist/cli/squeal.mjs B=$T/plugin-b/dist/cli/squeal.mjs
R=$T/repo; mkdir -p "$R/src" "$R/test"
ln -s "$DEPS/node_modules" "$R/node_modules"
printf 'node_modules\n' > "$R/.gitignore"
printf '{"private":true,"type":"module"}\n' > "$R/package.json"
printf '{"baseline":{"onStart":"lookup-only"},"runner":{"tierSize":2}}\n' > "$R/squeal.config.json"
printf 'import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { include: ["test/**/*.test.ts"], testTimeout: 200_000 } });\n' > "$R/vitest.config.ts"
printf 'export const shared = 1;\n' > "$R/src/shared.ts"
for i in 1 2 3 4 5 6; do cat > "$R/test/h$i.test.ts" <<TS
import { appendFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { shared } from "../src/shared";
it("h$i holds while the flag exists, then spawns a node child", async () => {
  appendFileSync("$T/started", "h$i\n");
  const end = Date.now() + 150_000;
  while (existsSync("$T/hold") && Date.now() < end) await new Promise((d) => setTimeout(d, 100));
  const child = spawnSync(process.execPath, ["-e", "process.exit(0)"], { encoding: "utf8" });
  appendFileSync("$T/children", "h$i status=" + child.status + " stderr=" + JSON.stringify(child.stderr.slice(0, 300)) + "\n");
  expect(child.status).toBe(0);
  expect(shared).toBeGreaterThan(0);
}, 170_000);
TS
done
git -C "$R" init -q -b main && git -C "$R" add -A && git -C "$R" -c user.email=p@p -c user.name=p commit -qm fixture
sq() { local cli=$1; shift; (cd "$R" && node "$cli" "$@"); }
started() { [ -f "$T/started" ] && wc -l < "$T/started" || echo 0; }
log() { echo "[$(date +%T)] $*"; }
log "tmp=$T version=$(node "$A" --version) load=$(cut -d' ' -f1 /proc/loadavg) cpus=$(nproc)"
sq "$A" start; log "start (plugin-a) exit $?"
sq "$A" run --all --wait 2>&1 | head -3 | sed 's/^/  base| /'; log "baseline started=$(started)"
: > "$T/hold"; : > "$T/started"; : > "$T/children"
echo 'export const shared = 2;' > "$R/src/shared.ts"; log "edited src/shared.ts with the hold on"
for _ in $(seq 1 600); do [ "$(started)" -ge 2 ] && break; sleep 0.2; done
sleep 1; log "running before the delete: $(tr '\n' ' ' < "$T/started")"
PID=$(pgrep -f "plugin-a/dist/cli/squeal.mjs daemon $R" | head -1)
log "daemon pid=$PID cmd: $(tr '\0' ' ' < /proc/$PID/cmdline)"
pgrep -P "$PID" | while read -r c; do echo "  child $c: $(tr '\0' ' ' < /proc/$c/cmdline | cut -c1-300)"; done
grep -h -o '/tmp/sq72[^ ]*plugin-a[^ "]*' /proc/$PID/environ 2>/dev/null | sort -u | sed 's/^/  env-ref| /' | head
sq "$A" status 2>&1 | sed 's/^/  pre| /' | head -15
rm -rf "$T/plugin-a"; log "deleted plugin-a"
sq "$A" status 2>&1 | sed 's/^/  old-cli| /' | head -5; log "old CLI exit ${PIPESTATUS[0]}"
rm -f "$T/hold"; log "hold released"
for _ in $(seq 1 120); do [ "$(started)" -ge 6 ] && break; kill -0 "$PID" 2>/dev/null || break; sleep 0.5; done
sleep 8
log "daemon alive after delete: $(kill -0 "$PID" 2>/dev/null && echo yes || echo no); files started: $(tr '\n' ' ' < "$T/started")"
sed 's/^/  child| /' "$T/children"
sq "$B" status 2>&1 | sed 's/^/  new-cli| /' | head -30; log "new CLI status exit ${PIPESTATUS[0]}"
for f in "$R"/.git/squeal/runs/*/vitest.log; do grep -l 'plugin-a' "$f" >/dev/null 2>&1 && { echo "  log $f:"; grep -n -o '.\{0,120\}plugin-a.\{0,160\}' "$f" | head -8 | sed 's/^/    /'; }; done
sq "$B" status --wait 60000 test/h1.test.ts test/h2.test.ts test/h3.test.ts test/h4.test.ts test/h5.test.ts test/h6.test.ts 2>&1 | sed 's/^/  wait| /' | head -30
log "named wait (plugin-b) exit ${PIPESTATUS[0]}"
if [ "$MODE" = recover ]; then
  sq "$B" retry test/h1.test.ts 2>&1 | head -3 | sed 's/^/  retry-old-daemon| /'
  sq "$B" status --wait 60000 test/h1.test.ts 2>&1 | grep -v "^    at " | head -8 | sed 's/^/  retry-wait| /'; log "retry wait exit ${PIPESTATUS[0]}"
  sq "$B" stop 2>&1 | head -2 | sed 's/^/  stop| /'; sq "$B" start 2>&1 | head -2 | sed 's/^/  start-b| /'
  log "daemon now: $(pgrep -af "squeal.mjs daemon $R" | cut -c1-160)"
  : > "$T/children"; sq "$B" run --all --wait 2>&1 | head -6 | sed 's/^/  recover| /'; log "run --all --wait (plugin-b daemon) exit ${PIPESTATUS[0]}"
  sed 's/^/  child| /' "$T/children"
fi
sq "$B" stop 2>&1 | head -3; kill -0 "$PID" 2>/dev/null && { kill -TERM "$PID"; log "TERM sent to own fixture daemon $PID"; }
sleep 1; for p in $(pgrep -f "$R"); do kill -TERM "$p" 2>/dev/null; done; log "cleaned own fixture processes; tmp kept at $T"
