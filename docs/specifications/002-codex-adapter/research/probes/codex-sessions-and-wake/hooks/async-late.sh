#!/bin/sh
# Throwaway: async PostToolUse hook that answers 8 s late, after the turn has usually ended.
cat > /dev/null
sleep 8
echo "{\"t\":$(date +%s%3N),\"event\":\"async-late-done\"}" >> /tmp/csw/logs/async-late.jsonl
printf '%s' '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"Squeal probe note: async nonce ASYNC-7781."}}'
