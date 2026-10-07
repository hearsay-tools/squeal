#!/usr/bin/env bash
# Throwaway: one Cezar-shaped app-server thread in /tmp/p16/<repo> with the
# store watcher on.   run-as.sh <repo> <label> <cz.mjs args...>
source "$(dirname "$0")/env.sh"
R=/tmp/p16/$1; L=$P/logs/$2; shift 2
node "$PROOF_BIN/watch.mjs" "$R" > "$L.store.jsonl" & WP=$!
date +%s%3N > "$L.t0"
AS_LOG="$L.as.jsonl" timeout 1500 node "$PROOF_BIN/cz.mjs" "$R" "$@" > "$L.out.txt" 2>&1
echo "exit $?" >> "$L.out.txt"; date +%s%3N > "$L.t1"
sleep 3; kill $WP
