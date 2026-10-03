#!/bin/bash
# Throwaway: deny Write/Edit to any path containing "forbidden" via JSON permissionDecision.
IN=$("$(dirname "$0")/log.sh" deny-json)
FP=$(jq -r '.tool_input.file_path // .tool_input.notebook_path // ""' <<<"$IN")
if [[ "$FP" == *forbidden* ]]; then
  jq -nc '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",
    permissionDecisionReason:"SQUEAL-PROBE: tests/auth.test.ts is FAIL at revision 7; writing forbidden.txt is blocked. Write the same content to allowed.txt instead."}}'
fi
exit 0
