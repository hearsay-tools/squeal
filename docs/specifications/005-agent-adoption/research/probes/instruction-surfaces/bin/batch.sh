#!/usr/bin/env bash
# Throwaway: run subject sessions in order. Each line of the plan file:
#   <label> <cond> <claude|codex> [noplugin|-] [prompt file, default task.txt]
# fixture, session with prompts/task.txt, ground truth, daemon stopped.
B="$(cd "$(dirname "$0")" && pwd)"
while read -r L C H NP PF; do
  [ "$NP" = - ] && NP=""; PF="$B/../prompts/${PF:-task.txt}"
  [ -z "$L" ] || [ "${L:0:1}" = "#" ] && continue
  [ -f /tmp/r52/logs/$L.t1 ] && { echo "skip $L"; continue; }
  echo "== $L $C $H $NP $(date +%T)"
  bash "$B/mkfix.sh" "$L" "$C" "$H" $NP
  if [ "$H" = codex ]; then bash "$B/run-codex.sh" "$L" "$PF" "$NP"
  else bash "$B/run-claude.sh" "$L" "$PF" "$NP"; fi
  bash "$B/finish.sh" "$L"
done < "$1"
echo "batch done $(date +%T)"
