#!/bin/sh
# Throwaway probe for research/issue-107.md, experiment E1. Copies ./fixture to a clone under
# /tmp, runs its one browser-like file in Squeal's slow tier, stops the daemon, and reports
# whether the detached server the project's globalSetup started is still alive.
# Usage: sh run.sh <squeal-worktree>   (uses <squeal-worktree>/plugins/claude-code/dist and
# <squeal-worktree>/node_modules for Vitest). Kills only the server it started; removes the clone.
set -eu
SRC=$(cd "$(dirname "$0")" && pwd)
TREE=$(cd "$1" && pwd)
SQUEAL="node $TREE/plugins/claude-code/dist/cli/squeal.mjs"
BASE=$(mktemp -d /tmp/issue107-XXXXXX)
REPO="$BASE/repo"
unset PLUGIN_ROOT PLUGIN_DATA CLAUDE_PLUGIN_ROOT CLAUDE_PLUGIN_DATA SQUEAL_DAEMON_CHILD SQUEAL_OBSERVE
export HOME="$BASE/home" XDG_CONFIG_HOME="$BASE/xdg/config" XDG_DATA_HOME="$BASE/xdg/data" \
  XDG_STATE_HOME="$BASE/xdg/state" XDG_CACHE_HOME="$BASE/xdg/cache" XDG_RUNTIME_DIR="$BASE/xdg/run" \
  TMPDIR="$BASE/tmp" CODEX_HOME="$BASE/codex" PLUGIN_DATA="$BASE/plugin-data"
mkdir -p "$HOME" "$XDG_CONFIG_HOME" "$XDG_DATA_HOME" "$XDG_STATE_HOME" "$XDG_CACHE_HOME" "$TMPDIR" "$CODEX_HOME" "$PLUGIN_DATA"
chmod 700 "$XDG_RUNTIME_DIR" 2>/dev/null || { mkdir -p "$XDG_RUNTIME_DIR"; chmod 700 "$XDG_RUNTIME_DIR"; }
cp -r "$SRC/fixture" "$REPO"
ln -s "$TREE/node_modules" "$REPO/node_modules"
mkdir -p "$REPO/.ai/qa"
cd "$REPO"
git init -q && git -c user.email=p@p -c user.name=probe add -A && git -c user.email=p@p -c user.name=probe commit -qm fixture
say() { echo "[$(date -u +%TZ) load $(cut -d' ' -f1 /proc/loadavg)] $*"; }

say "start"; nice -n 10 $SQUEAL start "$REPO" >/dev/null 2>&1 || true
say "run --slow --wait 180000"; nice -n 10 $SQUEAL run --slow --wait 180000 2>&1 | tail -3 || true
SERVER=$(sed -n 's/.* server pid=\([0-9]*\)$/\1/p' .ai/qa/events.log | tail -1)
DAEMON=$(sed -n 's/.* setup pid=\([0-9]*\) .*/\1/p' .ai/qa/events.log | tail -1)
say "events:"; cat .ai/qa/events.log
say "setup ran in pid $DAEMON: $(tr '\0' ' ' < /proc/$DAEMON/cmdline 2>/dev/null | cut -c1-120)"
info() { # pid -> alive, ppid, pgid, cwd, Squeal names in env, TMPDIR (our own process)
  if [ -d /proc/$1 ]; then
    set -- "$1" $(sed 's/.*) //' /proc/$1/stat | cut -d' ' -f2,3)
    echo "alive ppid=$2 pgid=$3 cwd=$(readlink /proc/$1/cwd) squealVars=[$(tr '\0' '\n' < /proc/$1/environ | cut -d= -f1 | grep '^SQUEAL' | tr '\n' ' ')] TMPDIR=$(tr '\0' '\n' < /proc/$1/environ | sed -n 's/^TMPDIR=//p')"
  else echo "gone"; fi
}
say "server $SERVER before stop: $(info $SERVER)"
ID=$(cat "$REPO/.git/squeal/repository-id")
say "daemon scratch for this root: /tmp/squeal-$(id -u)/tmp/$(printf '%s\0%s' "$ID" "$REPO" | sha256sum | cut -c1-16)"
say "squeal stop:"; rc=0; nice -n 10 $SQUEAL stop "$REPO" || rc=$?; echo "exit=$rc"
say "server $SERVER after stop: $(info $SERVER)"
say "squeal stop again:"; rc=0; nice -n 10 $SQUEAL stop "$REPO" || rc=$?; echo "exit=$rc"
say "server $SERVER after second stop: $(info $SERVER)"
say "teardown lines: $(grep -c teardown .ai/qa/events.log || true)"
# Clean up only what this probe started.
[ -n "$SERVER" ] && [ "$(readlink /proc/$SERVER/cwd 2>/dev/null)" = "$REPO" ] && kill "$SERVER" && say "killed own server $SERVER"
cd /; rm -rf "$BASE"; say "removed $BASE"
