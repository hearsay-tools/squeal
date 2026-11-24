#!/bin/sh
# Throwaway (026 agent37-sandboxes). On a fresh fork: git status, dsync, the 3 git test files,
# 10 capacity files twice. Run detached; output in /tmp/rx-fork-check.sh.log.
export PATH=$HOME/.local/bin:$PATH NO_COLOR=1
cd ~/squeal && echo "git status lines: $(git status --porcelain | wc -l); head $(git rev-parse --short HEAD)"
sh /tmp/dsync.sh "$1"
sh /tmp/run-tests.sh "$1" git
sh /tmp/run-tests.sh "$1-1" capacity
sh /tmp/run-tests.sh "$1-2" capacity
echo FORK-CHECK-DONE
