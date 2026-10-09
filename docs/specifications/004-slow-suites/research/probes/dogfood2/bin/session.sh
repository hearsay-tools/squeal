#!/usr/bin/env bash
# One `claude -p` session in a dogfood worktree, loading the worktree's own plugin
# (`--plugin-dir`, the hub's squeal@hearsay disabled in .claude/settings.local.json).
# Usage: bin/session.sh <id> <worktree> <prompt file> <log dir> [squeal checkout, default the worktree]
set -u
id=$1 wt=$2 prompt=$3 logs=$4 plugin=${5:-$2}
cd "$wt" || exit 1
echo "start $(date -u +%T.%N)" > "$logs/$id.times.txt"
claude -p --model opus --plugin-dir "$plugin/plugins/claude-code" --permission-mode bypassPermissions \
  --output-format stream-json --verbose < "$prompt" > "$logs/$id.stream.jsonl" 2> "$logs/$id.stderr.txt"
echo "exit $? $(date -u +%T.%N)" >> "$logs/$id.times.txt"
