#!/usr/bin/env bash
# Probe 001-343 (throwaway): rounds of the revert-restore probe in scratch copies.
# Usage: rounds.sh <scratch dir> <out dir> <copies> <rounds> <cpus|-> <hogs> <variant...>
# Each round runs <copies> of test/probe/rr-old.test.ts in each variant's copy at once, pinned
# with taskset to <cpus> beside <hogs> busy loops pinned there too (so only these processes starve),
# and logs the load. The env passes SQ_PROBE_* through.
set -u
scratch=$1 out=$2 copies=$3 rounds=$4 cpus=$5 hogs=$6; shift 6
pin=(); [ "$cpus" != "-" ] && pin=(taskset -c "$cpus")
hogpids=()
for _ in $(seq 1 "$hogs"); do "${pin[@]}" node -e 'for(;;){}' & hogpids+=($!); done
trap 'kill "${hogpids[@]}" 2>/dev/null' EXIT
for r in $(seq 1 "$rounds"); do
  [ -e "$out/stop" ] && break
  for v in "$@"; do
    echo "$(date -Is) $v round $r start load $(cut -d' ' -f1-3 /proc/loadavg)" >> "$out/rounds.log"
    mkdir -p "$out/$v"
    pids=()
    for c in $(seq 1 "$copies"); do
      (cd "$scratch/$v" && SQ_PROBE_OUT="$out/$v" "${pin[@]}" env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 npx vitest run test/probe/rr-old.test.ts > "$out/$v/round-$r-$c.log" 2>&1) &
      pids+=($!)
    done
    wait "${pids[@]}"
  done
done
