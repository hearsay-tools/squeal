#!/usr/bin/env bash
# Runs the Squeal performance benchmark on a fresh boat.dev sandbox and
# copies the results back to bench/results/<date>-<version>-<cpu>/.
#
# Usage: bench/boat-run.sh [--ref <git ref>]... [--type default] [--cpu "<model>"] [--cells ref,wt-3] [--steps 24] [--keep]
#
# --ref: test the plugin as committed at that ref (for example squeal--v0.1.572);
# `.` is this worktree's plugins/claude-code, the default without --ref. Give
# --ref twice or more to compare versions: one sandbox runs every cell once per
# version, alternating the order, so the versions always share the machine.
# The harness is always this worktree's bench/.
#
# The sandbox type fixes vCPUs and RAM but not the CPU model. --cpu makes the
# script create sandboxes until one has that CPU (each try costs one start of
# the plan's hourly and daily limits) and delete the others; without it any CPU
# is taken. A paired run never needs it. It uses --no-env, so the sandbox gets
# none of the account's stored secrets; the benchmark needs none.
set -euo pipefail
cd "$(dirname "$0")/.."
TYPE=default
CPU=""
CELLS=""
STEPS=24
KEEP=0
REFS=()
TRIES=12
while [ $# -gt 0 ]; do
  case $1 in
    --type) TYPE=$2; shift 2 ;;
    --cpu) CPU=$2; shift 2 ;;
    --cells) CELLS=$2; shift 2 ;;
    --steps) STEPS=$2; shift 2 ;;
    --keep) KEEP=1; shift ;;
    --ref) REFS+=("$2"); shift 2 ;;
    *) echo "unknown argument $1" >&2; exit 2 ;;
  esac
done

# The Boat API sometimes times out; retry each call a few times before giving up.
retry() {
  for _ in 1 2 3 4 5; do
    "$@" && return 0
    sleep 20
  done
  return 1
}

[ ${#REFS[@]} -gt 0 ] || REFS=(.)
PLUGINS=()
for ref in "${REFS[@]}"; do
  if [ "$ref" = . ]; then
    PLUGINS+=(plugins/claude-code)
  else
    # Outside any git checkout: `boat push` skips files git ignores, and this task's temp folder is ignored.
    dir=$(mktemp -d /tmp/squeal-bench-plugin.XXXXXX)/claude-code
    mkdir -p "$dir"
    git archive "$ref" plugins/claude-code | tar x -C "$dir" --strip-components=2
    PLUGINS+=("$dir")
  fi
done

ID=""
cleanup() {
  if [ -n "$ID" ] && [ "$KEEP" = 0 ]; then boat delete "$ID" --yes >/dev/null 2>&1 || true; fi
  for d in "${PLUGINS[@]}"; do
    case $d in /tmp/squeal-bench-plugin.*) rm -rf "$(dirname "$d")" ;; esac
  done
}
trap cleanup EXIT

for try in $(seq "$TRIES"); do
  if ! ID=$(retry boat new --type "$TYPE" --no-env --ttl 21600 --name squeal-bench --json | tail -1 | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).id'); then
    echo "try $try: boat new failed"
    ID=""
    continue
  fi
  MODEL=$(boat ssh "$ID" -- 'grep -m1 "model name" /proc/cpuinfo | cut -d: -f2' 2>/dev/null | tr -s ' ' | sed 's/^ //')
  echo "try $try: $ID has $MODEL"
  if [ -z "$CPU" ] || [[ "$MODEL" == *"$CPU"* ]]; then break; fi
  boat delete "$ID" --yes >/dev/null 2>&1 || true
  ID=""
done
[ -n "$ID" ] || { echo "no sandbox with CPU '$CPU' after $TRIES tries" >&2; exit 1; }

# A push right after `boat new` has been lost once (2026-11-20), so push until the files are there.
CHECK="test -f /home/user/bench/run-all.mjs"
ARGS="--out /home/user/results --steps $STEPS"
for i in "${!PLUGINS[@]}"; do
  CHECK="$CHECK && test -f /home/user/plugin-$i/dist/cli/squeal.mjs"
  ARGS="$ARGS --plugin /home/user/plugin-$i"
done
pushed() { boat ssh "$ID" -- "$CHECK" >/dev/null 2>&1; }
for _ in 1 2 3 4 5; do
  pushed && break
  sleep 10
  for i in "${!PLUGINS[@]}"; do
    boat push "$ID" "${PLUGINS[$i]}" --to "/home/user/plugin-$i" >/dev/null || true
  done
  boat push "$ID" bench --to /home/user/bench >/dev/null || true
done
pushed || { echo "push to $ID failed" >&2; exit 1; }
[ -n "$CELLS" ] && ARGS="$ARGS --cells $CELLS"
retry boat ssh "$ID" -- "cd /home/user && { [ -e run.log ] || (setsid nohup node bench/run-all.mjs $ARGS > run.log 2>&1 < /dev/null &); }"
sleep 10
boat ssh "$ID" -- 'test -e /home/user/run.log' >/dev/null 2>&1 || { echo "run did not start on $ID" >&2; exit 1; }
echo "started on $ID; progress: boat ssh $ID -- tail -f /home/user/run.log"

until boat ssh "$ID" -- 'test -f /home/user/results/scorecard.md' >/dev/null 2>&1; do
  sleep 120
  boat ssh "$ID" -- 'tail -1 /home/user/run.log' 2>/dev/null || true
done

VERSION=$(for d in "${PLUGINS[@]}"; do node -p "require('$(realpath "$d")/package.json').version"; done | paste -sd_ | sed 's/_/-vs-/g')
SLUG=$(echo "$MODEL" | tr -cs 'A-Za-z0-9' '-' | sed 's/-$//')
DEST="bench/results/$(date -u +%Y-%m-%d)-$VERSION-$TYPE-$SLUG"
n=2
while [ -e "$DEST" ]; do DEST="bench/results/$(date -u +%Y-%m-%d)-$VERSION-$TYPE-$SLUG-$n"; n=$((n + 1)); done
mkdir -p "$DEST"
retry boat ssh "$ID" -- 'cd /home/user && cp run.log results/ && tar czf /tmp/results.tgz results' >/dev/null
retry boat scp "$ID:/tmp/results.tgz" "$DEST/results.tgz" >/dev/null
tar xzf "$DEST/results.tgz" -C "$DEST" --strip-components=1 && rm "$DEST/results.tgz"
echo "results in $DEST"
node bench/trend.mjs >/dev/null
cat "$DEST/scorecard.md"
