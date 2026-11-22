#!/usr/bin/env bash
# Row 023-40c measurement driver (second run of 023-40-measure's method); runs on the sandbox. Writes ~/out/.
set -uo pipefail
R=${R:-$HOME/r}
OUT=${OUT:-$HOME/out}
S="node $HOME/m/plugin/dist/cli/squeal.mjs"
FILE=test/daemon/commit-removal.test.ts
IDLE=${IDLE:-30}
groupfiles() { ls test/scheduler/*.test.ts | head -40; }
T=~/m/tools
STORE=$(cd $R && pnpm store path)
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

# The worktree daemon at the tip serves, then every Squeal process is quiet
# (under 0.1 s CPU in each of three 2 s windows), at most 180 s more.
wt_idle() {
  cd $R
  local a b
  a=$(ms)
  $S start >/dev/null 2>&1
  for _ in $(seq 360); do
    grep -qs "serving $R on" $R/.git/squeal/logs/daemon-*.log && break
    sleep 0.5
  done
  b=$(ms)
  node $T/quiet.mjs 180
  log "worktree daemon serving after $((b - a)) ms, quiet after $(($(ms) - a)) ms"
}

# rep <label> <cold|warm> <prewarm 0|1> <group 0|1> <commit ref>
rep() {
  local label=$1 store=$2 prewarm=$3 group=$4 ref=$5
  log "rep $label: store $store, worktree daemon first $prewarm, group $group, at $ref"
  reset
  [ "$store" = cold ] && rm -rf "$STORE"
  [ "$prewarm" = 1 ] && wt_idle
  cd $R
  node $T/sampler.mjs "$OUT/$label.samples.jsonl" $R $FILE &
  local sp=$!
  local t0 t1 t2 t3 g0 g1 s0 s1 s2 code code2 gcode=""
  t0=$(ms)
  $S status --at $ref $FILE --run > "$OUT/$label.call.out" 2> "$OUT/$label.call.err"
  code=$?
  t1=$(ms)
  # The second call at the same commit: its commit daemon is up.
  sleep 2
  t2=$(ms)
  $S status --at $ref $FILE --run > "$OUT/$label.call2.out" 2> "$OUT/$label.call2.err"
  code2=$?
  t3=$(ms)
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
  echo "{\"label\":\"$label\",\"store\":\"$store\",\"prewarm\":$prewarm,\"ref\":\"$ref\",\"t0\":$t0,\"t1\":$t1,\"code\":$code,\"t2\":$t2,\"t3\":$t3,\"code2\":$code2,\"g0\":${g0:-null},\"g1\":${g1:-null},\"gcode\":\"$gcode\",\"s0\":$s0,\"s1\":$s1,\"s2\":$s2,\"treeLeft\":$([ -e "$tree" ] && echo true || echo false)}" > "$OUT/$label.times.json"
  log "rep $label done: call $((t1 - t0)) ms exit $code; second call $((t3 - t2)) ms exit $code2; stop $((s1 - s0)) ms, gone $((s2 - s0)) ms"
}

installs() {
  cd $R
  for kind in cold warm; do
    for i in 1 2 3; do
      [ "$kind" = cold ] && rm -rf "$STORE"
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
    ( $S status --at HEAD~$c $FILE --run > "$OUT/$label.call$c.out" 2> "$OUT/$label.call$c.err"; echo "{\"event\":\"call$c-done\",\"code\":$?,\"t\":$(ms)}" >> "$OUT/$label.marks.jsonl" ) &
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
  local label=${1:-prof} prewarm=${2:-1}
  log "profile $label"
  reset
  [ "$prewarm" = 1 ] && wt_idle
  cd $R
  rm -rf "$OUT/$label"; mkdir -p "$OUT/$label"
  node $T/sampler.mjs "$OUT/$label.samples.jsonl" $R $FILE &
  local sp=$!
  local t0; t0=$(ms)
  NODE_OPTIONS="--cpu-prof --cpu-prof-dir=$OUT/$label" $S status --at HEAD~1 $FILE --run > "$OUT/$label.call.out" 2> "$OUT/$label.call.err"
  echo "{\"t0\":$t0,\"t1\":$(ms)}" > "$OUT/$label.times.json"
  sleep 10
  $S stop --at HEAD~1 > "$OUT/$label.stop.out" 2>&1
  sleep 3
  $S stop > /dev/null 2>&1
  sleep 3
  kill $sp
  mkdir -p "$OUT/$label.logs"; cp $R/.git/squeal/logs/* "$OUT/$label.logs/" 2>/dev/null
  log "profile $label done"
}

case ${1:-all} in
  all)
    installs
    for i in 1 2 3; do rep quiet-$i warm 1 0 HEAD~1; done
    for i in 1 2 3; do IDLE=90 rep group-$i warm 1 1 HEAD~1; done
    for i in 1 2 3; do rep cold-$i cold 1 0 HEAD~1; done
    for i in 1 2 3; do rep both-$i warm 0 0 HEAD~1; done
    profile prof 1
    profile prof-both 0
    three
    ;;
  *) "$@" ;;
esac
log ALL-DONE
