#!/bin/sh
# Throwaway. What OpenCode wrote into the probe's OPENCODE_CONFIG_DIR and the worktree's .opencode.
. "$(dirname "$0")/env.sh"
cd $W/probe/cfgdir && find . -maxdepth 2 -not -path './node_modules/*' | sort; cat .gitignore package.json 2>/dev/null
cd $W/wt && git status --short
