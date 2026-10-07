#!/usr/bin/env bash
# Throwaway: one `codex exec` run in /tmp/p16/<repo> with the store watcher on.
#   run-exec.sh <repo> <prompt-file> <label>
source "$(dirname "$0")/env.sh"
R=/tmp/p16/$1; L=$P/logs/$3
node "$PROOF_BIN/watch.mjs" "$R" > "$L.store.jsonl" & WP=$!
cd "$R"; date +%s%3N > "$L.t0"
RUST_LOG=codex_hooks=debug,codex_core::hook_runtime=debug timeout 900 codex exec --json -s danger-full-access "$(cat "$2")" > "$L.events.jsonl" 2> "$L.stderr.txt"
echo "exit $?" >> "$L.stderr.txt"; date +%s%3N > "$L.t1"
sleep 3; kill $WP
