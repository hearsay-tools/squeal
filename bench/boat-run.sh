#!/usr/bin/env bash
# Runs the Squeal performance benchmark on a fresh boat.dev sandbox and
# copies the results back to bench/results/<date>-<version>-<cpu>/.
#
# Usage: bench/boat-run.sh [--type default] [--cpu "Ryzen 9 9950X"] [--cells ref,wt-3] [--steps 24] [--keep]
#
# The sandbox type fixes vCPUs and RAM but not the CPU model, so the script
# creates sandboxes until one has the wanted CPU (each try costs one start
# from the plan's 200 per day), and deletes the others. It uses --no-env, so
# the sandbox gets none of the account's stored secrets. The benchmark
# needs none. It tests the Claude Code plugin in plugins/claude-code as committed.
set -euo pipefail
cd "$(dirname "$0")/.."
TYPE=default
CPU="Ryzen 9 9950X"
CELLS=""
STEPS=24
KEEP=0
TRIES=12
while [ $# -gt 0 ]; do
  case $1 in
    --type) TYPE=$2; shift 2 ;;
    --cpu) CPU=$2; shift 2 ;;
    --cells) CELLS=$2; shift 2 ;;
    --steps) STEPS=$2; shift 2 ;;
    --keep) KEEP=1; shift ;;
    *) echo "unknown argument $1" >&2; exit 2 ;;
  esac
done

ID=""
cleanup() { if [ -n "$ID" ] && [ "$KEEP" = 0 ]; then boat delete "$ID" --yes >/dev/null 2>&1 || true; fi; }
trap cleanup EXIT

for try in $(seq "$TRIES"); do
  ID=$(boat new --type "$TYPE" --no-env --no-auto-stop --ttl 21600 --name squeal-bench --json 2>/dev/null | tail -1 | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).id')
  MODEL=$(boat ssh "$ID" -- 'grep -m1 "model name" /proc/cpuinfo | cut -d: -f2' 2>/dev/null | tr -s ' ' | sed 's/^ //')
  echo "try $try: $ID has $MODEL"
  if [ -z "$CPU" ] || [[ "$MODEL" == *"$CPU"* ]]; then break; fi
  boat delete "$ID" --yes >/dev/null 2>&1 || true
  ID=""
done
[ -n "$ID" ] || { echo "no sandbox with CPU '$CPU' after $TRIES tries" >&2; exit 1; }

boat push "$ID" plugins/claude-code --to /home/user/claude-code >/dev/null
boat push "$ID" bench --to /home/user/bench >/dev/null
ARGS="--plugin /home/user/claude-code --out /home/user/results --steps $STEPS"
[ -n "$CELLS" ] && ARGS="$ARGS --cells $CELLS"
boat ssh "$ID" -- "cd /home/user && (setsid nohup node bench/run-all.mjs $ARGS > run.log 2>&1 < /dev/null &)"
echo "started on $ID; progress: boat ssh $ID -- tail -f /home/user/run.log"

until boat ssh "$ID" -- 'test -f /home/user/results/scorecard.md' >/dev/null 2>&1; do
  sleep 120
  boat ssh "$ID" -- 'tail -1 /home/user/run.log' 2>/dev/null || true
done

VERSION=$(node -p 'require("./plugins/claude-code/package.json").version')
SLUG=$(echo "$MODEL" | tr -cs 'A-Za-z0-9' '-' | sed 's/-$//')
DEST="bench/results/$(date -u +%Y-%m-%d)-$VERSION-$TYPE-$SLUG"
mkdir -p "$DEST"
boat ssh "$ID" -- 'cd /home/user && cp run.log results/ && tar czf /tmp/results.tgz results' >/dev/null
boat scp "$ID:/tmp/results.tgz" "$DEST/results.tgz" >/dev/null
tar xzf "$DEST/results.tgz" -C "$DEST" --strip-components=1 && rm "$DEST/results.tgz"
echo "results in $DEST"
cat "$DEST/scorecard.md"
