#!/bin/sh
# From the agent user, in a checkout of this repository: the release archives install.sh reads
# through SQUEAL_SOURCE, named as the tag archives, into dogfood-008/src.
#   squeal--v0.1.184.tar.gz  git archive of main at 4c6d1176 (0.1.184 as landed)
#   squeal--v0.1.190.tar.gz  the same tree with every "0.1.184" in install.sh, package.json and
#                            plugins/ replaced by "0.1.190": a later release with no code change,
#                            standing in for one (the only later candidate, cand/0.1.185, does not
#                            contain 0.1.184's OpenCode changes)
# and each release's install.sh beside them, as install-<version>.sh.
set -eu
REV=4c6d1176
cd "$(git rev-parse --show-toplevel)"
D=/home/squeal-e2e/dogfood-008/src
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
git archive --prefix=squeal-squeal--v0.1.184/ "$REV" | gzip -n >"$T/squeal--v0.1.184.tar.gz"
mkdir "$T/x"
tar -xzf "$T/squeal--v0.1.184.tar.gz" -C "$T/x"
mv "$T/x/squeal-squeal--v0.1.184" "$T/x/squeal-squeal--v0.1.190"
( cd "$T/x/squeal-squeal--v0.1.190" && grep -rl '0\.1\.184' install.sh package.json plugins | xargs sed -i 's/0\.1\.184/0.1.190/g' )
tar -C "$T/x" -czf "$T/squeal--v0.1.190.tar.gz" squeal-squeal--v0.1.190
cp "$T/x/squeal-squeal--v0.1.190/install.sh" "$T/install-0.1.190.sh"
git show "$REV:install.sh" >"$T/install-0.1.184.sh"
chmod 644 "$T"/*.gz "$T"/*.sh
tar -C "$T" -cf - squeal--v0.1.184.tar.gz squeal--v0.1.190.tar.gz install-0.1.184.sh install-0.1.190.sh |
  sudo -n -u squeal-e2e tar -C "$D" -xf -
sudo -n -u squeal-e2e ls -l "$D"
