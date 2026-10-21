#!/usr/bin/env bash
# Throwaway probe for research 013-05. Makes /tmp/vcl-c-XXXXXX for the cezar daemon, as 011-53's
# setup.sh did: a shallow `git clone` of cezar (never a worktree), installed offline from the
# host's pnpm store with copied files, a copy of the installed Squeal bundle, 4 host slots,
# the browser e2e files out of the listing, and one light server test in the slow lane
# (<slow-file>), so a slow pass makes and drains a slow instance with cezar's full config.
# Usage: cezar-setup.sh <slow-file> [bundle-version]
set -euo pipefail
LIVE=/home/agent/projects/cezar
SLOW=$1 VERSION=${2:-0.1.238}
STORE=/home/agent/.local/share/pnpm/store/v11
S=$(mktemp -d /tmp/vcl-c-XXXXXX)
mkdir -p "$S"/{home,run,config/squeal,cache,tmp,log,ctl,snap}
chmod 700 "$S/run"
git clone --quiet --depth 1 "file://$LIVE" "$S/cezar"
cp -r "/home/agent/.claude/plugins/cache/hearsay/squeal/$VERSION" "$S/squeal"
echo '{ "capacity": { "hostSlots": 4 } }' >"$S/config/squeal/config.json"
node -e '
const f = process.argv[1], p = JSON.parse(require("fs").readFileSync(f, "utf8"));
p.slow = { include: [process.argv[2]], maxWorkers: 1, maxParallel: 1 };
p.vitest = { exclude: ["packages/web/e2e/**"] };
p.daemon = { idleExitMinutes: 240 };
require("fs").writeFileSync(f, JSON.stringify(p, null, 2) + "\n");
' "$S/cezar/squeal.config.json" "$SLOW"
(
  cd "$S/cezar"
  export HOME=$S/home XDG_CACHE_HOME=$S/cache TMPDIR=$S/tmp
  mkdir -p "$S/cache/pnpm" && cp -r /home/agent/.cache/pnpm/v12 "$S/cache/pnpm/"
  export COREPACK_HOME=/home/agent/.cache/node/corepack
  pnpm install --offline --frozen-lockfile --store-dir "$STORE" --package-import-method copy \
    --reporter silent >"$S/log/pnpm-install.txt" 2>&1
)
git -C "$S/cezar" -c user.name=probe -c user.email=probe@localhost commit --quiet -am "probe: policy for 013-05"
echo "$S"
