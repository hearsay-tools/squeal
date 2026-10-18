#!/bin/sh
# Throwaway probe for issue #35: a docs-only edit in a fresh checkout whose slow
# package tier needs a gitignored dist/ that was never built, then the
# completion advice's `run --slow --wait 60000`. The fixture is issue #3's
# (../issue-3-preconditions/fixture) plus overlay/: an AGENTS.md, one unit test
# whose declared input is AGENTS.md, and cezarion's stop keys at 463a5bf0
# (requireSlowSuite false, baseline lookup-only). Nothing is built, ever.
#
#   SQUEAL_CLI=/abs/path/to/dist/cli/squeal.mjs sh run.sh
#
# Everything lives in one scratch directory with HOME and XDG_* inside it.
# Each step is bounded by `timeout 150`. Leaves $SCRATCH for inspection.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
: "${SQUEAL_CLI:?set SQUEAL_CLI to a plugin's dist/cli/squeal.mjs}"
SCRATCH=$(mktemp -d /tmp/issue35-XXXXXX)
repo=$SCRATCH/repo
out=$SCRATCH/out
mkdir -p "$SCRATCH/home" "$SCRATCH/run" "$SCRATCH/state" "$SCRATCH/data" "$SCRATCH/cache" "$out"
chmod 700 "$SCRATCH/run"
cp -R "$here/../issue-3-preconditions/fixture" "$repo"
mv "$repo/_gitignore" "$repo/.gitignore"
cp -R "$here/overlay/." "$repo/"

sq() {
  env -i PATH="$PATH" HOME="$SCRATCH/home" XDG_RUNTIME_DIR="$SCRATCH/run" \
    XDG_STATE_HOME="$SCRATCH/state" XDG_DATA_HOME="$SCRATCH/data" XDG_CACHE_HOME="$SCRATCH/cache" \
    GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 \
    timeout 150 node --disable-warning=ExperimentalWarning "$SQUEAL_CLI" "$@"
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
echo "== squeal $(sq --version), node $(node --version), load $(cut -d' ' -f1 /proc/loadavg) on $(nproc) CPUs"
echo "== fresh checkout: dist/ exists? $(test -e dist && echo yes || echo no)"
echo

step 01-start start
step 02-status-wait status --wait 60000
echo "Read the README and the probe notes." >>AGENTS.md
echo "== edited AGENTS.md only: $(git status --short | tr '\n' ' ')"
step 03-status-wait status --wait 60000
step 04-run-slow run --slow --wait 60000
# The first wait returns on the first transition; wait again for the rest.
step 05-run-slow-again run --slow --wait 60000
step 06-failures failures
step 07-stop stop
echo "== dist/ exists after the run? $(test -e dist && echo yes || echo no)"
echo "== outputs in $out"
echo "== cleanup: rm -rf $SCRATCH"
