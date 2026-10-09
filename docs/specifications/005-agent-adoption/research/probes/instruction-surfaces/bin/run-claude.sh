#!/usr/bin/env bash
# Throwaway: one `claude -p` subject session in /tmp/r52/runs/<label>.
#   run-claude.sh <label> <prompt-file> [noplugin] [extra claude args...]
# 001 lessons Setup: pinned version, CLAUDE*/CEZ_* dropped, project settings
# only, the plugin from the pinned copy, acceptEdits plus 001's allow-list.
source "$(dirname "$0")/env.sh"
L=$1; PR=$(readlink -f "$2"); NP=${3:-}; shift 3 2>/dev/null || shift $#
D=$R/runs/$L; O=$R/logs/$L; mkdir -p $R/logs
PLUG=(--plugin-dir $PIN/plugins/claude-code); [ "$NP" = noplugin ] && PLUG=()
cd "$D"; T0=$(date +%s%3N); echo $T0 > $O.t0
claude -p "$(cat "$PR")" --model claude-sonnet-5-5 --output-format stream-json --verbose \
  --include-hook-events --setting-sources project --strict-mcp-config "${PLUG[@]}" \
  --permission-mode acceptEdits --allowedTools 'Bash(git:*)' 'Bash(grep:*)' 'Bash(ls:*)' \
  'Bash(cat:*)' 'Bash(npx vitest:*)' 'Bash(npm test:*)' 'Bash(npm run:*)' 'Bash(squeal:*)' \
  'Bash(sleep:*)' Read Edit Write Glob Grep "$@" \
  < /dev/null 2> $O.stderr.txt | node "$PROBES/bin/ts.mjs" $T0 > $O.events.jsonl
date +%s%3N > $O.t1
