#!/usr/bin/env bash
# Throwaway (018-01). Runs the built Squeal CLI the way a CI job would:
# a fresh depth-1 clone on a detached HEAD, no git identity, no
# XDG_RUNTIME_DIR, a read-only HOME, CI=true, an empty environment
# otherwise (env -i), no harness session, no prior store.
# Usage: ci-like.sh <base dir> <squeal.mjs> <mode>
#   mode run:    run --all --wait before a daemon; start; run --all --wait; status --json; stop
#   mode warmup: warmup; stop
set -uo pipefail
base=$1 cli=$2 mode=$3
cache=/tmp/squeal-e2e-cache/vitest-5.0.3-vite-8.3.2-node24-linux-x64
clone=$base/clone-$mode home=$base/home tmp=$base/tmp
rm -rf "$clone"
mkdir -p "$home" "$tmp"
chmod 555 "$home"
git -c advice.detachedHead=false clone -q --depth 1 "file://$base/origin.git" "$clone"
git -C "$clone" -c advice.detachedHead=false checkout -q --detach
cp -a "$cache/node_modules" "$clone/node_modules"
echo "shallow: $(git -C "$clone" rev-parse --is-shallow-repository) head: $(git -C "$clone" rev-parse --abbrev-ref HEAD)"

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

echo "git identity: '$(cd "$clone" && env -i PATH="$PATH" HOME="$home" GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null git config user.email || true)'"
if [ "$mode" = run ]; then
  echo "##### run --all --wait, no daemon yet"; sq run --all --wait
  echo "##### start"; sq start
  echo "##### run --all --wait"; sq run --all --wait
  echo "##### status --json"; sq status --json >"$base/status-$mode.json"; echo "(saved $(wc -c <"$base/status-$mode.json") bytes)"
  echo "##### status --full"; sq status --full
  echo "##### stop"; sq stop
else
  echo "##### warmup"; sq warmup
  echo "##### stop"; sq stop
fi
echo "##### left in HOME:"; find "$home" -mindepth 1 | head
echo "##### store:"; ls "$clone/.git/squeal" 2>&1 | head
echo "##### daemons for this clone still running:"; pgrep -af "$clone" || echo none
