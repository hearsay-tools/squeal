#!/usr/bin/env bash
# Throwaway probe for research 021-27. Makes a scratch under $SCRATCH_ROOT (the task's $TMPDIR):
#   home/ run/ config/ cache/ tmp/   HOME, XDG_RUNTIME_DIR, XDG_CONFIG_HOME, XDG_CACHE_HOME, TMPDIR
#   <repo>/                          a shallow `git clone` of the named repository (never a worktree)
#   bundle/                          a copy of this worktree's committed Claude Code bundle (main 5cc5624e2, 0.1.459)
#   log/                             what the probes write
# Usage: setup.sh <repo name: cezar|squeal> <source path>. Installs offline from the host's
# pnpm store, copying files (no hardlinks into the shared store). Prints the scratch path.
set -euo pipefail
NAME=$1 LIVE=$2
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
WT=$(cd "$HERE/../../../../../.." && pwd)
STORE=/home/agent/.local/share/pnpm/store/v11
S=$(mktemp -d "${SCRATCH_ROOT:?}/dh-$NAME-XXXXXX")
mkdir -p "$S"/{home,run,config/squeal,cache,tmp,log}
chmod 700 "$S/run"
git clone --quiet --depth 1 "file://$LIVE" "$S/$NAME"
cp -r "$WT/plugins/claude-code" "$S/bundle"
# A lone daemon runs hostSlots workers (pool.ts): 4, as 011-53 did.
echo '{ "capacity": { "hostSlots": 4 } }' > "$S/config/squeal/config.json"
# The slow lane off and the idle exit raised, so the daemon outlives the quiet periods.
node -e '
const f = process.argv[1], fs = require("fs");
const p = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : {};
delete p.slow;
p.daemon = { ...(p.daemon ?? {}), idleExitMinutes: 240 };
fs.writeFileSync(f, JSON.stringify(p, null, 2) + "\n");
' "$S/$NAME/squeal.config.json"
(
  cd "$S/$NAME"
  export HOME=$S/home XDG_CACHE_HOME=$S/cache TMPDIR=$S/tmp
  mkdir -p "$S/cache/pnpm" && cp -r /home/agent/.cache/pnpm/v12 "$S/cache/pnpm/" 2>/dev/null || true
  export COREPACK_HOME=/home/agent/.cache/node/corepack
  # pnpm 12 checks release ages from full metadata the host cache lacks; age 0 skips that.
  pnpm install --offline --frozen-lockfile --store-dir "$STORE" --package-import-method copy --config.minimum-release-age=0 \
    --reporter silent >"$S/log/pnpm-install.txt" 2>&1
)
git -C "$S/$NAME" -c user.name=probe -c user.email=probe@localhost commit --quiet -am "probe: policy for 021-27"
echo "$S"
