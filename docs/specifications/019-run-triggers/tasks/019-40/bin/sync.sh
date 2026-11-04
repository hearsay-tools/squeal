#!/bin/sh
# Throwaway probe for 019-40, as squeal-e2e in the cezarion clone right after s1c-2, with its
# daemon still running and its unit baseline queued (019-17's as-e2e.mjs). No model.
#   sh sync.sh <seconds>
# Is s1c-2's 14.3 s from the commit to its report the pass's own time, or a pass that started
# late? Commits a comment in packages/contract/src/effort.ts, then at once asks the daemon for a
# pass as a boundary does (`squeal status --wait 2000`: a sync request, then its answer), and
# prints the stored commit reports and the lint keying each time they change (reports.mjs), with
# times from the commit, for <seconds>.
set -eu
secs=${1:-40}
here=/tmp/dogfood-019-40/bin
stop=$(mktemp -u "$TMPDIR/sync-stop.XXXXXX")
node "$here/reports.mjs" "$PWD" "$stop" > "$TMPDIR/sync-reports.jsonl" &
sleep 1
printf '\n// probe 019-40: sync after a commit\n' >> packages/contract/src/effort.ts
git add packages/contract/src/effort.ts && git commit -q -m "probe 019-40: sync"
t0=$(date +%s%3N)
echo "t0 $t0 commit $(git rev-parse --short=7 HEAD)"
squeal status --wait 2000 > "$TMPDIR/sync-status.txt" 2>&1 || true
echo "status --wait returned after $(( $(date +%s%3N) - t0 )) ms: $(grep -E '^Commit' "$TMPDIR/sync-status.txt" || echo 'no commit line')"
sleep "$secs"
touch "$stop"
wait
cat "$TMPDIR/sync-reports.jsonl"
