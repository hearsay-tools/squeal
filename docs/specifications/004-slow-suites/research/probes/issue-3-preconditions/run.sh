#!/bin/sh
# Throwaway probe for issue #3: a slow node:test tier run by the shipped Squeal
# CLI without, then with, the build output it tests. Everything lives under one
# scratch directory: a fresh git repository (its own store in .git/squeal), and
# HOME, XDG_RUNTIME_DIR, XDG_STATE_HOME, XDG_DATA_HOME, XDG_CACHE_HOME pointed
# inside it, so no socket, slot lock or store of the host is touched.
#
#   SQUEAL_CLI=/abs/path/to/dist/cli/squeal.mjs sh run.sh            # missing, then built
#   SQUEAL_CLI=... MODE=built-first sh run.sh                         # control: built before start
#
# Leaves $SCRATCH for inspection; `sh run.sh` prints the cleanup command.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
: "${SQUEAL_CLI:?set SQUEAL_CLI to the shipped plugin's dist/cli/squeal.mjs}"
SCRATCH=$(mktemp -d /tmp/issue3-XXXXXX)
repo=$SCRATCH/repo
out=$SCRATCH/out
mkdir -p "$SCRATCH/home" "$SCRATCH/run" "$SCRATCH/state" "$SCRATCH/data" "$SCRATCH/cache" "$out"
chmod 700 "$SCRATCH/run"
cp -R "$here/fixture" "$repo"
mv "$repo/_gitignore" "$repo/.gitignore"

# A clean environment: only what node, git and the daemon need.
sq() {
  env -i PATH="$PATH" HOME="$SCRATCH/home" XDG_RUNTIME_DIR="$SCRATCH/run" \
    XDG_STATE_HOME="$SCRATCH/state" XDG_DATA_HOME="$SCRATCH/data" XDG_CACHE_HOME="$SCRATCH/cache" \
    GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 \
    node --disable-warning=ExperimentalWarning "$SQUEAL_CLI" "$@"
}
step() {
  name=$1; shift
  echo "\$ squeal $*" >"$out/$name.txt"
  set +e; (cd "$repo" && sq "$@") >>"$out/$name.txt" 2>&1; code=$?; set -e
  echo "[exit $code]" >>"$out/$name.txt"
  cat "$out/$name.txt"; echo
}

cd "$repo"
git -c init.defaultBranch=main init -q
git add -A
git -c user.name=probe -c user.email=probe@example.invalid commit -qm fixture
echo "== fresh checkout: dist/ exists? $(test -e dist && echo yes || echo no)"
echo "== squeal $(sq --version), node $(node --version), $(git --version)"
echo

if [ "${MODE:-missing}" = built-first ]; then
  # Control: the build output exists before the daemon starts, as after CI's build.
  node scripts/build.mjs
  echo "== built before start: $(ls dist | tr '\n' ' ')"
  step 01-start start
  step 02-run-all run --all --wait
  step 03-why why "the CLI greets the named user"
  step 09-stop stop
  echo "== outputs in $out"
  echo "== cleanup: rm -rf $SCRATCH"
  exit 0
fi

# Path 1: the build output is missing, as in a fresh worktree.
step 01-start start
step 02-run-all run --all --wait
step 03-status status
step 04-failures failures
step 05-why why "the CLI greets the named user"

# Path 2: build in place, then ask for the slow lane again.
(cd "$repo" && node scripts/build.mjs)
echo "== after build: $(ls dist | tr '\n' ' ')"
step 06-run-slow run --slow --wait 120000
step 07-status status
step 08-run-all run --all --wait
step 08-why why "the CLI greets the named user"

step 09-stop stop
echo "== outputs in $out"
echo "== cleanup: rm -rf $SCRATCH"
