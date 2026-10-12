#!/bin/sh
# Throwaway (005-04). One Codex subject session: run-codex.sh <label> <cwd> <prompt>
# Scratch CODEX_HOME (env.sh), gpt-6-luna, JSON events to $W/logs/<label>.jsonl.
. "$(dirname "$0")/env.sh"
label=$1 cwd=$2 prompt=$3
mkdir -p "$W/logs"
echo "$(date -Is) $label codex start load $(load)" | tee -a "$W/logs/sessions.txt"
cd "$cwd" && timeout -k 10 900 codex exec --json -s danger-full-access --skip-git-repo-check -m gpt-6-luna \
  -c 'model_reasoning_effort="low"' "$prompt" > "$W/logs/$label.jsonl" 2> "$W/logs/$label.err" < /dev/null
echo "$(date -Is) $label codex exit $? load $(load)" | tee -a "$W/logs/sessions.txt"
