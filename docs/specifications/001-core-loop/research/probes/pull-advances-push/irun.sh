#!/bin/bash
# Throwaway: interactive claude in tmux (own socket "sq84") in a fresh scratch repo.
# Usage: irun.sh <scenario> <prompt>
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"; SCN="$1"; PROMPT="$2"
DIR="/tmp/sq84/$SCN"
rm -rf "$DIR"; mkdir -p "$DIR"; cp -r "$HERE/scenario-template/.claude" "$DIR/"; [ -n "${TEMPLATE:-}" ] && cp -r "$HERE/$TEMPLATE/.claude/." "$DIR/.claude/"
cp "$HERE/hooks/probe.sh" "$HERE/hooks/emit.sh" "$DIR/"
(cd "$DIR" && git init -q && git add -A && git -c user.email=p@p -c user.name=p commit -qm init)
rm -f "$HERE/logs/$SCN".*
tmux -L sq84 kill-session -t "$SCN" 2>/dev/null
tmux -L sq84 new-session -d -s "$SCN" -x 200 -y 50 -c "$DIR" \
  env -u CLAUDECODE -u CLAUDE_CODE_CHILD_SESSION -u CLAUDE_CODE_ENTRYPOINT -u CLAUDE_CODE_SESSION_ID \
      -u CLAUDE_CODE_MESSAGING_SOCKET -u CLAUDE_CODE_MESSAGING_TOKEN -u CLAUDE_CODE_SESSION_ATTENDED \
      -u CLAUDE_PID -u CLAUDE_EFFORT -u CLAUDE_CODE_EXECPATH \
      $(env | cut -d= -f1 | grep '^CEZ_' | sed 's/^/-u /') \
      DISABLE_AUTOUPDATER=1 PROBE_LOG="$HERE/logs/$SCN.hooks.jsonl" PROBE_OUT="$HERE/logs/$SCN.probe.txt" PROBE_HOOKS="$HERE/hooks" \
  claude --setting-sources project --allowedTools Bash Agent Task --model sonnet "$PROMPT"
echo "started $SCN"
