#!/usr/bin/env bash
# Throwaway probe for research 013-05. Makes /tmp/vcl-d-XXXXXX for the fixture daemon:
#   home/ run/ config/ cache/ tmp/   the isolated environment
#   fixture/   fixture/ as a git repository, node_modules copied from /tmp/vcl-matrix/<combo>
#   squeal/    a copy of the installed Squeal bundle   log/ ctl/ snap/
# Policy: the slow lane holds test/slow.test.ts (one worker); 4 host slots.
# Usage: fixture-setup.sh <combo> [bundle-version]
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
COMBO=$1 VERSION=${2:-0.1.238}
S=$(mktemp -d /tmp/vcl-d-XXXXXX)
mkdir -p "$S"/{home,run,config/squeal,cache,tmp,log,ctl,snap}
chmod 700 "$S/run"
cp -r "$HERE/fixture" "$S/fixture"
cp "/tmp/vcl-matrix/$COMBO/package.json" "$S/fixture/"
cp -r "/tmp/vcl-matrix/$COMBO/node_modules" "$S/fixture/"
cp "/tmp/vcl-matrix/$COMBO/package-lock.json" "$S/fixture/"
printf 'node_modules\n' >"$S/fixture/.gitignore"
cat >"$S/fixture/squeal.config.json" <<'JSON'
{
  "slow": { "include": ["test/slow.test.ts"], "maxWorkers": 1, "maxParallel": 1 },
  "daemon": { "idleExitMinutes": 240 }
}
JSON
echo '{ "capacity": { "hostSlots": 4 } }' >"$S/config/squeal/config.json"
cp -r "/home/agent/.claude/plugins/cache/hearsay/squeal/$VERSION" "$S/squeal"
git -C "$S/fixture" init --quiet
git -C "$S/fixture" add -A
git -C "$S/fixture" -c user.name=probe -c user.email=probe@localhost commit --quiet -m "probe fixture"
echo "$S"
