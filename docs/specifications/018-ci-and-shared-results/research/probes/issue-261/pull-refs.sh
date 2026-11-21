#!/usr/bin/env bash
# Throwaway probe (row 018-69): do `git fetch` and `git pull` bring refs/squeal/<sha>
# with a clone's default refspec? A scratch bare remote, one clone, no network.
set -eu
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
export GIT_CONFIG_GLOBAL=$T/gitconfig GIT_CONFIG_NOSYSTEM=1
git config --global user.email p@example.invalid; git config --global user.name p; git config --global init.defaultBranch main
git init -q "$T/src"; git -C "$T/src" commit -q --allow-empty -m one
git clone -q --bare "$T/src" "$T/remote.git"
git clone -q "file://$T/remote.git" "$T/clone"
# CI's publish: a parentless commit under refs/squeal/<sha>, and main moves on
C1=$(git -C "$T/remote.git" rev-parse main)
blob=$(echo results | git -C "$T/remote.git" hash-object -w --stdin)
tree=$(printf '100644 blob %s\tsqueal-results.json.gz\n' "$blob" | git -C "$T/remote.git" mktree)
r=$(git -C "$T/remote.git" commit-tree "$tree" -m "Squeal results for $C1")
git -C "$T/remote.git" update-ref "refs/squeal/$C1" "$r"
git -C "$T/src" commit -q --allow-empty -m two; git -C "$T/src" push -q "$T/remote.git" main
echo "git version: $(git --version)"
echo "refspec: $(git -C "$T/clone" config --get-all remote.origin.fetch)"
git -C "$T/clone" fetch -q; echo "after fetch: $(git -C "$T/clone" for-each-ref refs/squeal | wc -l) refs/squeal, origin/main moved: $(git -C "$T/clone" rev-parse --short origin/main)"
git -C "$T/clone" pull -q --ff-only; echo "after pull: $(git -C "$T/clone" for-each-ref refs/squeal | wc -l) refs/squeal"
git -C "$T/clone" fetch -q --all --prune; echo "after fetch --all: $(git -C "$T/clone" for-each-ref refs/squeal | wc -l) refs/squeal"
echo "has the results object locally: $(git -C "$T/clone" cat-file -e "$r" 2>/dev/null && echo yes || echo no)"
echo "ls-remote sees: $(git -C "$T/clone" ls-remote origin 'refs/squeal/*' | wc -l) refs/squeal"
