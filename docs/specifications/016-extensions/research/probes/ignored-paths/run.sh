#!/usr/bin/env bash
# Throwaway (016-19). Usage: run.sh <repo> <label> <command...>
# Runs one suite in $S/<repo> under nice -n 10 and the host's full-run lock, with the
# kind-tagged recorder in NODE_OPTIONS, a clean env (no CEZ_*/SQUEAL_* of this session)
# and the scratch HOME, XDG_* and TMPDIR. Refuses (exit 75) when the one-minute load is
# not below the CPU count. Writes $S/out/<label>/{*.ndjson,meta.txt,log.txt}.
set -uo pipefail
S=${S:-/tmp/ip-016-19}
repo=$1 label=$2; shift 2
root=$S/$repo out=$S/out/$label
load=$(cut -d' ' -f1 /proc/loadavg); cpus=$(nproc)
if ! awk -v l="$load" -v c="$cpus" 'BEGIN{exit !(l<c)}'; then echo "load $load >= $cpus cpus: refused"; exit 75; fi
rm -rf "$out"; mkdir -p "$out/rec"
rec=$S/rec/src/runners/observe/recorder.cjs
settings=$(printf '{"out":"%s","root":"%s","skip":["%s"]}' "$out/rec" "$root" "$S/tmp")
start=$(date +%s.%N); before=$(cat /proc/loadavg)
( cd "$root" && flock "/run/user/$(id -u)/squeal-full-run.lock" env -i \
    PATH="$PATH" LANG=C.UTF-8 HOME="$S/home" XDG_RUNTIME_DIR="$S/run" XDG_CONFIG_HOME="$S/config" \
    XDG_CACHE_HOME="$S/cache" XDG_DATA_HOME="$S/data" XDG_STATE_HOME="$S/state" TMPDIR="$S/tmp" \
    NODE_OPTIONS="--import file://$rec" SQUEAL_OBSERVE="$settings" IP_EXTRA="${IP_EXTRA:-}" \
    nice -n 10 "$@" ) >"$out/log.txt" 2>&1
code=$?
end=$(date +%s.%N)
printf 'command: %s\nexit: %s\nwall_s: %.0f\nload_before: %s\nload_after: %s\n' \
  "$*" "$code" "$(echo "$end - $start" | bc)" "$before" "$(cat /proc/loadavg)" | tee "$out/meta.txt"
