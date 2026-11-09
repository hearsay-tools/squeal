#!/usr/bin/env bash
# Throwaway (018-14). Layout "chain": one ref refs/squeal/results; each CI write is a
# commit whose parent is the previous tip, with the export at one fixed path and the
# main commit in the message. A reader that holds the previous tip gets a thin pack
# (deltas against the export it already has). Measures the same numbers as retention.sh.
# Usage: chain.sh <work dir under $TMPDIR> <dir of NN.json[.gz]> <json|json.gz>
set -euo pipefail
. "$(dirname "$0")/common.sh"
W=$1; S=$2; ext=$3; rm -rf "$W"; mkdir -p "$W"; cd "$W"
kib() { git -C "$1" count-objects -v | awk '/size-pack/{p=$2} /^size:/{l=$2} END{print p+l}'; }
git init -q --bare -b main origin.git; git clone -q origin.git ci 2>/dev/null
n=0; tip=""
for f in "$S"/*.$ext; do
  (cd ci && echo $n > f.txt && git add f.txt && git commit -qm "landing $n"); c=$(git -C ci rev-parse HEAD)
  b=$(git -C ci hash-object -w "$f"); t=$(printf '100644 blob %s\texport.%s\n' "$b" "$ext" | git -C ci mktree)
  k=$(git -C ci commit-tree "$t" ${tip:+-p $tip} -m "squeal results for $c"); git -C ci push -q origin main "$k:refs/squeal/results"
  tip=$k; n=$((n+1))
done
git -C origin.git gc -q; echo "origin $(kib origin.git) KiB after $n commits"
git init -q new; git -C new config fetch.unpackLimit 1; git -C new fetch -q ../origin.git +refs/squeal/results:refs/squeal/results
echo "new reader, whole chain: $(kib new) KiB"
git init -q inc; git -C inc config fetch.unpackLimit 1
git -C inc fetch -q ../origin.git "$(git -C origin.git rev-parse refs/squeal/results~1):refs/squeal/results"; a=$(kib inc)
git -C inc fetch -q ../origin.git +refs/squeal/results:refs/squeal/results; echo "+1 commit, reader holds the previous tip: $(( $(kib inc)-a )) KiB"
