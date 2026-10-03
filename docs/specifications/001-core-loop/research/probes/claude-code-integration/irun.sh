#!/bin/bash
# Throwaway: start an interactive claude in tmux for a scenario. Usage: irun.sh <scenario> [prompt]
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"; SCN="$1"; PROMPT="${2:-}"
SID=$(cat /proc/sys/kernel/random/uuid); echo "$SID" > "$HERE/logs/$SCN.sid"
rm -f "$HERE/logs/$SCN".hooks.log "$HERE/logs/$SCN".nonces.log "$HERE/logs/$SCN".count
tmux kill-session -t "$SCN" 2>/dev/null
tmux new-session -d -s "$SCN" -x 200 -y 50 -c "$HERE/scenarios/$SCN" \
  env -u CLAUDECODE -u CLAUDE_CODE_CHILD_SESSION -u CLAUDE_CODE_ENTRYPOINT -u CLAUDE_CODE_SESSION_ID \
      -u CLAUDE_CODE_MESSAGING_SOCKET -u CLAUDE_CODE_MESSAGING_TOKEN -u CLAUDE_CODE_SESSION_ATTENDED -u CLAUDE_PID -u CLAUDE_EFFORT \
      DISABLE_AUTOUPDATER=1 PROBE_LOG_DIR="$HERE/logs" PROBE_HOOKS="$HERE/hooks" PROBE_SCN="$SCN" \
  claude --setting-sources project --allowedTools Bash --model sonnet --session-id "$SID" \
     --debug-file "$HERE/logs/$SCN.debug.log" ${PROMPT:+"$PROMPT"}
echo "started $SCN sid=$SID"
