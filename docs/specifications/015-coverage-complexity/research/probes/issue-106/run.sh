#!/usr/bin/env bash
# Throwaway: runs the built CLI in one fixture with an isolated HOME. Args: squeal worktree, fixture name, CLI args...
set -uo pipefail
WT=$1; shift; C=$1; shift
cd /tmp/issue-106/$C
env HOME=/tmp/issue-106/home XDG_RUNTIME_DIR=/tmp/issue-106/home/run XDG_CONFIG_HOME=/tmp/issue-106/home/.config \
  node "$WT/plugins/claude-code/dist/cli/squeal.mjs" "$@"
