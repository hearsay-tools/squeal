#!/bin/sh
# Throwaway probe for 005-18 part 2. Not product code.
# Polls `squeal status --json` in one cezar copy as squeal-e2e every 30 s and prints one line per
# poll: UTC time, load, revision, check counts, test files without checks, known failures, the slow
# tier, the checkpoint and the daemon state (status-line.py). Ends when nothing is pending, stale or
# unknown, when no daemon is alive, or at the bound (default 90 min).
#   sh poll-status.sh <copy: asis|fresh|skill> [bound minutes]
set -u
here=$(cd "$(dirname "$0")" && pwd)
R=/home/squeal-e2e/runs/sq18-cz
copy=$1
bound=$((${2:-90} * 60))
t0=$(date +%s)
while :; do
  node "$here/as-e2e.mjs" "$R" "$R/$copy" squeal status --json 2>/dev/null | python3 -I "$here/status-line.py" > /tmp/sq18-poll.$$ 2>&1
  printf '%s load %s %s\n' "$(date -u +%H:%M:%SZ)" "$(cut -d' ' -f1 /proc/loadavg)" "$(cat /tmp/sq18-poll.$$)"
  if ! grep -q "daemon alive" /tmp/sq18-poll.$$; then echo "no daemon alive"; break; fi
  if grep -q "pending 0 stale 0 unknown 0 | files without checks pending 0 unknown 0" /tmp/sq18-poll.$$; then echo "every test file current"; break; fi
  [ $(($(date +%s) - t0)) -ge "$bound" ] && { echo "bound reached"; break; }
  sleep 30
done
rm -f /tmp/sq18-poll.$$
