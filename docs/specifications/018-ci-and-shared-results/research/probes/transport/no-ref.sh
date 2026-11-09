#!/usr/bin/env bash
# Throwaway (018-14). Fetched results refs in the developer's view: does `git log --all`
# list refs/squeal/* and refs/notes/squeal commits? Can a reader fetch one export
# without creating any local ref (ls-remote for the id, fetch with no destination),
# read it, and leave no ref behind?
# Usage: no-ref.sh <work dir under $TMPDIR>  (run reader.sh on the same dir first)
set -euo pipefail
. "$(dirname "$0")/common.sh"
cd "$1"; c3=$(git -C ci rev-parse HEAD)
echo "git log --all in dev: $(git -C dev log --all --oneline | wc -l) commits, of them results commits: $(git -C dev log --all --format=%s | grep -c -E '^results|Notes added' || true)"
rm -rf dev3; git clone -q origin.git dev3
id=$(git -C dev3 ls-remote origin "refs/squeal/$c3" | cut -f1)
git -C dev3 fetch -q --no-write-fetch-head --no-auto-maintenance origin "refs/squeal/$c3"
echo "fetched $id with no destination; read: $(git -C dev3 cat-file blob "$id:export.json")"
echo "refs after: $(git -C dev3 for-each-ref | grep -c squeal || true) squeal refs; git log --all: $(git -C dev3 log --all --oneline | wc -l) commits"
