#!/bin/sh
# Regenerates logs/ from the 002-19 sources, all read only. Never reads
# ~/.codex/auth.json or config.toml and never writes the store.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
rollout=${ROLLOUT:-$HOME/.codex/sessions/2026/10/08/rollout-2026-10-08T00-48-51-01a1188e-2475-7030-aa81-c1396f0402c1.jsonl}
store=${STORE:-/home/agent/projects/squeal/.git/squeal/store.sqlite}
mkdir -p "$here/logs"
node "$here/timeline.mjs" "$rollout" --full-squeal > "$here/logs/timeline.txt"
node "$here/gaps.mjs" "$rollout" > "$here/logs/gaps.txt"
node "$here/cli.mjs" "$rollout" 2500 > "$here/logs/squeal-commands.txt"
node "$here/store.mjs" "$store" b2baa0c8131a6dc2 2026-10-07T22:48:51.318Z > "$here/logs/store.txt"
