#!/usr/bin/env bash
# Issue 12 probe (throwaway). See README.md. Usage: probe.sh <squeal.mjs>
set -u
CLI=${1:?usage: probe.sh <path to dist/cli/squeal.mjs>}
HERE=$(cd "$(dirname "$0")" && pwd)
T=$(mktemp -d /tmp/issue12-XXXXXX)
export HOME=$T/home XDG_RUNTIME_DIR=$T/run CLAUDE_CONFIG_DIR=$T/home/.claude CODEX_HOME=$T/home/.codex
mkdir -p "$HOME" "$XDG_RUNTIME_DIR"; chmod 700 "$XDG_RUNTIME_DIR"
R=$T/repo; mkdir -p "$R/test"
cd "$R"
git init -q . && git config user.email p@p && git config user.name p
echo '{"name":"fixture","private":true,"type":"module"}' > package.json
echo 'export const one = 1;' > test/one.test.js
git add -A && git commit -qm init
node "$CLI" daemon "$R" 2>"$T/daemon.err" &
DPID=$!
ts() { date -u +%H:%M:%S; }
live() { # one line: time, status's daemon line
  local s; s=$(node "$CLI" status 2>&1 | grep -iE 'daemon' | head -1)
  echo "$(ts) pid $DPID alive=$(kill -0 $DPID 2>/dev/null && echo y || echo n) | ${s:-<no daemon line>}"
}
poll() { local n=$1; for _ in $(seq "$n"); do live; sleep 1; done; }
for _ in $(seq 30); do node "$CLI" status 2>&1 | grep -qi 'alive\|heartbeat' && break; sleep 1; done
echo "== squeal $(node "$CLI" --version) at $(ts); fixture $T"
echo "== status in full once"; node "$CLI" status 2>&1 | head -8
echo "== A. negative control: nothing held, 14 s"; poll 14
echo "== B. store write lock held 20 s by another process (BEGIN IMMEDIATE)"
node "$HERE/hold-store.mjs" "$R/.git/squeal/store.sqlite" 20000 &
HPID=$!; poll 24; wait $HPID
echo "== B'. after release, 8 s"; poll 8
echo "== C. daemon process stopped (SIGSTOP) 14 s: an event-loop stall"
kill -STOP $DPID; poll 14; kill -CONT $DPID
echo "== C'. after SIGCONT, 8 s"; poll 8
echo "== daemon stderr (its log; a hook-spawned daemon's is /dev/null)"; cat "$T/daemon.err"
echo "== same daemon process throughout: $(kill -0 $DPID 2>/dev/null && echo "yes, pid $DPID still running")"
kill -TERM $DPID; wait $DPID 2>/dev/null
echo "== cleanup"; rm -rf "$T"; echo "removed $T"
