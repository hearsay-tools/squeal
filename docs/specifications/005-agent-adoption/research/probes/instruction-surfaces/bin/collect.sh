#!/usr/bin/env bash
# Throwaway: trimmed evidence into logs/: the measured rows, each session's
# tool calls and final message, the ground truth line, and the canary extracts.
set -e; source "$(dirname "$0")/env.sh"; cd "$PROBES"
labels=$(ls $R/logs/*.t1 | xargs -n1 basename | sed 's/\.t1$//' | grep -v '^can-')
node bin/measure.mjs $labels --json > logs/sessions.json
node bin/measure.mjs $labels > logs/sessions.tsv
for L in $labels; do
  node bin/calls.mjs $R/logs/$L.events.jsonl > logs/$L.calls.txt
  grep -E "Tests |Test Files|exit" $R/logs/$L.truth.txt > logs/$L.truth.txt || true
done
for L in can-c can-c2 can-c3 can-c4 can-x can-x3; do node bin/calls.mjs $R/logs/$L.events.jsonl > logs/$L.calls.txt; done
