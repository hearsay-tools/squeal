#!/usr/bin/env bash
# Throwaway (018-01). The CI cache case: a second job on the same runner
# path restores the store an earlier job saved (as actions/cache would),
# then asks for a checkpoint. Same absolute path, same user, same env, so
# this does not measure key portability across machines (topic
# result-import owns that). Run after ci-like.sh <base> <cli> run.
# Also tries `run --all --wait <ms>` with a deadline too short to finish.
set -uo pipefail
base=$1 cli=$2
cache=/tmp/squeal-e2e-cache/vitest-5.0.3-vite-8.3.2-node24-linux-x64
clone=$base/clone-run home=$base/home tmp=$base/tmp
saved=$base/saved-store
rm -rf "$saved"
cp -a "$clone/.git/squeal" "$saved"            # "actions/cache save"
rm -rf "$clone"                                 # the runner is gone
git -c advice.detachedHead=false clone -q --depth 1 "file://$base/origin.git" "$clone"
git -C "$clone" -c advice.detachedHead=false checkout -q --detach
cp -a "$cache/node_modules" "$clone/node_modules"
cp -a "$saved" "$clone/.git/squeal"             # "actions/cache restore"

sq() {
  local start end code
  start=$(date +%s%N)
  ( cd "$clone" && env -i PATH="$PATH" HOME="$home" TMPDIR="$tmp" CI=true \
      GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null \
      timeout 300 node "$cli" "$@" )
  code=$?
  end=$(date +%s%N)
  echo "=== exit $code after $(( (end - start) / 1000000 )) ms: squeal $*"
}
echo "##### start (restored store)"; sq start
echo "##### status --wait 30000 (baseline)"; sq status --wait 30000
echo "##### run --all --wait (restored store)"; sq run --all --wait
echo "##### run --all --force --wait 300 (deadline too short)"; sq run --all --force --wait 300
echo "##### status --wait 30000"; sq status --wait 30000
echo "##### stop"; sq stop
echo "##### daemons for this clone still running:"; pgrep -af "$clone" || echo none
