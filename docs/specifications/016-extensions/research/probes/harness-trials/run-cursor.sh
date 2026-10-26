#!/bin/sh
# Throwaway probe (016-35). Run as squeal-e2e. Usage: run-cursor.sh <name> <prompt> [cursor-agent flags...]
# One print-mode Cursor session in ~/ht035/repo. The stream-json output is kept
# whole in ~/ht035/logs/<name>.stream.jsonl and read only through
# cursor-summary.mjs, which drops account fields. The hook log is moved to
# <name>.hooks.jsonl. stdin is /dev/null.
set -u
name=$1 prompt=$2
shift 2
logs=$HOME/ht035/logs
rm -f "$logs/$name".* "$logs"/cursor-once-* "$logs/cursor-hooks.jsonl"
cd "$HOME/ht035/repo"
timeout "${HT_TIMEOUT:-240}" cursor-agent -p --output-format stream-json --trust --force "$@" "$prompt" </dev/null >"$logs/$name.stream.jsonl" 2>"$logs/$name.err.txt"
echo "exit $?" >>"$logs/$name.err.txt"
sleep 2
[ -f "$logs/cursor-hooks.jsonl" ] && mv "$logs/cursor-hooks.jsonl" "$logs/$name.hooks.jsonl"
exit 0
