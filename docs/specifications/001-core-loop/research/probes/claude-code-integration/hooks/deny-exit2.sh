#!/bin/bash
# Throwaway: block Bash commands that contain "date" via exit 2 + stderr.
IN=$("$(dirname "$0")/log.sh" deny-exit2)
CMD=$(jq -r '.tool_input.command // ""' <<<"$IN")
if [[ "$CMD" == *date* ]]; then
  echo "SQUEAL-PROBE-EXIT2: the date command is blocked in this repo. Use: echo today instead." >&2
  exit 2
fi
exit 0
