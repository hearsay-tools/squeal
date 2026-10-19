#!/bin/bash
# usage: build-twice.sh <cezar-checkout> <sha>: extracts <sha> into a fresh /tmp dir (git archive,
# so the checkout and its .git are only read), symlinks its node_modules, runs `tsc` in
# packages/cezar twice and compares dist bytes and mtimes. HOME stays inside the tmp dir.
set -e
C=$1; T=$(mktemp -d /tmp/issue33dist.XXXX); mkdir -p "$T/home" "$T/repo"
git -C "$C" archive "$2" | tar -x -C "$T/repo"
ln -s "$C/node_modules" "$T/repo/node_modules"
ln -s "$C/packages/cezar/node_modules" "$T/repo/packages/cezar/node_modules"
cd "$T/repo/packages/cezar"; export HOME=$T/home XDG_CONFIG_HOME=$T/home/.config XDG_CACHE_HOME=$T/home/.cache
snap() { find dist -type f -printf '%P %T@ %s %i\n' | sort > "$1.stat"; (cd dist && find . -type f -print0 | sort -z | xargs -0 sha256sum) > "$1.sha"; }
../../node_modules/.bin/tsc --version
../../node_modules/.bin/tsc; snap "$T/b1"; sleep 2; ../../node_modules/.bin/tsc; snap "$T/b2"
echo "files: $(wc -l < "$T/b1.stat")"
cmp -s "$T/b1.sha" "$T/b2.sha" && echo "bytes: identical" || echo "bytes: differ"
join <(awk '{print $1,$2,$4}' "$T/b1.stat") <(awk '{print $1,$2,$4}' "$T/b2.stat") |
  awk '$2==$4{s++} $2!=$4{m++} $3!=$5{i++} END{print "mtime same",s+0,"moved",m+0,"inode changed",i+0}'
echo "tmp: $T"
