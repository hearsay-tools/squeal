#!/usr/bin/env bash
# Task 001-143 evidence, not product code. `rounds.sh` with <burners> busy
# loops held through it (started 5 s ahead), each ended by `timeout` and killed
# on exit, as 001-137's arm.sh; at most 8 on the shared host.
# Usage: arm.sh <burners> <rounds.sh arguments ...>
set -u
burners=$1; shift
here=$(cd "$(dirname "$0")" && pwd)
[ "$burners" -le 8 ] || { echo "at most 8 burners on the shared host" >&2; exit 2; }
pids=()
for _ in $(seq 1 "$burners"); do timeout 1500 node -e 'for(;;){}' squeal137-burn & pids+=($!); done
trap 'kill "${pids[@]}" 2>/dev/null' EXIT
sleep 5
echo "burners $burners up $(date -u +%FT%TZ)"
"$here/rounds.sh" "$@"
echo "done $(date -u +%FT%TZ)"
