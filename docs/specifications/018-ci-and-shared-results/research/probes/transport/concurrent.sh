#!/usr/bin/env bash
# Throwaway (018-14). Two CI writers add a note for different commits at the same
# time, from the same notes-ref tip. Shows: the second push is rejected as
# non-fast-forward; fetch + `git notes merge` + push succeeds. Then the same with
# one ref per commit (refs/squeal/<sha>): no conflict.
# Usage: concurrent.sh <work dir under $TMPDIR>
set -euo pipefail
. "$(dirname "$0")/common.sh"
fresh "$1"; W=$PWD
git clone -q origin.git w1; git clone -q origin.git w2
c2=$(git -C ci rev-parse HEAD~1); c3=$(git -C ci rev-parse HEAD)
head -c 1000 /dev/urandom > a.bin; head -c 1000 /dev/urandom > b.bin
git -C w1 notes --ref=squeal add -F "$W/a.bin" "$c2"
git -C w2 notes --ref=squeal add -F "$W/b.bin" "$c3"
echo "--- notes ref: two pushes started together"
(git -C w1 push origin refs/notes/squeal 2>&1 | sed 's/^/w1: /') & (git -C w2 push origin refs/notes/squeal 2>&1 | sed 's/^/w2: /') & wait
echo "--- the loser fetches, merges and pushes again"
for w in w1 w2; do
  if ! git -C $w push -q origin refs/notes/squeal 2>/dev/null; then
    git -C $w fetch -q origin refs/notes/squeal:refs/notes/squeal-remote
    git -C $w notes --ref=squeal merge -q -s theirs refs/notes/squeal-remote
    git -C $w push origin refs/notes/squeal 2>&1 | sed "s/^/$w retry: /"
  fi
done
echo "notes on origin: $(git -C origin.git notes --ref=squeal list | wc -l) (expect 2)"
echo "--- one ref per commit: two pushes started together"
b1=$(git -C w1 hash-object -w "$W/a.bin"); b2=$(git -C w2 hash-object -w "$W/b.bin")
t1=$(printf '100644 blob %s\texport.json.gz\n' "$b1" | git -C w1 mktree); k1=$(git -C w1 commit-tree "$t1" -m "squeal results for $c2")
t2=$(printf '100644 blob %s\texport.json.gz\n' "$b2" | git -C w2 mktree); k2=$(git -C w2 commit-tree "$t2" -m "squeal results for $c3")
(git -C w1 push origin "$k1:refs/squeal/$c2" 2>&1 | sed 's/^/w1: /') & (git -C w2 push origin "$k2:refs/squeal/$c3" 2>&1 | sed 's/^/w2: /') & wait
echo "per-commit refs on origin: $(git -C origin.git for-each-ref refs/squeal | wc -l) (expect 2)"
echo "--- a ref pointing at a blob directly"
git -C w1 push origin "$b1:refs/squeal-blob/$c2" 2>&1 | tail -1
git -C origin.git cat-file -t refs/squeal-blob/$c2
echo "--- notes ref that already exists: both writers start from the same tip"
git -C w1 fetch -q origin +refs/notes/squeal:refs/notes/squeal; git -C w2 fetch -q origin +refs/notes/squeal:refs/notes/squeal
c1=$(git -C ci rev-parse HEAD~2)
git -C w1 notes --ref=squeal add -f -C "$b1" "$c1"; git -C w2 notes --ref=squeal add -f -C "$(git -C w2 hash-object -w "$W/b.bin")" "$(git -C ci rev-parse HEAD)"
(git -C w1 push origin refs/notes/squeal 2>&1 | sed 's/^/w1: /') & (git -C w2 push origin refs/notes/squeal 2>&1 | sed 's/^/w2: /') & wait
echo "--- pruning a per-commit ref: delete it on the origin"
git -C w1 push -q origin --delete "refs/squeal/$c2" && echo "per-commit refs left: $(git -C origin.git for-each-ref refs/squeal | wc -l)"
