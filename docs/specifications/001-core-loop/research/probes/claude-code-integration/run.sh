#!/bin/bash
# Throwaway: run `claude -p` in a scenario scratch dir with a clean env.
# Usage: run.sh <scenario> <prompt> [extra claude args...]
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
SCN="$1"; shift; PROMPT="$1"; shift
DIR="$HERE/scenarios/$SCN"
OUT="$HERE/logs/$SCN.stream.jsonl"
rm -f "$HERE/logs/$SCN".hook*.log
cd "$DIR" || exit 1
env -u CLAUDECODE -u CLAUDE_CODE_CHILD_SESSION -u CLAUDE_CODE_ENTRYPOINT \
    -u CLAUDE_CODE_SESSION_ID -u CLAUDE_CODE_MESSAGING_SOCKET -u CLAUDE_CODE_MESSAGING_TOKEN \
    -u CLAUDE_CODE_SESSION_ATTENDED -u CLAUDE_PID -u CLAUDE_EFFORT \
    DISABLE_AUTOUPDATER=1 PROBE_LOG_DIR="$HERE/logs" PROBE_HOOKS="$HERE/hooks" PROBE_SCN="$SCN" \
  claude -p "$PROMPT" --setting-sources project --permission-mode bypassPermissions \
    --model sonnet --output-format stream-json --verbose --include-hook-events \
    --no-session-persistence "$@" > "$OUT" 2> "$HERE/logs/$SCN.stderr"
echo "exit=$? out=$OUT"
