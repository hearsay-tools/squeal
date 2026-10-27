#!/bin/sh
# One-shot inbox monitor. Exit 0 with new IDs; exit 3 when the owner is gone.
# Usage: watch-inbox.sh <messages-dir> <session-id> <seen-file> [owner-pid]
set -eu
[ "$#" -ge 3 ] && [ "$#" -le 4 ] || { echo 'expected messages-dir session-id seen-file [owner-pid]' >&2; exit 2; }
dir=$1 me=$2 seen=$3 owner=${4:-}
[ -d "$dir" ] && [ -r "$seen" ] || { echo 'messages directory and readable seen file required' >&2; exit 2; }
case "$owner" in *[!0-9]*|0) echo 'owner PID must be positive' >&2; exit 2 ;; esac
while :; do
  [ -n "$owner" ] && ! kill -0 "$owner" 2>/dev/null && { echo "owner $owner gone"; exit 3; }
  new=""
  for f in "$dir"/*.md; do
    [ -e "$f" ] || continue
    id=$(basename "$f" .md)
    grep -Fqx -- "$id" "$seen" && continue
    to=$(sed -n 's/^to: *//p;/^$/q' "$f")
    from=$(sed -n 's/^from: *//p;/^$/q' "$f")
    [ "$from" = "$me" ] && continue
    case "$to" in "$me"|all) new="$new $id" ;; esac
  done
  [ -n "$new" ] && { echo "inbox:$new"; exit 0; }
  sleep 5
done
