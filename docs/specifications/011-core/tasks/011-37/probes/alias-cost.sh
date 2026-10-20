#!/usr/bin/env bash
# Throwaway probe (011-37): alias-cost.mjs in a throwaway worktree under /tmp,
# with HOME and XDG_* there. Refuses to start while the one-minute load is at
# or above the CPU count. No install, no build, no daemon, no suite.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(git -C "$HERE" rev-parse --show-toplevel)
SHA=${SHA:-$(git -C "$REPO" rev-parse origin/main)}
BASE=/tmp/kfg37
load=$(cut -d' ' -f1 /proc/loadavg)
cpus=$(nproc)
if awk -v l="$load" -v c="$cpus" 'BEGIN { exit !(l >= c) }'; then
  echo "load $load >= $cpus CPUs: not starting" >&2
  exit 2
fi
mkdir -p "$BASE/home" "$BASE/scratch"
export HOME=$BASE/home XDG_CONFIG_HOME=$BASE/home/.config XDG_CACHE_HOME=$BASE/home/.cache \
  XDG_DATA_HOME=$BASE/home/.local/share XDG_STATE_HOME=$BASE/home/.local/state \
  XDG_RUNTIME_DIR=$BASE/home/.run
mkdir -p "$XDG_RUNTIME_DIR"
dir=$BASE/wt
[ -d "$dir" ] || git -C "$REPO" worktree add -q --detach "$dir" "$SHA"
echo "## $(git -C "$dir" rev-parse --short HEAD), load $load on $cpus CPUs, node $(node --version)"
cd "$HERE"
nice -n 10 node --no-warnings --experimental-strip-types --import ./register.mjs alias-cost.mjs "$dir" "$BASE/scratch"
