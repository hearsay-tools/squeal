#!/bin/bash
# Throwaway: async probe. Sleeps $2 s, then returns additionalContext with a nonce (exit 0).
LABEL="$1"; DELAY="$2"
IN=$("$(dirname "$0")/log.sh" "slowctx-$LABEL")
N=$(head -c4 /dev/urandom | od -An -tx1 | tr -d ' \n')
echo "{\"t_ms\":$(date +%s%3N),\"ev\":\"async-start\",\"label\":\"$LABEL\",\"nonce\":\"$N\"}" >> "$PROBE_LOG_DIR/$PROBE_SCN.nonces.log"
sleep "$DELAY"
T=$(date +%s%3N)
echo "{\"t_ms\":$T,\"ev\":\"async-exit0\",\"label\":\"$LABEL\",\"nonce\":\"$N\"}" >> "$PROBE_LOG_DIR/$PROBE_SCN.nonces.log"
jq -nc --arg c "Squeal status note: async $LABEL-$N at $T ms." '{hookSpecificOutput:{hookEventName:"PostToolUse",additionalContext:$c}}'
