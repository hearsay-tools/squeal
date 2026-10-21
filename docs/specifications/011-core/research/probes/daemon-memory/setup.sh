#!/usr/bin/env bash
# Throwaway probe for research 011-53. Makes the scratch /tmp/dm-XXXXXX:
#   home/ run/ config/ cache/ tmp/   HOME, XDG_RUNTIME_DIR, XDG_CONFIG_HOME, XDG_CACHE_HOME, TMPDIR
#   cezar/                           a shallow `git clone` of /home/agent/projects/cezar (never a worktree)
#   squeal/                          a copy of the installed Squeal 0.1.236 bundle
#   log/                             what the probes write
# Installs cezar's dependencies offline from the host's pnpm store, copying files (no hardlinks
# into the shared store). Caps the pool at 4 slots, turns the slow lane off, and raises the idle
# exit so the daemon outlives a 30-minute quiet. Prints the scratch path. Never touches the live
# repository beyond reading it.
set -euo pipefail
LIVE=/home/agent/projects/cezar
BUNDLE=/home/agent/.claude/plugins/cache/hearsay/squeal/0.1.236
STORE=/home/agent/.local/share/pnpm/store/v11
S=$(mktemp -d /tmp/dm-XXXXXX)
mkdir -p "$S"/{home,run,config/squeal,cache,tmp,log}
chmod 700 "$S/run"
git clone --quiet --depth 1 "file://$LIVE" "$S/cezar"
cp -r "$BUNDLE" "$S/squeal"
# A lone daemon runs hostSlots workers (pool.ts): 4.
echo '{ "capacity": { "hostSlots": 4 } }' > "$S/config/squeal/config.json"
# Slow lane off: no slow.include, and the browser e2e config's files left out of the listing.
node -e '
const f = process.argv[1], p = JSON.parse(require("fs").readFileSync(f, "utf8"));
delete p.slow;
p.vitest = { exclude: ["packages/web/e2e/**"] };
p.daemon = { idleExitMinutes: 240 };
require("fs").writeFileSync(f, JSON.stringify(p, null, 2) + "\n");
' "$S/cezar/squeal.config.json"
(
  cd "$S/cezar"
  export HOME=$S/home XDG_CACHE_HOME=$S/cache TMPDIR=$S/tmp
  # pnpm's metadata cache is copied in, so --offline resolves without the network and the
  # host's cache is not written; corepack finds the pnpm it already has.
  mkdir -p "$S/cache/pnpm" && cp -r /home/agent/.cache/pnpm/v12 "$S/cache/pnpm/"
  export COREPACK_HOME=/home/agent/.cache/node/corepack
  pnpm install --offline --frozen-lockfile --store-dir "$STORE" --package-import-method copy \
    --reporter silent >"$S/log/pnpm-install.txt" 2>&1
)
# The clone's config edit is a local change; commit it so the worktree starts clean.
git -C "$S/cezar" -c user.name=probe -c user.email=probe@localhost commit --quiet -am "probe: policy for 011-53"
echo "$S"
