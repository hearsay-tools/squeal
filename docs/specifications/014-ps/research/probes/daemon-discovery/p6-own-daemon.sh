#!/usr/bin/env bash
# Throwaway probe P6 (014-01): one scratch daemon of the installed 0.1.235
# bundle, isolated under /tmp (HOME, XDG_RUNTIME_DIR, XDG_CONFIG_HOME, TMPDIR).
# The first daemon runs OLD (0.1.234), the waiter and the last daemon BUNDLE (0.1.235).
# Observes, without connecting: the socket and ss tie, /proc/locks, the store
# row; then a lock waiter, a SIGSTOPped (hung) daemon and a SIGKILLed one.
# Signals reach only the processes this script started.
set -u
PROBES=$(cd "$(dirname "$0")" && pwd)
CACHE=$HOME/.claude/plugins/cache/hearsay/squeal
OLD=${OLD:-$CACHE/0.1.234/dist/cli/squeal.mjs}  # the first daemon: an older release
BUNDLE=${BUNDLE:-$CACHE/0.1.235/dist/cli/squeal.mjs}
S=/tmp/sq-014-01-p6
rm -rf "$S"; mkdir -p "$S/home" "$S/run" "$S/config" "$S/tmp" "$S/repo"
chmod 700 "$S/run"
export HOME=$S/home XDG_RUNTIME_DIR=$S/run XDG_CONFIG_HOME=$S/config TMPDIR=$S/tmp
cd "$S/repo"
git init -q . && git config user.email p@p && git config user.name p
printf '{"name":"p6","type":"module","devDependencies":{"vitest":"*"}}\n' > package.json
mkdir -p test && printf 'import { test } from "vitest";\ntest("a", () => {});\n' > test/a.test.ts
git add . && git commit -qm init
ROOT=$(pwd -P)
ID=$(node -e 'console.log(require("crypto").createHash("sha256").update(process.argv[1]).digest("hex").slice(0,16))' "$ROOT")
LOCK=$ROOT/.git/squeal/locks/$ID.sqlite
lockholders() { local ino; ino=$(stat -c %i "$1" 2>/dev/null) || { echo none; return; }; awk -v i=":$ino" '$6 ~ i"$" {print $5}' /proc/locks | sort -u | tr '\n' ' '; echo; }
snapshot() {
  echo "-- $1 (load $(cut -d' ' -f1 /proc/loadavg))"
  echo "socket files: $(ls "$S/run" | grep -c '^squeal-.*\.sock$')"
  local sino; sino=$(stat -c %i "$S/run/squeal-$ID.sock" 2>/dev/null || echo -)
  echo "ss listener for socket inode $sino: $(ss -xlpe 2>/dev/null | grep -c " ino:$sino ")"
  echo "lock holders: $(lockholders "$LOCK")"
  echo "daemon processes: $(pgrep -f "squeal.mjs daemon $ROOT" | tr '\n' ' ')"
  echo "listening sockets owned by daemon processes: $(for p in $(pgrep -f "squeal.mjs daemon $ROOT"); do ss -xlpe | grep -c "pid=$p,"; done | tr '\n' ' ')"
  node "$PROBES/p6-row.mjs" "$ROOT/.git/squeal/store.sqlite" "$ID"
}
node "$OLD" daemon "$ROOT" >/dev/null 2>&1 &
D1=$!
for _ in $(seq 1 100); do [ -S "$S/run/squeal-$ID.sock" ] && break; sleep 0.1; done
sleep 1
snapshot "A: one daemon pid $D1"
node "$BUNDLE" daemon "$ROOT" --await-lock 4000 >/dev/null 2>&1 &
W=$!
sleep 1
snapshot "B: plus a waiter pid $W (--await-lock 4000)"
wait $W; echo "waiter exit code $?"
kill -STOP $D1; sleep 7
snapshot "C: daemon SIGSTOPped for 7 s"
echo "state: $(awk '{print $3}' /proc/$D1/stat)"
kill -CONT $D1; sleep 1
kill -KILL $D1; wait $D1 2>/dev/null; sleep 0.5
snapshot "D: daemon SIGKILLed"
node "$BUNDLE" daemon "$ROOT" >/dev/null 2>&1 &
D2=$!
for _ in $(seq 1 100); do ss -xlpe | grep -q "pid=$D2," && break; sleep 0.1; done
sleep 1
snapshot "E: a fresh 0.1.235 daemon pid $D2 after the SIGKILL"
kill -TERM $D2; wait $D2; echo "SIGTERM exit code $?"
snapshot "F: that daemon after SIGTERM"
# The SIGKILLed daemon's temp dir under /tmp/squeal-<uid>/tmp is removed by daemon E,
# the next of its key (C9); E removes its own on SIGTERM. Run E to leave nothing.
rm -rf "$S"; echo "left: $(ls -d /tmp/sq-014-01-* 2>/dev/null | wc -l) scratch dirs, $(pgrep -f "squeal.mjs daemon $S" | wc -l) daemon processes"
