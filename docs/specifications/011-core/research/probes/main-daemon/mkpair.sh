#!/bin/sh
# 011-157 probe (throwaway), questions 1 and 4: a main checkout and a linked worktree nested in it, as on the host, both at <commit>.
# /tmp/md157/x/main is a `git clone --no-local` of squeal (a .git directory); /tmp/md157/x/main/.ai/cezar/worktrees/l is `git worktree add` on that clone.
# The main checkout also gets untracked files like the host's: .claude/settings.json and squeal.config.json.local-bak. npm ci in both.
set -e; S=/tmp/md157; commit=$1; d=$S/x/main; mkdir -p $S/x $S/home $S/xdg $S/config $S/cache $S/data $S/state $S/tmp; chmod 700 $S/xdg
git clone -q --no-local --no-checkout /home/agent/projects/squeal/.git $d
git -C $d checkout -q -b main-probe "$commit"
git -C $d worktree add -q -b linked-probe $d/.ai/cezar/worktrees/l "$commit"
mkdir -p $d/.claude; echo '{}' > $d/.claude/settings.json; echo '{}' > $d/squeal.config.json.local-bak
for w in $d $d/.ai/cezar/worktrees/l; do (cd $w && $S/envrun.sh npm ci --no-audit --no-fund --loglevel=error >/dev/null 2>&1); done
git -C $d status --porcelain; git -C $d log -1 --format='%h %s' | cut -c1-80
