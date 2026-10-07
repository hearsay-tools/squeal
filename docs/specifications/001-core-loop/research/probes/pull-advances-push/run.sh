#!/bin/bash
# Throwaway: run `claude -p` in a fresh scratch git repo under /tmp/sq84/<scenario>
# with a scrubbed environment (no variables inherited from the calling session).
# Usage: run.sh <scenario> <prompt> [extra claude args...]
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
SCN="$1"; shift; PROMPT="$1"; shift
DIR="/tmp/sq84/$SCN"
rm -rf "$DIR"; mkdir -p "$DIR"; cp -r "$HERE/scenario-template/.claude" "$DIR/"; [ -n "${TEMPLATE:-}" ] && cp -r "$HERE/$TEMPLATE/.claude/." "$DIR/.claude/"
cp "$HERE/hooks/probe.sh" "$HERE/hooks/emit.sh" "$DIR/"
(cd "$DIR" && git init -q && git add -A && git -c user.email=p@p -c user.name=p commit -qm init)
rm -f "$HERE/logs/$SCN".*
cd "$DIR" || exit 1
env -u CLAUDECODE -u CLAUDE_CODE_CHILD_SESSION -u CLAUDE_CODE_ENTRYPOINT \
    -u CLAUDE_CODE_SESSION_ID -u CLAUDE_CODE_MESSAGING_SOCKET -u CLAUDE_CODE_MESSAGING_TOKEN \
    -u CLAUDE_CODE_SESSION_ATTENDED -u CLAUDE_PID -u CLAUDE_EFFORT -u CLAUDE_CODE_EXECPATH \
    $(env | cut -d= -f1 | grep '^CEZ_' | sed 's/^/-u /') \
    DISABLE_AUTOUPDATER=1 PROBE_LOG="$HERE/logs/$SCN.hooks.jsonl" PROBE_OUT="$HERE/logs/$SCN.probe.txt" PROBE_HOOKS="$HERE/hooks" \
  claude -p "$PROMPT" --setting-sources project --permission-mode "${PERM_MODE:-bypassPermissions}" \
    --model sonnet --output-format stream-json --verbose --include-hook-events \
    "$@" < /dev/null > "$HERE/logs/$SCN.stream.jsonl" 2> "$HERE/logs/$SCN.stderr"
echo "exit=$?"
