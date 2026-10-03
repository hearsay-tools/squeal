#!/bin/bash
# Throwaway: asyncRewake probe. Sleeps $2 seconds, then exits 2 with a nonce on stderr.
LABEL="$1"; DELAY="$2"
IN=$("$(dirname "$0")/log.sh" "rewake-$LABEL")
N=$(head -c4 /dev/urandom | od -An -tx1 | tr -d ' \n')
echo "{\"t_ms\":$(date +%s%3N),\"ev\":\"rewake-start\",\"label\":\"$LABEL\",\"nonce\":\"$N\"}" >> "$PROBE_LOG_DIR/$PROBE_SCN.nonces.log"
sleep "$DELAY"
T=$(date +%s%3N)
echo "{\"t_ms\":$T,\"ev\":\"rewake-exit2\",\"label\":\"$LABEL\",\"nonce\":\"$N\"}" >> "$PROBE_LOG_DIR/$PROBE_SCN.nonces.log"
echo "Squeal status note: check tests/auth.test.ts went PASS -> FAIL (rewake $LABEL-$N at $T ms)." >&2
exit 2
