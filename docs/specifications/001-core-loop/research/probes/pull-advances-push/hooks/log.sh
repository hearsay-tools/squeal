#!/bin/bash
# Throwaway: record hook stdin fields and the hook's own identity-relevant env.
IN=$(cat)
ENVJ=$(env | grep -E '^(CLAUDE|CLAUDECODE)' | grep -v -E 'TOKEN|SOCKET' | sort | sed 's/"/\\"/g;s/^/"/;s/$/"/' | paste -sd, -)
echo "{\"t_ms\":$(date +%s%3N),\"pid\":$$,\"ppid\":$PPID,\"event\":\"$1\",\"env\":[${ENVJ}],\"in\":$IN}" >> "$PROBE_LOG"
exit 0
