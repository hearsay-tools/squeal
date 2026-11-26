#!/usr/bin/env bash
# Throwaway probe for research 025-22, after repro.sh made /home/user/proj-<v>.
# Usage: repro-run.sh <plugin dir> <project: float|pin> <coverage: on|off>
# Fresh copy of the project, squeal start, squeal run --all --wait, squeal status,
# the daemon log lines about Vitest or coverage, squeal stop.
set -uo pipefail
H=/home/user
PL=$1; V=$2; COV=$3
d=$H/run-$(basename "$PL")-$V-$COV
rm -rf "$d"; cp -a "$H/proj-$V" "$d"; rm -rf "$d/.git"
cd "$d"
if [ "$COV" = off ]; then echo '{ "coverage": { "enabled": false } }' > squeal.config.json; fi
git init -q -b main && git add -A && git -c user.name=b -c user.email=b@example.invalid commit -qm p
home=$d.home; run=$d.run; rm -rf "$home" "$run"; mkdir -p "$home" "$run"; chmod 700 "$run"
export HOME=$home XDG_RUNTIME_DIR=$run
echo "=== $(basename "$PL") vite=$(node -p 'require("./node_modules/.pnpm/node_modules/vite/package.json").version' 2>/dev/null) coverage=$COV"
timeout 120 "$PL/bin/squeal" start >/dev/null 2>&1
timeout 600 "$PL/bin/squeal" run --all --wait 2>&1 | tail -4
timeout 60 "$PL/bin/squeal" status 2>&1 | head -6
echo "--- daemon log:"
grep -h -i "vitest\|coverage\|fail" .git/squeal/logs/daemon-*.log | cut -c1-300 | head -8
timeout 60 "$PL/bin/squeal" stop >/dev/null 2>&1
