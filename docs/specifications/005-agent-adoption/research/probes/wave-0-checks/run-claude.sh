#!/bin/sh
# Throwaway (005-04). One Claude Code subject session: run-claude.sh <label> <cwd> <prompt> [flags...]
# Scratch homes (env.sh), Haiku 5.5, stream-json with hook events, to $W/logs/<label>.jsonl.
. "$(dirname "$0")/env.sh"
label=$1 cwd=$2 prompt=$3; shift 3
mkdir -p "$W/logs"
echo "$(date -Is) $label claude start load $(load)" | tee -a "$W/logs/sessions.txt"
cd "$cwd" && timeout -k 10 600 claude -p "$prompt" --model claude-haiku-5-5 --effort low \
  --output-format stream-json --verbose --include-hook-events "$@" > "$W/logs/$label.jsonl" 2> "$W/logs/$label.err"
echo "$(date -Is) $label claude exit $? load $(load)" | tee -a "$W/logs/sessions.txt"
