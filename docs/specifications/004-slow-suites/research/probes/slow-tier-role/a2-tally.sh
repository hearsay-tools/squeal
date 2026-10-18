#!/bin/sh
# Throwaway, read-only: tallies the a2-slow eval cells under /tmp/squeal-evals-<uid>/cells.
# For each cell: harness/model, final revision, whether the slow file was current at that
# revision in status-end.txt, and whether the agent ran `run --slow` or a build.
root=${1:-/tmp/squeal-evals-$(id -u)/cells}
for c in "$root"/*/*/a2-slow*; do
  s="$c/out/status-end.txt"; e="$c/out/events.jsonl"
  [ -f "$s" ] || continue
  rev=$(sed -n 's/^Revision: \([0-9]*\).*/\1/p' "$s" | head -1)
  slow=$(grep '^Slow tier:' "$s" | head -1)
  cur=no
  echo "$slow" | grep -q "1 current .* as of revision $rev\b" && cur=yes
  rs=$(grep -c 'run --slow' "$e" 2>/dev/null)
  bld=$(grep -cE 'npm run build|vite build|tsc -p' "$e" 2>/dev/null)
  echo "$(basename "$c" | sed 's/a2-slow.p0.//; s/.e-medium.*//') rev=$rev slowCurrent=$cur runSlowMentions=$rs buildCmds=$bld"
done
# Second pass, appended: did the agent itself run `run --slow`? Claude cells log tool_use
# commands as "command":"..."; Codex cells log item.started command_execution items.
for c in "$root"/*/*/a2-slow*; do
  e="$c/out/events.jsonl"; [ -f "$c/out/status-end.txt" ] || continue
  n=$( { grep -oE '"name":"Bash","input":\{"command":"[^"]*' "$e"; grep '"item.started"' "$e" | grep -o '"command":"[^}]*'; } | grep -c 'run --slow')
  echo "asked $(basename "$c" | sed 's/a2-slow.p0.//; s/.e-medium.*//') runSlowCommands=$n"
done
