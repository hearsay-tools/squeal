#!/bin/sh
# One Codex session in the cezar worktree with the installed Squeal plugin, its hooks as
# trusted in the real ~/.codex (no bypass flag), plus a status poll beside it.
# Usage: bin/session.sh <id> <prompt file>
# Writes logs/<id>.exec.jsonl (codex exec --json), logs/<id>.poll.txt, logs/<id>.times.txt.
set -eu
id=$1 prompt=$2
here=$(cd "$(dirname "$0")/.." && pwd)
WT=/tmp/squeal-dogfood-cezarion-56f54ae1
CLI=$HOME/.codex/plugins/cache/squeal/squeal/0.1.31/dist/cli/squeal.mjs
node "$here/poll-status.mjs" "$CLI" "$WT" 2 3600 > "$here/logs/$id.poll.txt" 2>&1 &
poll=$!
echo "start $(date -u +%FT%T.%3NZ) load $(cut -d' ' -f1-3 /proc/loadavg)" > "$here/logs/$id.times.txt"
codex exec --json -C "$WT" -s danger-full-access -m gpt-6.1-sol "$(cat "$prompt")" > "$here/logs/$id.exec.jsonl" 2> "$here/logs/$id.exec.stderr.txt" || echo "codex exit $?" >> "$here/logs/$id.times.txt"
echo "end $(date -u +%FT%T.%3NZ) load $(cut -d' ' -f1-3 /proc/loadavg)" >> "$here/logs/$id.times.txt"
sleep 90
kill "$poll"
