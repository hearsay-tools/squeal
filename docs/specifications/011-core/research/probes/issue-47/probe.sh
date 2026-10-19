#!/usr/bin/env bash
# Throwaway probe for ../../issue-47.md; delete freely. Not product code, not a test.
# Usage: probe.sh <old plugin root> <new plugin root> <vitest node_modules> [hold-s] [wait-s] [release|stopstart]
# wait-s: how long the handoff is watched before the hold is released (release) or
# 0.1.224 `stop` then `start` run with the hold still on (stopstart, the reporter's recovery).
# Refuses to run when the one-minute load is at or above the CPU count.
# A 0.1.223 daemon (`squeal start`) runs a full-suite request while tests/hold.test.ts
# sleeps HOLD seconds; then six 0.1.224 SessionStart hooks (distinct sessions, three
# concurrent, three sequential) ask it to step down. Prints processes, `start` and
# `status --json` during the handoff, then once the held test ends. HOME and XDG_* are
# inside a fresh /tmp dir, so no real daemon or store is reached; every fixture process
# is killed by its root path at the end. BASELINE=lookup-only sets baseline.onStart after init
# (the reporter's cezarion setting).
set -u
OLD=$1 NEW=$2 NM=$3 HOLD=${4:-45} WAIT=${5:-5} MODE=${6:-release}
load=$(cut -d' ' -f1 /proc/loadavg) cpus=$(nproc)
if awk -v l="$load" -v c="$cpus" 'BEGIN{exit !(l>=c)}'; then
  echo "load $load >= $cpus CPUs: not run"; exit 2
fi
T=$(mktemp -d /tmp/issue47.XXXX)
export HOME=$T/home XDG_RUNTIME_DIR=$T/home/.run XDG_CONFIG_HOME=$T/home/.config \
  XDG_STATE_HOME=$T/home/.state XDG_CACHE_HOME=$T/home/.cache XDG_DATA_HOME=$T/home/.data
unset SQUEAL_CLI
mkdir -p "$XDG_RUNTIME_DIR" "$T/repo/tests" && chmod 700 "$XDG_RUNTIME_DIR"
cd "$T/repo"
ts() { date -u +%H:%M:%S.%3N; }
sq() { local v=$1; shift; echo "[$(ts)] \$ squeal($v) $*"; node --disable-warning=ExperimentalWarning "$v/dist/cli/squeal.mjs" "$@"; echo "(exit $?)"; }
procs() { echo "[$(ts)] processes:"; pgrep -af "$T" | grep -v pgrep | sed "s#$T#\$T#g" || echo "  none"; }
hook() { # <plugin> <session>
  printf '{"session_id":"%s","cwd":"%s","hook_event_name":"SessionStart","source":"startup","transcript_path":"%s/t.jsonl"}' "$2" "$T/repo" "$T" \
    | CLAUDE_PLUGIN_ROOT="$1" CLAUDE_PROJECT_DIR="$T/repo" timeout 30 node --disable-warning=ExperimentalWarning "$1/dist/session-start.mjs" >"$T/hook-$2.out" 2>&1
  echo "[$(ts)] hook $2 exit $? ($(wc -c <"$T/hook-$2.out") bytes)"
}
ln -s "$NM" node_modules
printf 'node_modules\n' > .gitignore
echo '{"name":"issue47","private":true,"type":"module"}' > package.json
echo 'export default { test: { include: ["tests/**/*.test.ts"] } };' > vitest.config.ts
for n in a b c; do printf 'import { test, expect } from "vitest";\ntest("%s", () => expect(1).toBe(1));\n' $n > tests/$n.test.ts; done
cat > tests/hold.test.ts <<T
import { existsSync } from "node:fs";
import { test, expect } from "vitest";
test("hold", async () => {
  const end = Date.now() + ${HOLD}_000;
  while (existsSync("$T/hold") && Date.now() < end) await new Promise((r) => setTimeout(r, 250));
  expect(1).toBe(1);
}, 900_000);
T
git init -q && git add -A && git -c user.email=p@x -c user.name=p commit -qm fixture
echo "== old $(node "$OLD/dist/cli/squeal.mjs" --version), new $(node "$NEW/dist/cli/squeal.mjs" --version), load $load, $cpus CPUs, node $(node --version), root \$T=$T"
sq "$OLD" init >/dev/null
[ -n "${BASELINE:-}" ] && node -e 'const f="squeal.config.json",fs=require("fs");const c=JSON.parse(fs.readFileSync(f));c.baseline={onStart:process.argv[1]};fs.writeFileSync(f,JSON.stringify(c,null,2))' "$BASELINE" && echo "baseline.onStart: $BASELINE"
git add -A && git -c user.email=p@x -c user.name=p commit -qm init
sq "$OLD" start
echo "[$(ts)] \$ squeal(old) run --all --wait (baseline, no hold)"; timeout 180 node "$OLD/dist/cli/squeal.mjs" run --all --wait | head -3
touch "$T/hold"; echo "// edit" >> tests/hold.test.ts; echo "// edit" >> tests/a.test.ts
echo "[$(ts)] edited hold.test.ts and a.test.ts with the hold on"
sleep 4; sq "$OLD" status
procs
hook "$NEW" s1 & hook "$NEW" s2 & hook "$NEW" s3 & wait
for s in s4 s5 s6; do sleep 1; hook "$NEW" $s; done
sleep 1; procs
snap() {
  sq "$NEW" start | grep -E '^Squeal daemon|^Daemon:|^Affected|^Notes|daemon stopped|exit'
  echo "[$(ts)] \$ squeal(new) status --json | daemon"; node "$NEW/dist/cli/squeal.mjs" status --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s.slice(s.indexOf("{")));console.log(JSON.stringify({daemon:j.daemon,counts:j.counts}))})'
  echo "[$(ts)] \$ squeal(new) status --wait 3000 tests/hold.test.ts"; timeout 20 node "$NEW/dist/cli/squeal.mjs" status --wait 3000 tests/hold.test.ts | grep -E 'Returned|Timed|wait|Daemon:'; echo "(exit $?)"
}
snap
t0=$SECONDS; while [ $((SECONDS - t0)) -lt "$WAIT" ]; do sleep 15; echo "[$(ts)] +$((SECONDS - t0)) s"; procs | grep -c 'await-lock' | sed 's/^/  successors: /'; done
[ "$WAIT" -gt 5 ] && { procs; snap; }
if [ "$MODE" = stopstart ]; then
  sq "$NEW" stop; sleep 1; procs; sq "$NEW" start | head -12; sleep 3; sq "$NEW" status
fi
echo "[$(ts)] releasing the hold"; rm -f "$T/hold"
sleep 8; procs
sq "$NEW" status
echo "[$(ts)] \$ squeal(new) status --wait 60000"; timeout 90 node "$NEW/dist/cli/squeal.mjs" status --wait 60000; echo "(exit $?)"
procs
sq "$NEW" stop >/dev/null
sleep 1; pids=$(pgrep -f "$T"); [ -n "$pids" ] && kill $pids 2>/dev/null; sleep 1; procs
echo "== probe root $T (left for inspection; rm -rf it)"
