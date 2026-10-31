#!/usr/bin/env bash
# Throwaway probe (018-03). Carries result sets on a git notes ref between two
# fresh clones of a fixture repository, through a local bare "origin".
# Shows: a default clone/fetch does not bring the ref; an explicit refspec
# does; the size of the ref's history after N sets (one note per commit).
# Usage: git-ref.sh <work-dir under $TMPDIR> <dir of NN.json sets>
set -euo pipefail
W=$1; SETS=$2
rm -rf "$W"; mkdir -p "$W"; cd "$W"
export GIT_AUTHOR_NAME=probe GIT_AUTHOR_EMAIL=probe@example.invalid GIT_COMMITTER_NAME=probe GIT_COMMITTER_EMAIL=probe@example.invalid
git init -q --bare -b main origin.git
git clone -q origin.git ci 2>/dev/null
cd ci
n=0
for f in "$SETS"/*.json; do
  echo "change $n" > file.txt; git add file.txt; git commit -qm "landing $n"
  git notes --ref=squeal add -F "$f" HEAD   # CI writes the results of this commit
  n=$((n+1))
done
git push -q origin main refs/notes/squeal
cd ..
raw=$(cat "$SETS"/*.json | wc -c)
git clone -q origin.git dev
cd dev
echo "default clone has notes ref: $(git show-ref | grep -c notes || true)"
echo "remote advertises: $(git ls-remote origin | grep -c notes)"
start=$(date +%s%N)
git fetch -q origin refs/notes/squeal:refs/notes/squeal
end=$(date +%s%N)
echo "explicit fetch of all $n notes: $(( (end-start)/1000000 )) ms"
echo "note of HEAD bytes: $(git notes --ref=squeal show HEAD | wc -c)"
echo "raw bytes of $n sets: $raw"
git count-objects -vH | grep -E 'size-pack|count'
cd ../origin.git && git gc -q --aggressive 2>/dev/null; echo "origin after gc:"; git count-objects -vH | grep size-pack
# A dev fetch after one more landing: only the new note travels.
cd ../ci && echo "change $n" > file.txt && git commit -qam "landing $n" && git notes --ref=squeal add -F "$(ls "$SETS"/*.json | head -1)" HEAD && git push -q origin main refs/notes/squeal
cd ../dev && start=$(date +%s%N) && git fetch origin refs/notes/squeal:refs/notes/squeal 2>&1 | tail -1; end=$(date +%s%N)
echo "incremental fetch: $(( (end-start)/1000000 )) ms"
