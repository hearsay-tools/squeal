#!/bin/bash
# Throwaway: like rewake.sh but gives up (exit 0) after $3 wakes per scenario, to stop Stop-armed loops.
LABEL="$1"; DELAY="$2"; MAX="$3"
C="$PROBE_LOG_DIR/$PROBE_SCN.count"
n=$(( $(cat "$C" 2>/dev/null || echo 0) + 1 )); echo $n > "$C"
if (( n > MAX )); then cat >/dev/null; exit 0; fi
exec "$(dirname "$0")/rewake.sh" "$LABEL$n" "$DELAY"
