#!/bin/sh
# Throwaway (026 boat-sandboxes). Times a 10-file uncommitted delta sent to a sandbox:
#   delta.sh <local repo> <ssh args json> <label>
# (a) tar.gz of the 10 changed files piped over one kept ssh connection and unpacked;
# (b) the same delta as a unified diff piped to `git apply` there.
# The local repo is only read; the changed copies live in a temp directory.
set -eu
REPO=$1; SSHA=$(printf '%s' "$2" | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).join(" ")'); L=$3
T=$(mktemp -d)
FILES=$(cd "$REPO" && ls test/capacity/*.test.ts | head -10)
for f in $FILES; do mkdir -p "$T/new/$(dirname "$f")"; cp "$REPO/$f" "$T/new/$f"; printf '\n// sq026 delta %s\n' "$L" >> "$T/new/$f"; done
(cd "$T/new" && tar czf "$T/delta.tgz" $FILES)
for f in $FILES; do (cd "$REPO" && git diff --no-index --no-prefix "$f" "$T/new/$f" || true); done \
  | sed "s|$T/new/||g" > "$T/delta.diff"
echo "$L sizes: tgz $(wc -c < "$T/delta.tgz") B, diff $(wc -c < "$T/delta.diff") B"
ssh $SSHA true
for i in 1 2 3; do
  s=$(date +%s%N); ssh $SSHA 'cd ~/squeal && tar xzf -' < "$T/delta.tgz"; e=$(date +%s%N)
  ssh $SSHA 'cd ~/squeal && git checkout -q -- test/capacity'
  s2=$(date +%s%N); ssh $SSHA 'cd ~/squeal && git apply -p0 --whitespace=nowarn' < "$T/delta.diff"; e2=$(date +%s%N)
  ssh $SSHA 'cd ~/squeal && git checkout -q -- test/capacity'
  echo "$L try $i: tar $(( (e - s) / 1000000 )) ms, git apply $(( (e2 - s2) / 1000000 )) ms"
done
rm -rf "$T"
