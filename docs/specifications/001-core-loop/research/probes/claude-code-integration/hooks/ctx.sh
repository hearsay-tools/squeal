#!/bin/bash
# Throwaway: return additionalContext with a random nonce for the event in $1.
EV="$1"
IN=$("$(dirname "$0")/log.sh" "$EV")
N=$(head -c4 /dev/urandom | od -An -tx1 | tr -d ' \n')
T=$(date +%s%3N)
echo "{\"t_ms\":$T,\"ev\":\"$EV\",\"nonce\":\"$N\",\"tool_use_id\":$(jq '.tool_use_id // null' <<<"$IN")}" >> "$PROBE_LOG_DIR/$PROBE_SCN.nonces.log"
jq -nc --arg ev "$EV" --arg c "Squeal status note: nonce $EV-$N issued at $T ms." \
  '{hookSpecificOutput:{hookEventName:$ev,additionalContext:$c}}'
