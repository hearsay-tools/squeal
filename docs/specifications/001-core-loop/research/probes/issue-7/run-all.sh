#!/bin/sh
# Throwaway probe for issue 7: every controlled attempt in research/issue-7.md.
# Usage: run-all.sh <scratch-dir made by setup.sh> <squeal.mjs>
set -u
S=$1; CLI=$2; HERE=$(cd "$(dirname "$0")" && pwd)
echo "squeal $(node "$CLI" --version), node $(node --version), sqlite $(node -p process.versions.sqlite), $(uptime | sed 's/.*load/load/')"
(cd "$S/repo" && HOME="$S/home" node "$CLI" stop > /dev/null 2>&1)
for a in "immediate 300" "immediate 600" "immediate 3000" "exclusive 3000" "read 3000" \
         "exclusive-locking 600" "exclusive-locking 3000"; do
  echo "=== $a, partial name"; sh "$HERE/attempt.sh" "$S" "$CLI" $a
done
echo "=== immediate 3000, exact name"
sh "$HERE/attempt.sh" "$S" "$CLI" immediate 3000 '[test] test/fork.test.mjs > parseApplyCheck counts distinct fork-deleted'
echo "=== immediate 3000, unmatched name"
sh "$HERE/attempt.sh" "$S" "$CLI" immediate 3000 'no such check'
DB="$S/repo/.git/squeal/store.sqlite"
echo "=== open path replayed under immediate 3000"
node "$HERE/hold.mjs" "$DB" immediate 3000 & sleep 0.3; node "$HERE/trace-open.mjs" "$DB"; wait
echo "=== no-row UPDATE under immediate 5000"
node "$HERE/hold.mjs" "$DB" immediate 5000 & sleep 0.3; node "$HERE/upgrade.mjs" "$DB"; wait
echo "=== status and failures under immediate 3000"
node "$HERE/hold.mjs" "$DB" immediate 3000 & sleep 0.3
(cd "$S/repo"; export HOME="$S/home"; node "$CLI" status > /tmp/issue7-st.$$; echo "status exit $? $(head -1 /tmp/issue7-st.$$)"; node "$CLI" failures; echo "failures exit $?"; rm -f /tmp/issue7-st.$$); wait
