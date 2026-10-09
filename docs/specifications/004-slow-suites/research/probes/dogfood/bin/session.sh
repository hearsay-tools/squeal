#!/bin/sh
# One Codex session in a dogfood worktree with the installed Squeal plugin, its hooks as
# trusted in the real ~/.codex (no bypass flag).
# Usage: bin/session.sh <id> <worktree> <prompt file> [<session id to resume>]
# Writes logs/<id>.exec.jsonl (codex exec --json, not kept), logs/<id>.times.txt.
# The status poll runs beside it separately (poll-status.mjs), for the whole place.
set -eu
id=$1 wt=$2 prompt=$3 resume=${4:-}
here=$(cd "$(dirname "$0")/.." && pwd)
echo "start $(date -u +%FT%T.%3NZ) load $(cut -d' ' -f1-3 /proc/loadavg)" > "$here/logs/$id.times.txt"
if [ -z "$resume" ]; then
  codex exec --json -C "$wt" -s danger-full-access -m gpt-6.1-sol "$(cat "$prompt")" \
    > "$here/logs/$id.exec.jsonl" 2> "$here/logs/$id.exec.stderr.txt" || echo "codex exit $?" >> "$here/logs/$id.times.txt"
else
  (cd "$wt" && codex exec resume --json -c sandbox_mode='"danger-full-access"' -m gpt-6.1-sol "$resume" "$(cat "$prompt")") \
    > "$here/logs/$id.exec.jsonl" 2> "$here/logs/$id.exec.stderr.txt" || echo "codex exit $?" >> "$here/logs/$id.times.txt"
fi
echo "end $(date -u +%FT%T.%3NZ) load $(cut -d' ' -f1-3 /proc/loadavg)" >> "$here/logs/$id.times.txt"
