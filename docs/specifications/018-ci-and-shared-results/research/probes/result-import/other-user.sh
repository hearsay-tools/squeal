#!/bin/sh
# Throwaway (topic result-import): repeat run-clone.sh as the throwaway user squeal-e2e
# (memory reference-squeal-e2e-user), with copies of this user's Node, pnpm and Squeal,
# and pnpm's own store in that user's HOME (installed from the registry).
set -eu
origin=$1; out=$2
S=/tmp/squeal-ri-probe
rm -rf "$S"; mkdir -p "$S/tools" "$S/out"
cp "$(command -v node)" "$S/tools/node"
cp -r "$HOME/.cache/node/corepack/v1/pnpm/12.15.0" "$S/tools/pnpm"
cp -r "$HOME/.claude/plugins/cache/hearsay/squeal/0.1.387/dist" "$S/tools/squeal-dist"
git -C "${origin#file://}" bundle create -q "$S/origin.bundle" --all
chmod -R a+rX "$S"; chmod a+rwx "$S/out"
sudo -n -u squeal-e2e -H env -i HOME=/home/squeal-e2e PATH="$S/tools:/usr/bin:/bin" S="$S" sh -c '
  set -eu
  W=$HOME/ri-probe/x/fixture
  rm -rf "$HOME/ri-probe"; mkdir -p "$HOME/ri-probe/xdg"
  export XDG_CACHE_HOME=$HOME/ri-probe/xdg/cache XDG_DATA_HOME=$HOME/ri-probe/xdg/data XDG_STATE_HOME=$HOME/ri-probe/xdg/state
  git clone -q "$S/origin.bundle" "$W"; cd "$W"
  node "$S/tools/pnpm/bin/pnpm.mjs" install --frozen-lockfile --silent --store-dir "$HOME/ri-probe/store"
  sq() { node "$S/tools/squeal-dist/cli/squeal.mjs" "$@"; }
  sq start >"$S/out/start.txt" 2>&1 || true
  sq run --all --wait >"$S/out/run.txt" 2>&1 || true
  sq status --full >"$S/out/status.txt" 2>&1 || true
  sq stop >"$S/out/stop.txt" 2>&1 || true
  cp .git/squeal/store.sqlite* "$S/out/"
  chmod a+r "$S/out/"*
'
mkdir -p "$out"; cp "$S/out/"* "$out/"
node "$(dirname "$0")/dump-keys.mjs" "$out/store.sqlite" >"$out.keys.json"
sudo -n -u squeal-e2e rm -rf /home/squeal-e2e/ri-probe "$S/out"
rm -rf "$S"
echo "$out.keys.json"
