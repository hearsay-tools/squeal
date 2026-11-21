#!/usr/bin/env bash
# Row 023-40 measurement driver; runs on the sandbox. Writes ~/out/.
set -uo pipefail
R=~/r
OUT=~/out
S="node ~/m/plugin/dist/cli/squeal.mjs"
FILE=test/daemon/commit-removal.test.ts
GROUPDIR=test/daemon
IDLE=${IDLE:-30}
groupfiles() { ls test/scheduler/*.test.ts | head -40; }
T=~/m/tools
mkdir -p "$OUT"
ms() { date +%s%3N; }
log() { echo "$(date -u +%T) $*" | tee -a "$OUT/driver.log"; }

reset() {
  cd $R
  for c in 1 2 3; do $S stop --at HEAD~$c >/dev/null 2>&1; done
  $S stop >/dev/null 2>&1
  sleep 2
  local left
  left=$(pgrep -f "squeal.mjs" | wc -l)
  [ "$left" -gt 0 ] && { log "reset: $left squeal processes left; killing"; pkill -9 -f "squeal.mjs"; sleep 1; }
  rm -rf $R/.git/squeal ~/.cache/squeal /tmp/squeal-* 2>/dev/null
  for w in $(git worktree list --porcelain | awk '/^worktree/{print $2}' | tail -n +2); do git worktree unlock "$w" 2>/dev/null; git worktree remove --force --force "$w" 2>/dev/null; done
  git worktree prune
}

wt_idle() {
  cd $R
  $S start >/dev/null 2>&1
  for _ in $(seq 240); do
    grep -qs "serving ~/r on" $R/.git/squeal/logs/daemon-*.log && break
    sleep 0.5
  done
  log "worktree daemon serving"
  sleep 20
}

# rep <label> <cold|warm> <prewarm 0|1> <group 0|1> <commit ref>
rep() {
  local label=$1 store=$2 prewarm=$3 group=$4 ref=$5
  log "rep $label: store $store, worktree daemon first $prewarm, group $group, at $ref"
  reset
  [ "$store" = cold ] && rm -rf ~/.local/share/pnpm/store
  [ "$prewarm" = 1 ] && wt_idle
  cd $R
  node $T/sampler.mjs "$OUT/$label.samples.jsonl" $R $FILE &
  local sp=$!
  local t0 t1 g0 g1 s0 s1 s2 code gcode=""
  t0=$(ms)
  $S status --at $ref $FILE --run > "$OUT/$label.call.out" 2> "$OUT/$label.call.err"
  code=$?
  t1=$(ms)
  local tree
  tree=$(ls -d ~/.cache/squeal/checkouts/*/commit-*/tree 2>/dev/null | head -1)
  sleep $IDLE
  if [ "$group" = 1 ] && [ -n "$tree" ]; then
    cd "$tree"
    g0=$(ms)
    $S run tests $(groupfiles) --wait 400000 > "$OUT/$label.group.out" 2>&1
    gcode=$?
    g1=$(ms)
    cd $R
    sleep 15
  fi
  s0=$(ms)
  $S stop --at $ref > "$OUT/$label.stop.out" 2>&1
  s1=$(ms)
  for _ in $(seq 100); do [ -n "$tree" ] && [ -e "$tree" ] || break; sleep 0.2; done
  s2=$(ms)
  sleep 1
  kill $sp
  mkdir -p "$OUT/$label.logs"
  cp $R/.git/squeal/logs/* "$OUT/$label.logs/" 2>/dev/null
  echo "{\"label\":\"$label\",\"store\":\"$store\",\"prewarm\":$prewarm,\"ref\":\"$ref\",\"t0\":$t0,\"t1\":$t1,\"code\":$code,\"g0\":${g0:-null},\"g1\":${g1:-null},\"gcode\":\"$gcode\",\"s0\":$s0,\"s1\":$s1,\"s2\":$s2,\"treeLeft\":$([ -e "$tree" ] && echo true || echo false)}" > "$OUT/$label.times.json"
  log "rep $label done: call $((t1 - t0)) ms exit $code; stop $((s1 - s0)) ms, gone $((s2 - s0)) ms"
}

installs() {
  cd $R
  for kind in cold warm; do
    for i in 1 2 3; do
      [ "$kind" = cold ] && rm -rf ~/.local/share/pnpm/store
      local w=/tmp/sq-install-wt
      git worktree remove --force --force $w >/dev/null 2>&1; rm -rf $w
      local a b c
      a=$(ms); git worktree add --detach $w HEAD~1 >/dev/null 2>&1; b=$(ms)
      (cd $w && pnpm install --frozen-lockfile > "$OUT/install-$kind-$i.log" 2>&1); c=$(ms)
      echo "{\"kind\":\"$kind\",\"i\":$i,\"addMs\":$((b - a)),\"installMs\":$((c - b))}" >> "$OUT/installs.jsonl"
      git worktree remove --force --force $w >/dev/null 2>&1; rm -rf $w; git worktree prune
    done
  done
  log "installs done"
}

three() {
  local label=three
  log "three daemons"
  reset
  wt_idle
  cd $R
  node $T/sampler.mjs "$OUT/$label.samples.jsonl" $R $FILE &
  local sp=$!
  echo "{\"event\":\"calls\",\"t\":$(ms)}" > "$OUT/$label.marks.jsonl"
  local pids=()
  for c in 1 2 3; do
    $S status --at HEAD~$c $FILE --run > "$OUT/$label.call$c.out" 2> "$OUT/$label.call$c.err" &
    pids+=($!)
  done
  wait "${pids[@]}"
  echo "{\"event\":\"calls-done\",\"t\":$(ms)}" >> "$OUT/$label.marks.jsonl"
  sleep 90
  echo "{\"event\":\"groups\",\"t\":$(ms)}" >> "$OUT/$label.marks.jsonl"
  pids=()
  for tree in ~/.cache/squeal/checkouts/*/commit-*/tree; do
    (cd "$tree" && $S run tests $(groupfiles) --wait 600000 > "$OUT/$label.group.$(basename $(dirname $tree) | cut -c8-16).out" 2>&1) &
    pids+=($!)
  done
  wait "${pids[@]}"
  echo "{\"event\":\"groups-done\",\"t\":$(ms)}" >> "$OUT/$label.marks.jsonl"
  sleep 15
  for c in 1 2 3; do $S stop --at HEAD~$c > /dev/null 2>&1; done
  sleep 2
  kill $sp
  mkdir -p "$OUT/$label.logs"; cp $R/.git/squeal/logs/* "$OUT/$label.logs/" 2>/dev/null
  log "three done"
}

profile() {
  log "profile"
  reset
  wt_idle
  cd $R
  rm -rf "$OUT/prof"; mkdir -p "$OUT/prof"
  node $T/sampler.mjs "$OUT/prof.samples.jsonl" $R $FILE &
  local sp=$!
  local t0; t0=$(ms)
  NODE_OPTIONS="--cpu-prof --cpu-prof-dir=$OUT/prof" $S status --at HEAD~1 $FILE --run > "$OUT/prof.call.out" 2> "$OUT/prof.call.err"
  echo "{\"t0\":$t0,\"t1\":$(ms)}" > "$OUT/prof.times.json"
  sleep 10
  $S stop --at HEAD~1 > "$OUT/prof.stop.out" 2>&1
  sleep 3
  kill $sp
  mkdir -p "$OUT/prof.logs"; cp $R/.git/squeal/logs/* "$OUT/prof.logs/" 2>/dev/null
  log "profile done"
}

case ${1:-all} in
  groups)
    for i in 1 2 3; do IDLE=90 rep group-$i warm 1 1 HEAD~1; done
    three
    ;;
  quiet)
    for i in 1 2 3; do rep quiet-$i warm 1 0 HEAD~1; done
    profile
    ;;
  all)
    installs
    for i in 1 2 3; do rep cold-$i cold 1 0 HEAD~1; done
    for i in 1 2 3; do rep warm-$i warm 1 1 HEAD~1; done
    for i in 1 2 3; do rep both-$i warm 0 0 HEAD~1; done
    three
    profile
    ;;
  *) "$@" ;;
esac
log ALL-DONE
