#!/usr/bin/env bash
# On a boat.dev sandbox: for each probe bundle named, build a fresh aged
# store, drop the page cache, then run that bundle with another writer beside
# it. Bundle <name> is prune-probe-<name>.bundle.mjs (README.md); extra probe
# flags come from PROBE_FLAGS. Results in /home/user/vt/out/<name>/.
#
# Usage: run-remote.sh <rounds> <list-minutes> <vacuum-minutes> <name>...
set -euo pipefail
cd /home/user/vt
rounds=$1 lm=$2 vm=$3
shift 3
for name in "$@"; do
  out=out/$name
  mkdir -p "$out"
  rm -f /tmp/store.sqlite*
  node build-store.mjs /tmp/store.sqlite "$rounds" > "$out/build.log"
  sync
  sudo sh -c 'echo 3 > /proc/sys/vm/drop_caches'
  secs=$(( (lm + vm) * 60 + 120 ))
  node other-writer.mjs /tmp/store.sqlite "$out/writer.jsonl" "$secs" &
  writer=$!
  # shellcheck disable=SC2086
  node "prune-probe-$name.bundle.mjs" /tmp/store.sqlite "$out/prune.jsonl" "$lm" "$vm" ${PROBE_FLAGS:-} > "$out/probe.log" 2>&1
  kill "$writer" 2>/dev/null || true
  wait "$writer" 2>/dev/null || true
  ls -l /tmp/store.sqlite* >> "$out/probe.log"
done
touch out/DONE
