#!/bin/sh
# Throwaway. Shows whether a Squeal daemon re-runs runner-shutdown-parity.test.ts when only
# the spawned mock changes. Clone trimmed as in daemon-probe.sh, mock at 5974ec91, no
# squeal.config.json. usage: daemon-probe-stays-current.sh <squeal.mjs> <clone> <store-query.mjs>
SQ=$1; C=$2; QY=$3
cd "$C" || exit 2
S=.git/squeal/store.sqlite
known() { node "$QY" "$S" "select c.full_name, k.outcome, k.validity, k.pending_phase from known_states k join checks c on c.id=k.check_id where c.full_name like '%cursor S2%'" | sed 's/runner shutdown parity (hearsay-tools\/cezarion#843) > //' | cut -c1-140; }
runs() { node "$QY" "$S" "select count(*) n, max(revision) rev from runs where ended_at is not null"; }
node "$SQ" start | head -1
until node "$SQ" status 2>/dev/null | grep -q '^Known failures: 3'; do sleep 2; done
echo "--- A. bootstrap at 5974ec91 done"; runs; known
git checkout 6b660859 -- packages/cezar/scripts/mock-cursor-print.mjs
echo "--- B. mock replaced at $(date -u +%T); waiting 60 s"
sleep 60
node "$QY" "$S" "select number, changes from revisions order by number desc limit 1" | cut -c1-200
runs; known
node "$SQ" status 2>&1 | grep -E '^(Revision|Known failures|Affected)'
npx vitest run --project server packages/cezar/src/core/runner-shutdown-parity.test.ts -t 'cursor S2[678]' 2>&1 | grep -E '^ +Tests '
echo "--- C. same tree, plain npx vitest run above; Squeal still says:"
node "$SQ" status 2>&1 | grep -E '^(Known failures|  )' | head -8
node "$SQ" stop | head -1
