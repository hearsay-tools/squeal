#!/bin/sh
# 008-30, from the agent user in a checkout of this repository: one release archive install.sh
# reads through SQUEAL_SOURCE, a `git archive` of <rev> named as its tag archive, with that
# release's install.sh beside it, into dogfood-008/src. The version is the one <rev>'s install.sh
# names. Usage: sh make-archive.sh <rev>   (008-30 used origin/main at b4067d55, 0.1.186)
set -eu
REV=$1
cd "$(git rev-parse --show-toplevel)"
V=$(git show "$REV:install.sh" | sed -n 's/^SQUEAL_VERSION=//p')
D=/home/squeal-e2e/dogfood-008/src
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
git archive --prefix="squeal-squeal--v$V/" "$REV" | gzip -n >"$T/squeal--v$V.tar.gz"
git show "$REV:install.sh" >"$T/install-$V.sh"
chmod 644 "$T"/*
tar -C "$T" -cf - "squeal--v$V.tar.gz" "install-$V.sh" | sudo -n -u squeal-e2e tar -C "$D" -xf -
echo "$V from $(git rev-parse --short "$REV")"
sudo -n -u squeal-e2e ls -l "$D"
