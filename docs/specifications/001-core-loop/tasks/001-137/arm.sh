#!/usr/bin/env bash
# Task 001-137 evidence, not product code: pairs <first> to <last> of one arm,
# <burners> busy loops held through them (started 5 s ahead), each ended by
# `timeout` and killed on exit. The measurement used 24; the coordinator then
# capped it at 8 on the shared host (2026-10-08), so this refuses more.
# A warmup pair is the same with label warm<label>.
# Usage: arm.sh <clone> <out dir> <burners> <first pair> <last pair> <label>
set -u
clone=$1; out=$2; burners=$3; first=$4; last=$5; label=$6
here=$(cd "$(dirname "$0")" && pwd)
[ "$burners" -le 8 ] || { echo "at most 8 burners on the shared host" >&2; exit 2; }
mkdir -p "$out"
pids=()
for _ in $(seq 1 "$burners"); do timeout 900 node -e 'for(;;){}' squeal137-burn & pids+=($!); done
trap 'kill "${pids[@]}" 2>/dev/null' EXIT
sleep 5
echo "burners $burners up $(date -u +%FT%TZ)"
"$here/rounds.sh" "$clone" "$out" "$first" "$last" 23 "$label"
echo "done $(date -u +%FT%TZ)"
