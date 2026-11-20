#!/bin/bash
# edit.sh <label> <path>: append one comment line to <path> in the clone (a
# new content hash, no behaviour change) and record the edit time in
# $OUT/<label>.edits.tsv. The daemon's watcher sees it like an agent's edit.
. "$(dirname "$0")/env.sh"
label=$1; path=$2
echo "// probe 011-416 $label $(date +%s%N)" >> "$path"
printf "%s\t%s\n" "$(date +%s%3N)" "$path" >> "$OUT/$label.edits.tsv"
