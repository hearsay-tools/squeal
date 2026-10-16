#!/bin/sh
# Throwaway issue #16 probe. Reuses the issue #3 fixture, not its full checkpoint.
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
: "${SQUEAL_CLI:?set the absolute installed Squeal CLI path}"
node -e 'const o=require("node:os"); const load=o.loadavg()[0], cpus=o.availableParallelism(); console.log(JSON.stringify({at:new Date().toISOString(),load1:load,cpus,eligible:load<=cpus})); if(load>cpus) process.exit(3)'
scratch=$(mktemp -d /tmp/issue16-XXXXXX)
repo=$scratch/repo
mkdir -p "$scratch/home" "$scratch/run" "$scratch/state" "$scratch/data" "$scratch/cache"
chmod 700 "$scratch/run"
cp -R "$here/../issue-3-preconditions/fixture" "$repo"
mv "$repo/_gitignore" "$repo/.gitignore"
sq() {
  env -i PATH="$PATH" HOME="$scratch/home" XDG_RUNTIME_DIR="$scratch/run" \
    XDG_STATE_HOME="$scratch/state" XDG_DATA_HOME="$scratch/data" XDG_CACHE_HOME="$scratch/cache" \
    GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 \
    node --disable-warning=ExperimentalWarning "$SQUEAL_CLI" "$@"
}
step() {
  printf '\n$ squeal'; printf ' %s' "$@"; printf '\n'
  set +e
  timeout 70s env -i PATH="$PATH" HOME="$scratch/home" XDG_RUNTIME_DIR="$scratch/run" \
    XDG_STATE_HOME="$scratch/state" XDG_DATA_HOME="$scratch/data" XDG_CACHE_HOME="$scratch/cache" \
    GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 \
    node --disable-warning=ExperimentalWarning "$SQUEAL_CLI" "$@"
  code=$?
  set -e
  printf '[exit %s]\n' "$code"
}
cleanup() {
  cd "$repo"
  step stop
  # Stop's return alone is not proof the process has exited (board 001-436).
  sleep 1
  if ps -eo pid=,args= | awk -v root="$repo" 'index($0,"squeal daemon " root) {found=1; print} END {exit !found}'; then
    printf 'CLEANUP INCOMPLETE: daemon still present; retained %s\n' "$scratch"
  else
    printf 'Cleanup: no process named squeal daemon %s remains\n' "$repo"
    rm -rf "$scratch"
    printf 'Cleanup: removed %s\n' "$scratch"
  fi
}
cd "$repo"
trap cleanup EXIT
trap 'exit 130' INT TERM
git -c init.defaultBranch=main init -q
git add -A
git -c user.name=probe -c user.email=probe@example.invalid commit -qm fixture
printf 'Scratch: %s\nMode: %s\n' "$scratch" "${MODE:-missing}"
printf 'Squeal: '; sq --version
node --version
git --version
if [ "${MODE:-missing}" = built-first ]; then
  printf '$ node scripts/build.mjs (throwaway fixture only)\n'
  node scripts/build.mjs
fi
printf 'dist exists: '; if test -d dist; then echo yes; else echo no; fi
step start
step status
step run --slow --wait 60000
# run --slow can return early on news; this read waits for all three named files.
step status --wait 60000 test/e2e/bin.test.mjs test/e2e/cli.test.mjs test/e2e/import.test.mjs
step why 'the CLI greets the named user'
