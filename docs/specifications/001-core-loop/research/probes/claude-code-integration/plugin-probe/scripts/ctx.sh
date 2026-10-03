#!/bin/bash
# Throwaway: plugin hook. Logs its env and returns additionalContext.
IN=$(cat)
echo "{\"root\":\"$CLAUDE_PLUGIN_ROOT\",\"argv0\":\"$0\",\"project\":\"$CLAUDE_PROJECT_DIR\",\"ev\":$(jq .hook_event_name <<<"$IN")}" >> "$PROBE_LOG_DIR/plugin.env.log"
jq -nc '{hookSpecificOutput:{hookEventName:"PostToolBatch",additionalContext:"Squeal status note from plugin: nonce plugin-5150."}}'
