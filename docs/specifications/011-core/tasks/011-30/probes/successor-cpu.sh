#!/usr/bin/env bash
# Throwaway probe for ../design.md, question 2; delete freely. Not product code, not a test.
# Usage: successor-cpu.sh <old plugin root> <new plugin root> <vitest node_modules> [hold-s]
# The shape of ../../../research/probes/issue-47/probe.sh (run 2): an old daemon holds an edit's
# Vitest tier, six new SessionStart hooks (three concurrent, three a second apart) ask it to
# step down, and each spawns a `--await-lock 120000` successor. Samples every successor's CPU
# time (`ps cputimes`, seconds) and RSS at +10, +30 and +60 s, then releases the hold and
# counts what is left. Refuses to run when the one-minute load is at or above the CPU count.
# HOME and XDG_* are inside a fresh /tmp dir; every fixture process is killed by its root path.
set -u
OLD=$1 NEW=$2 NM=$3 HOLD=${4:-90}
load=$(cut -d' ' -f1 /proc/loadavg) cpus=$(nproc)
if awk -v l="$load" -v c="$cpus" 'BEGIN{exit !(l>=c)}'; then
  echo "load $load >= $cpus CPUs: not run"; exit 2
fi
T=$(mktemp -d /tmp/issue47cpu.XXXX)
export HOME=$T/home XDG_RUNTIME_DIR=$T/home/.run XDG_CONFIG_HOME=$T/home/.config \
  XDG_STATE_HOME=$T/home/.state XDG_CACHE_HOME=$T/home/.cache XDG_DATA_HOME=$T/home/.data
unset SQUEAL_CLI
mkdir -p "$XDG_RUNTIME_DIR" "$T/repo/tests" && chmod 700 "$XDG_RUNTIME_DIR"
cd "$T/repo"
ts() { date -u +%H:%M:%S.%3N; }
cli() { node --disable-warning=ExperimentalWarning "$1/dist/cli/squeal.mjs" "${@:2}"; }
hook() { # <plugin> <session>
  printf '{"session_id":"%s","cwd":"%s","hook_event_name":"SessionStart","source":"startup","transcript_path":"%s/t.jsonl"}' "$2" "$T/repo" "$T" \
    | CLAUDE_PLUGIN_ROOT="$1" CLAUDE_PROJECT_DIR="$T/repo" timeout 30 node --disable-warning=ExperimentalWarning "$1/dist/session-start.mjs" >"$T/hook-$2.out" 2>&1
}
sample() { # successors' and the old daemon's CPU seconds and RSS
  echo "[$(ts)] +$1 s, load $(cut -d' ' -f1 /proc/loadavg)"
  local s; s=$(pgrep -f "daemon $T/repo --await-lock" | tr '\n' ',' | sed 's/,$//')
  if [ -n "$s" ]; then
    ps -o pid=,etimes=,cputimes=,rss= -p "$s" | awk '{n++; c+=$3; r+=$4; printf "  successor %s: %s s alive, %s s CPU, %d MB\n",$1,$2,$3,$4/1024} END{printf "  successors: %d, CPU %d s total, RSS %d MB total\n",n,c,r/1024}'
  else echo "  successors: 0"; fi
  local o; o=$(pgrep -f "daemon $T/repo$" | tr '\n' ',' | sed 's/,$//')
  [ -n "$o" ] && ps -o pid=,etimes=,cputimes= -p "$o" | awk '{printf "  daemon %s: %s s alive, %s s CPU\n",$1,$2,$3}'
}
ln -s "$NM" node_modules
printf 'node_modules\n' > .gitignore
echo '{"name":"issue47cpu","private":true,"type":"module"}' > package.json
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
echo "== old $(cli "$OLD" --version), new $(cli "$NEW" --version), load $load, $cpus CPUs, node $(node --version)"
cli "$OLD" init >/dev/null
git add -A && git -c user.email=p@x -c user.name=p commit -qm init
cli "$OLD" start >/dev/null; echo "[$(ts)] old daemon started"
timeout 180 node "$OLD/dist/cli/squeal.mjs" run --all --wait | head -1
touch "$T/hold"; echo "// edit" >> tests/hold.test.ts
echo "[$(ts)] edited hold.test.ts with the hold on"
sleep 4
t0=$SECONDS
hook "$NEW" s1 & hook "$NEW" s2 & hook "$NEW" s3 & wait
for s in s4 s5 s6; do sleep 1; hook "$NEW" $s; done
echo "[$(ts)] six hooks done"
for at in 10 30 60; do sleep $((t0 + at - SECONDS)); sample $at; done
echo "[$(ts)] releasing the hold"; rm -f "$T/hold"
sleep 10; sample "$((SECONDS - t0))"
cli "$NEW" status | grep -E '^Daemon:|^Affected'
cli "$NEW" stop >/dev/null
sleep 1; pids=$(pgrep -f "$T"); [ -n "$pids" ] && kill $pids 2>/dev/null; sleep 1
echo "left: $(pgrep -f "$T" | wc -l) processes"
rm -rf "$T"; echo "== probe root removed"
