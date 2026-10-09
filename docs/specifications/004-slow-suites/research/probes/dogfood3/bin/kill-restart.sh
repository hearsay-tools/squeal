#!/usr/bin/env bash
# Defect 12's case: SIGKILL a daemon (one I started) while its slow tier runs, start a new
# one, and print the slow-tier line and its JSON activity every second for <seconds>.
# Usage: bin/kill-restart.sh <worktree> <daemon pid> <seconds>
set -u
wt=$1 pid=$2 secs=$3
cli="$wt/plugins/claude-code/dist/cli/squeal.mjs"
sq() { node --disable-warning=ExperimentalWarning "$cli" "$@"; }
line() {
  echo "$(date -u +%T.%N | cut -c1-12) $(cd "$wt" && sq status | grep '^Slow tier' | sed 's/ Not covered.*//')"
  echo "    activity $(cd "$wt" && sq status --json | node -pe 'JSON.stringify(JSON.parse(require("fs").readFileSync(0)).slowTier?.activity)')"
}
line
echo "$(date -u +%T.%N | cut -c1-12) kill -9 $pid"
kill -9 "$pid"
sleep 2
line
echo "$(date -u +%T.%N | cut -c1-12) squeal start: $(sq start "$wt" | head -1)"
for _ in $(seq "$secs"); do line; sleep 1; done
