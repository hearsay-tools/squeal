#!/bin/sh
# 011-157 probe (throwaway), question 4: what git reports in each layout. Runs only git, in a scratch directory under /tmp.
# Usage: sh layouts.sh /tmp/md157/layouts
set -e
D=$1; rm -rf "$D"; mkdir -p "$D"; cd "$D"
export HOME=$D/home GIT_CONFIG_NOSYSTEM=1; mkdir -p "$HOME"; git config --global user.email p@x; git config --global user.name p; git config --global init.defaultBranch main; git config --global protocol.file.allow always
git init -q repo; (cd repo && echo a > a && git add a && git commit -qm a && git worktree add -q ../repo-wt -b wt && mkdir -p .ai/w && git worktree add -q .ai/w/nested -b nested)
git clone -q --bare repo bare.git; (cd bare.git && git worktree add -q ../bare-wt1 main && git worktree add -q ../bare-wt2 -b b2)
git clone -q repo clone2
git init -q super; (cd super && git submodule -q add ../repo sub 2>/dev/null && git commit -qm s && cd sub && git worktree add -q ../../sub-wt -b sw)
show() { printf '%s\n' "== $1"; (cd "$1" && printf 'dotgit: %s\n' "$( [ -d .git ] && echo dir || ([ -f .git ] && echo "file: $(cat .git)" || echo none))"; printf 'toplevel: %s\ngit-dir: %s\ncommon-dir: %s\nis-bare: %s\nsuperproject: %s\n' "$(git rev-parse --show-toplevel 2>&1)" "$(git rev-parse --absolute-git-dir)" "$(cd "$(git rev-parse --git-common-dir)" && pwd -P)" "$(git rev-parse --is-bare-repository)" "$(git rev-parse --show-superproject-working-tree)"; printf 'worktree list:\n'; git worktree list --porcelain | grep -E '^(worktree|bare)' | sed 's/^/  /'); }
for d in repo repo-wt repo/.ai/w/nested bare-wt1 bare-wt2 clone2 super super/sub sub-wt; do show "$d"; done
printf '== bare.git itself\nis-bare: %s\n' "$(git -C bare.git rev-parse --is-bare-repository)"
