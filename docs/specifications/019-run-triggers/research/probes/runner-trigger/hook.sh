#!/bin/sh
# Throwaway (019-01). Feeds one fake Claude Code hook input to the worktree's
# committed plugin build. Usage: hook.sh <worktree root> <fixture> <entry> <event> [extra json]
WT=$1; FX=$2; ENTRY=$3; EVENT=$4; EXTRA=${5:-}
printf '{"session_id":"probe-1","cwd":"%s","hook_event_name":"%s"%s}' "$FX" "$EVENT" "$EXTRA" |
  CLAUDE_PLUGIN_ROOT="$WT/plugins/claude-code" node --disable-warning=ExperimentalWarning \
  "$WT/plugins/claude-code/dist/$ENTRY.mjs"
echo; echo "[exit $?]"
