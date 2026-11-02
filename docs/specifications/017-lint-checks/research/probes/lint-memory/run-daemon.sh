#!/bin/sh
# Throwaway probe for research 017-26: one daemon of the copied 0.1.391 bundle in a scratch
# clone, with inside.mjs, its own HOME, XDG and TMPDIR (env.sh), at nice 10.
#   run-daemon.sh <scratch> <repo> <label> <true|false> <idle-s> [VAR=value...]
# Writes squeal.config.json with lint.enabled as given and the idle exits at 240 minutes,
# removes lint.sqlite so the first pass lints every file, starts the daemon detached, waits
# until `squeal status --json` shows lint settled (no `linting`, nothing pending or stale, three
# reads in a row; lint off: 60 s), marks `first-pass`, waits <idle-s> with a mark each 60 s,
# then asks for a major GC and a last-resort GC in both isolates, stops the daemon and puts
# squeal.config.json back.
S=$1 REPO=$S/repos/$2 LABEL=$3 LINT=$4 IDLE=$5; shift 5
HERE=$(cd "$(dirname "$0")" && pwd)
. "$S/env.sh"
LOGD=$HERE/logs/daemon-$LABEL; mkdir -p "$LOGD"; : >"$LOGD/inside.jsonl"
export LM_LOG=$LOGD/inside.jsonl LM_CTL=$S/ctl-$LABEL; mkdir -p "$LM_CTL"
sq() { (cd "$REPO" && node "$S/squeal/dist/cli/squeal.mjs" "$@"); }
ctl() { : >"$LM_CTL/$1"; n=0; while [ -e "$LM_CTL/$1" ] && [ $n -lt 600 ]; do sleep 0.2; n=$((n+1)); done; }
printf '{ "lint": { "enabled": %s }, "daemon": { "idleExitMinutes": 240, "unusedExitMinutes": 240 } }\n' "$LINT" >"$REPO/squeal.config.json"
COMMON=$(git -C "$REPO" rev-parse --path-format=absolute --git-common-dir)
rm -f "$COMMON/squeal/lint.sqlite" "$COMMON/squeal/lint.sqlite-wal" "$COMMON/squeal/lint.sqlite-shm"
echo "start $(date -u +%H:%M:%SZ) load $(cut -d' ' -f1 /proc/loadavg)" >"$LOGD/run.txt"
(cd "$REPO" && exec env "$@" setsid nice -n 10 node --expose-gc --import "$HERE/inside.mjs" \
  "$S/squeal/dist/cli/squeal.mjs" daemon "$REPO" </dev/null >"$LOGD/daemon.out" 2>&1) &
PID=$!
echo "pid $PID" >>"$LOGD/run.txt"
t=0 ok=0
while [ $t -lt 1200 ]; do
  sleep 2; t=$((t+2))
  sq status --json >"$LOGD/status.json" 2>/dev/null
  state=$(node -e '
    const s = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const l = s.lint;
    if (!l) { console.log("nolint"); process.exit(0); }
    console.log(JSON.stringify({ off: l.off, linting: l.linting, pending: l.pending, stale: l.stale, unknown: l.unknown, files: l.files, failing: l.failing }));
  ' "$LOGD/status.json" 2>/dev/null || echo unread)
  echo "$t $state" >>"$LOGD/poll.txt"
  case $state in
    nolint) [ "$LINT" = false ] && [ $t -ge 60 ] && break ;;
    *'"off"'*) break ;;
    *'"linting"'*|*unread*) ok=0 ;;
    *'"pending":0,"stale":0'*) ok=$((ok+1)); [ $ok -ge 3 ] && break ;;
    *) ok=0 ;;
  esac
done
echo "settled at ${t}s $(date -u +%H:%M:%SZ) load $(cut -d' ' -f1 /proc/loadavg): $state" >>"$LOGD/run.txt"
ctl mark-first-pass
i=0
while [ $i -lt "$IDLE" ]; do sleep 60; i=$((i+60)); ctl "mark-idle-${i}s"; done
ctl gc
ctl lastresort
sq lint --json >"$LOGD/lint.json" 2>&1
sq stop >>"$LOGD/run.txt" 2>&1
wait $PID
echo "stopped $(date -u +%H:%M:%SZ)" >>"$LOGD/run.txt"
git -C "$REPO" checkout -q -- squeal.config.json
