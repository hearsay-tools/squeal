#!/usr/bin/env bash
# THROWAWAY PROBE. Not product code. See README.md.
# Builds a normal repo (main checkout on an older commit, nested worktree on a newer one) and a bare repo
# with two worktrees, then shows what each git command reports from every location.
set -euo pipefail
T=$(pwd)/tmp/git; rm -rf "$T"; mkdir -p "$T"; cd "$T"
export GIT_AUTHOR_NAME=p GIT_AUTHOR_EMAIL=p@p GIT_COMMITTER_NAME=p GIT_COMMITTER_EMAIL=p@p
git init -q -b main repo; cd repo; echo a > a; git add a; git commit -qm one
git switch -qc feature; echo b > b; git add b; git commit -qm two; git switch -q main
git worktree add -q .ai/worktrees/wt1 feature
mkdir -p src/deep; cd "$T"
git clone -q --bare repo bare.git; git -C bare.git worktree add -q ../bare-main main; git -C bare.git worktree add -q ../bare-feat feature
show() {
  echo "== from $1"
  ( cd "$1"
    echo "rev-parse --git-common-dir (default):  $(git rev-parse --git-common-dir)"
    echo "rev-parse --path-format=absolute --git-common-dir: $(git rev-parse --path-format=absolute --git-common-dir)"
    echo "rev-parse --show-toplevel: $(git rev-parse --show-toplevel 2>&1)"
    echo "rev-parse --is-bare-repository: $(git rev-parse --is-bare-repository)"
    echo "worktree list --porcelain, first entry: $(git worktree list --porcelain | head -3 | tr '\n' ' ')"
    [ -f .git ] && echo ".git file: $(cat .git); commondir file: $(cat "$(sed 's/gitdir: //' .git)/commondir")" || true )
}
show "$T/repo"; show "$T/repo/src/deep"; show "$T/repo/.ai/worktrees/wt1"; show "$T/bare-main"; show "$T/bare.git"
echo "== main checkout HEAD vs nested worktree HEAD: $(git -C "$T/repo" rev-parse --short HEAD) vs $(git -C "$T/repo/.ai/worktrees/wt1" rev-parse --short HEAD)"
echo "== git status in main lists the nested worktree as one opaque entry:"; git -C "$T/repo" status --porcelain --untracked-files=all
echo "== timing: 50x git rev-parse --path-format=absolute --git-common-dir"
cd "$T/repo/.ai/worktrees/wt1"; s=$(date +%s%N); for i in $(seq 50); do git rev-parse --path-format=absolute --git-common-dir >/dev/null; done; echo "avg $(( ($(date +%s%N)-s)/50000 )) us"
