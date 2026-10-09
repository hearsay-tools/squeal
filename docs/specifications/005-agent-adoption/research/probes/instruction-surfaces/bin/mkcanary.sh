#!/usr/bin/env bash
# Throwaway: a canary fixture: CLAUDE.md and AGENTS.md each carry a unique word.
#   mkcanary.sh <label> <claude|codex>
set -e; source "$(dirname "$0")/env.sh"
"$PROBES/bin/mkfix.sh" "$1" canary-claude claude
cd $R/runs/$1
[ -f AGENTS.md ] || { cat "$PROBES/fixture/BASE.md"; echo; cat "$PROBES/conditions/canary-agents.md"; } > AGENTS.md
git add -A; git commit -qm canary
