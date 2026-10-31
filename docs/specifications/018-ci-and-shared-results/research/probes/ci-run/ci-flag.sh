#!/usr/bin/env bash
# Throwaway (018-01). Same clone, same path, same store; only the CI
# variable differs from the run that wrote the results (ci-like.sh sets
# CI=true). Shows whether CI's own environment variable re-keys results,
# so that a laptop (CI unset) and a CI job never share a key.
# Run after cache-restore.sh.
set -uo pipefail
base=$1 cli=$2
clone=$base/clone-run home=$base/home tmp=$base/tmp
sq() {
  local code
  ( cd "$clone" && env -i PATH="$PATH" HOME="$home" TMPDIR="$tmp" \
      GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null \
      timeout 300 node "$cli" "$@" )
  code=$?
  echo "=== exit $code: squeal $* (CI unset)"
}
echo "##### start, CI unset"; sq start
echo "##### status --wait 30000, CI unset"; sq status --wait 30000
echo "##### run --all --wait, CI unset"; sq run --all --wait
echo "##### stop"; sq stop
echo "##### daemons for this clone still running:"; pgrep -af "$clone" || echo none
