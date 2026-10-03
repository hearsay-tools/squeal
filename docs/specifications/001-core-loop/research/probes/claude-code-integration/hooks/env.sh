#!/bin/bash
# Throwaway: record which env vars tell -p and interactive sessions apart (names and a few safe values only).
cat >/dev/null
{ echo "--- $PROBE_SCN $1"; env | grep -E '^(CLAUDE_CODE_ENTRYPOINT|CLAUDECODE|CLAUDE_PROJECT_DIR|CLAUDE_CODE_REMOTE|CLAUDE_CODE_SESSION_ATTENDED)=' | sort; } >> "$PROBE_LOG_DIR/entrypoint.env.log"
