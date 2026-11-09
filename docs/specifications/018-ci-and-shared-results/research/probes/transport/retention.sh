#!/usr/bin/env bash
# Throwaway (018-14). Bytes a results ref costs, per storage layout, over N main commits.
# Layouts: notes-gz (one gzipped export per note), notes-raw (raw JSON per note),
# refs-gz / refs-raw (one parentless commit per main commit at refs/squeal/<sha>).
# Measures: origin pack after gc; what a new reader receives; what a reader that
# has commit N-2 receives for commit N-1; the notes ref after pruning to the last K.
# Received bytes = the kept pack (fetch.unpackLimit=1 keeps every received pack).
# Usage: retention.sh <work dir under $TMPDIR> <dir of NN.json and NN.json.gz> [K=5]
set -euo pipefail
. "$(dirname "$0")/common.sh"
W=$1; S=$2; K=${3:-5}; rm -rf "$W"; mkdir -p "$W"
kib() { git -C "$1" count-objects -v | awk '/size-pack/{p=$2} /^size:/{l=$2} END{print p+l}'; }
for layout in notes-gz notes-raw refs-gz refs-raw; do
  ext=json; [[ $layout == *gz ]] && ext=json.gz
  cd "$W"; rm -rf $layout; mkdir $layout; cd $layout
  git init -q --bare -b main origin.git; git clone -q origin.git ci 2>/dev/null
  n=0; last=""; prev=""
  for f in "$S"/*.$ext; do
    (cd ci && echo $n > f.txt && git add f.txt && git commit -qm "landing $n")
    c=$(git -C ci rev-parse HEAD)
    if [[ $layout == notes-* ]]; then
      git -C ci notes --ref=squeal add -F "$f" "$c"; git -C ci push -q origin main refs/notes/squeal
    else
      b=$(git -C ci hash-object -w "$f"); t=$(printf '100644 blob %s\texport.%s\n' "$b" "$ext" | git -C ci mktree)
      k=$(git -C ci commit-tree "$t" -m "squeal results for $c"); git -C ci push -q origin main "$k:refs/squeal/$c"
    fi
    prev=$last; last=$c; n=$((n+1))
  done
  git -C origin.git gc -q; origin=$(kib origin.git)
  git init -q new; git -C new config fetch.unpackLimit 1
  if [[ $layout == notes-* ]]; then
    git -C new fetch -q ../origin.git +refs/notes/squeal:refs/notes/squeal; new=$(kib new)
    # a reader that had the notes ref as of commit N-2 receives one more note
    git init -q inc; git -C inc config fetch.unpackLimit 1
    git -C inc fetch -q ../origin.git "$(git -C origin.git rev-parse refs/notes/squeal~1):refs/notes/squeal" 2>/dev/null || \
      git -C inc fetch -q ../origin.git +refs/notes/squeal:refs/notes/squeal   # fallback: see README
    a=$(kib inc); git -C inc fetch -q ../origin.git +refs/notes/squeal:refs/notes/squeal; inc=$(( $(kib inc)-a ))
    # prune: a parentless notes commit holding the last K notes, force-pushed
    tree=$(git -C ci ls-tree refs/notes/squeal | sort -k4 | tail -n "$K")   # flat tree for few notes
    keep=""; for c in $(git -C ci log --format=%H -n "$K" main); do keep="$keep$(git -C ci ls-tree refs/notes/squeal "$c")"$'\n'; done
    pt=$(printf '%s' "$keep" | git -C ci mktree); pc=$(git -C ci commit-tree "$pt" -m "squeal: keep last $K")
    git -C ci push -q -f origin "$pc:refs/notes/squeal"; git -C origin.git reflog expire --expire=now --all; git -C origin.git gc -q --prune=now
    git init -q pr; git -C pr config fetch.unpackLimit 1; git -C pr fetch -q ../origin.git +refs/notes/squeal:refs/notes/squeal
    echo "$layout: origin $origin KiB after $n commits; new reader $new KiB (all $n); +1 commit $inc KiB; after prune to $K: origin $(kib origin.git) KiB, new reader $(kib pr) KiB"
  else
    git -C new fetch -q ../origin.git "refs/squeal/$last:refs/squeal/$last"; new=$(kib new)
    git init -q inc; git -C inc config fetch.unpackLimit 1
    git -C inc fetch -q ../origin.git "refs/squeal/$prev:refs/squeal/$prev"; a=$(kib inc)
    git -C inc fetch -q ../origin.git "refs/squeal/$last:refs/squeal/$last"; inc=$(( $(kib inc)-a ))
    echo "$layout: origin $origin KiB after $n commits; new reader $new KiB (latest only); +1 commit $inc KiB (reader holds the previous ref)"
  fi
done
