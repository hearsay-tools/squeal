#!/bin/bash
# Runs test/daemon/escaped.test.ts $2 times on 2 CPUs beside 2 busy loops; one line per run, a failing
# run's output kept in $3. Usage: loop.sh <worktree> <runs> <log dir>.
# CPUS picks the 2 CPUs, 0-1 by default.
cd "$1" || exit 2
runs=$2 logs=$3 cpus=${CPUS:-0-1}
mkdir -p "$logs"
trap 'kill $h1 $h2 2>/dev/null' EXIT
taskset -c "$cpus" node -e 'for(;;){}' >/dev/null 2>&1 & h1=$!
taskset -c "$cpus" node -e 'for(;;){}' >/dev/null 2>&1 & h2=$!
for i in $(seq "$runs"); do
  log=$(mktemp)
  if taskset -c "$cpus" env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 \
    timeout 600 npx vitest run test/daemon/escaped.test.ts >"$log" 2>&1; then r=pass; else r=FAIL; fi
  why=$(grep -m1 -E "not met|Error|expected|timed out" "$log" | cut -c1-200)
  echo "run $i $r $(grep -m1 -oE 'Tests +[0-9a-z |]+' "$log") ${why:+:: $why} (load $(cut -d' ' -f1 /proc/loadavg))"
  if [ $r = FAIL ]; then mv "$log" "$logs/run-$i.log"; else rm -f "$log"; fi
done
