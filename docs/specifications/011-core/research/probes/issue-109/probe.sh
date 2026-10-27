#!/usr/bin/env bash
# Issue 109 probe (throwaway). See README.md.
# Usage: probe.sh <squeal.mjs> <claude-code dist dir> [stall seconds]
# One isolated fixture, one foreground daemon, Claude Code hook boundaries
# fed on stdin. The daemon is stopped with SIGSTOP for <stall> s (default 14):
# a delayed heartbeat with no CPU load. A `status --wait` runs across it.
set -u
CLI=${1:?usage: probe.sh <squeal.mjs> <dist dir> [stall s]}
DIST=${2:?usage: probe.sh <squeal.mjs> <dist dir> [stall s]}
STALL=${3:-14}
T=$(mktemp -d /tmp/issue109-XXXXXX)
export HOME=$T/home XDG_RUNTIME_DIR=$T/run CLAUDE_CONFIG_DIR=$T/home/.claude CODEX_HOME=$T/home/.codex
unset CEZ_TASK_ID CEZ_HANDOFF_FILE SQUEAL_COMMAND
mkdir -p "$HOME" "$XDG_RUNTIME_DIR"; chmod 700 "$XDG_RUNTIME_DIR"
R=$T/repo; mkdir -p "$R/test"
cd "$R"
git init -q . && git config user.email p@p && git config user.name p
echo '{"name":"fixture","private":true,"type":"module"}' > package.json
# Vitest resolves through a symlink to a node_modules the caller names (VITEST_NODE_MODULES).
ln -s "${VITEST_NODE_MODULES:?set VITEST_NODE_MODULES to a node_modules with vitest}" node_modules
printf 'node_modules\n' > .gitignore
slowtest() { printf 'import { test } from "vitest";\ntest("slow %s", async () => { await new Promise((r) => setTimeout(r, 6000)); });\n' "$1" > test/one.test.js; }
slowtest 0
git add -A && git commit -qm init
ts() { date -u +%H:%M:%S.%3N; }
node "$CLI" daemon "$R" 2>"$T/daemon.err" &
DPID=$!
for _ in $(seq 60); do node "$CLI" status --json 2>/dev/null | grep -q '"current": *[1-9]' && break; sleep 1; done
SID=probe-109
hook() { # $1 bundle, $2 event: print the hook's delivered text, one line per message line
  printf '{"session_id":"%s","cwd":"%s","hook_event_name":"%s","source":"startup","tool_name":"Bash"}' \
    "$SID" "$R" "$2" | node --disable-warning=ExperimentalWarning "$DIST/$1" 2>&1 \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);s=j.hookSpecificOutput?.additionalContext??j.systemMessage??s}catch{};console.log(s.split("\n").slice(0,2).join(" | ")||"<silent>")})'
}
boundary() { echo "$(ts) [$1] pid $DPID $(ps -o stat= -p $DPID 2>/dev/null) | $(hook post-tool-batch.mjs PostToolBatch)"; }
daemonline() { echo "$(ts) [$1] status --json daemon: $(node "$CLI" status --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(JSON.stringify(j.daemon),"files",JSON.stringify(j.testFileCounts))})')"; }
echo "== squeal $(node "$CLI" --version); fixture $T; stall ${STALL}s; load $(cut -d' ' -f1-3 /proc/loadavg) on $(nproc) CPUs"
echo "== registration"; echo "$(ts) $(hook session-start.mjs SessionStart)"
echo "== A. control: boundaries 1 s apart, 5 s"; for i in 1 2 3 4 5; do boundary A$i; sleep 1; done
echo "== B. edit the 6 s test; once it runs, SIGSTOP the daemon for ${STALL} s; a status --wait starts at once"
slowtest 1; sleep 2; daemonline B0
kill -STOP $DPID; STOPPED=$(date +%s)
( node "$CLI" status --wait $(( (STALL + 20) * 1000 )) test/one.test.js > "$T/wait.out" 2>&1; echo "exit $?" >> "$T/wait.out"; echo "$(ts) wait ended" >> "$T/wait.out" ) &
WPID=$!
i=0; while [ $(( $(date +%s) - STOPPED )) -lt "$STALL" ]; do i=$((i+1)); boundary B$i; daemonline B$i; sleep 2; done
kill -CONT $DPID; echo "$(ts) SIGCONT"
echo "== C. after SIGCONT: boundaries 1 s apart, 6 s"; for i in 1 2 3 4 5 6; do boundary C$i; sleep 1; done
daemonline C
wait $WPID; echo "== the status --wait that ran across the stall"; cat "$T/wait.out"
echo "== daemon processes in the fixture: $(pgrep -fc "daemon $R" || true) (1 expected)"
echo "== daemon stderr"; cat "$T/daemon.err"
echo "== same daemon process throughout: $(kill -0 $DPID 2>/dev/null && echo "yes, pid $DPID")"
kill -TERM $DPID; wait $DPID 2>/dev/null
pkill -f "daemon $R" 2>/dev/null
echo "== cleanup"; rm -rf "$T"; echo "removed $T"
