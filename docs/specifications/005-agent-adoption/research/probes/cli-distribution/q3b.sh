#!/usr/bin/env bash
# Throwaway probe (005-05, question 3, orchestrator). A linked worktree of q3.sh's warm fixture F:
# does its first daemon re-run the suite, or take the main worktree's results by key?
# Usage: q3b.sh <q3 scratch> <pin>
set -u
S=$(cd "$1" && pwd); PIN=$(cd "$2" && pwd); HERE=$(cd "$(dirname "$0")" && pwd)
unset $(env | grep -oE '^(CLAUDE|CEZ_|SQUEAL)[A-Z_]*' ) 2>/dev/null
export XDG_RUNTIME_DIR=$S/run
cli(){ node --disable-warning=ExperimentalWarning "$PIN/v72/plugins/claude-code/dist/cli/squeal.mjs" "$@"; }
ms(){ echo $(( $(date +%s%N)/1000000 )); }
F=$S/F; L=$S/F-wt; git -C "$F" worktree add -q "$L" -b wt; cp -r "$F/node_modules" "$L/node_modules"
node "$HERE/q.mjs" "$F" "before (store is shared)"
cd "$L"; T=$(ms); cli start | head -1; cli status --wait 60000 | grep -E "^(Revision|Known|Inherited)"; echo "  start + status --wait: $(( $(ms)-T )) ms, load $(cut -d' ' -f1 /proc/loadavg)"
sleep 2; cli status | grep -E "^(Affected|Inherited)"; node "$HERE/q.mjs" "$F" "after (runs count covers every worktree)"
cli stop | head -1; cd "$S"; git -C "$F" worktree remove --force "$L"
