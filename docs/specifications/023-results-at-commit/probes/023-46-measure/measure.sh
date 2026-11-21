#!/usr/bin/env bash
# Row 023-46: commit daemon start, before and after, from source. Usage: measure.sh <tip> <reps>
set -uo pipefail
T=${SCRATCH:?a scratch folder with before/ (the base source, node_modules linked)}
MY=${AFTER:?the source tree with the change}
SUBJ=$T/subj
OUT=$T/m/out
TIP=$1
REPS=${2:-3}
FILE=test/daemon/commit-removal.test.ts
LOADER="file://$MY/node_modules/tsx/dist/loader.mjs"
mkdir -p "$OUT"
TREE=
ms() { date +%s%3N; }
log() { echo "$(date -u +%T) $*" | tee -a "$OUT/driver.log"; }
sq() { local src=$1; shift; node --import "$LOADER" "$src/src/cli/index.ts" "$@"; }

waitfor() { # file pattern timeout-s
  local end=$(( $(date +%s) + $3 ))
  while [ "$(date +%s)" -lt "$end" ]; do grep -qs "$2" "$1" && return 0; sleep 0.1; done
  return 1
}

stopall() {
  local src=$1
  for p in ${CPID:-} ${WPID:-}; do kill -TERM "$p" 2>/dev/null; done
  for p in ${CPID:-} ${WPID:-}; do for _ in $(seq 300); do kill -0 "$p" 2>/dev/null || break; sleep 0.1; done; kill -0 "$p" 2>/dev/null && { log "pid $p still alive; KILL"; kill -KILL "$p"; }; done
  sleep 1
  # anything still running from these trees
  local pat="$SUBJ"; [ -n "$TREE" ] && pat="$SUBJ|$TREE"
  local left; left=$(pgrep -f "$pat" | wc -l)
  [ "$left" -gt 0 ] && { log "left: $left processes"; pgrep -af "$pat" | head -5 >> "$OUT/driver.log"; pkill -KILL -f "$pat"; sleep 1; }
  for w in $(git -C $SUBJ worktree list --porcelain | awk '/^worktree/{print $2}' | tail -n +2); do git -C $SUBJ worktree unlock "$w" 2>/dev/null; git -C $SUBJ worktree remove --force --force "$w" 2>/dev/null; done
  git -C $SUBJ worktree prune
  [ -n "$TREE" ] && rm -rf "$(dirname "$TREE")"
  TREE=
}

rep() { # variant src label
  local variant=$1 src=$2 label=$3
  rm -rf $SUBJ/.git/squeal
  log "$label: $variant at $TIP; load $(cut -d' ' -f1-3 /proc/loadavg)"
  WPID=; CPID=
  sq "$src" daemon $SUBJ > "$OUT/$label.wt.log" 2>&1 &
  WPID=$!
  waitfor "$OUT/$label.wt.log" "serving " 600 || log "$label: worktree daemon never served"
  sleep 20
  local tree; tree=$(cd $SUBJ && node --import "$LOADER" $T/m/mk-tree.ts "$src" $SUBJ HEAD~1 2> "$OUT/$label.tree.err")
  [ -d "$tree" ] || { log "$label: no tree"; stopall "$src"; return; }
  TREE=$tree
  local load0; load0=$(cut -d' ' -f1 /proc/loadavg)
  local t0 t1 t2 code
  t0=$(ms)
  sq "$src" daemon "$tree" > "$OUT/$label.c.log" 2>&1 &
  CPID=$!
  waitfor "$OUT/$label.c.log" "serving " 600 || log "$label: commit daemon never served"
  t1=$(ms)
  (cd "$tree" && sq "$src" run tests $FILE --wait 400000 > "$OUT/$label.run.out" 2>&1)
  code=$?
  t2=$(ms)
  local walked; walked=$(node $T/m/walked.cjs $SUBJ/.git/squeal/store.sqlite "$tree" "$t0")
  echo "{\"label\":\"$label\",\"variant\":\"$variant\",\"tip\":\"$TIP\",\"serveMs\":$((t1 - t0)),\"resultMs\":$((t2 - t0)),\"runExit\":$code,\"load\":$load0,\"store\":$walked}" >> "$OUT/reps.jsonl"
  log "$label: serving $((t1 - t0)) ms, result $((t2 - t0)) ms, run exit $code, $walked"
  (cd "$tree" && sq "$src" stop > "$OUT/$label.stop.out" 2>&1)
  (cd $SUBJ && sq "$src" stop >> "$OUT/$label.stop.out" 2>&1)
  stopall "$src"
}

# subject: a clone at TIP, installed once
if [ ! -d $SUBJ/.git ]; then git clone -q --no-checkout --shared ${REPO:?the repository} $SUBJ; fi
git -C $SUBJ checkout -q --detach "$TIP" && (cd $SUBJ && pnpm install --frozen-lockfile > "$OUT/install.log" 2>&1) || { log "subject install failed"; exit 1; }
for i in $(seq "$REPS"); do
  rep before $T/before "before-$TIP-$i"
  rep after $MY "after-$TIP-$i"
done
log "done $TIP"
