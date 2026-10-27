#!/bin/sh
# Throwaway probe. Exit 0 printing new message IDs for this session; exit 3 when the owner is gone.
# Usage: watch-inbox.sh <messages-dir> <session-id> <seen-file> [owner-pid]
dir=$1 me=$2 seen=$3 owner=${4:-}
touch "$seen"
while :; do
  [ -n "$owner" ] && ! kill -0 "$owner" 2>/dev/null && { echo "owner $owner gone"; exit 3; }
  new=""
  for f in "$dir"/*.md; do
    [ -e "$f" ] || continue
    id=$(basename "$f" .md)
    grep -qx "$id" "$seen" && continue
    to=$(sed -n 's/^to: *//p;/^$/q' "$f")
    from=$(sed -n 's/^from: *//p;/^$/q' "$f")
    [ "$from" = "$me" ] && continue
    case "$to" in "$me"|all) new="$new $id" ;; esac
  done
  [ -n "$new" ] && { echo "inbox:$new"; exit 0; }
  sleep 5
done
