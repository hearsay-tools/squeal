#!/bin/sh
# Throwaway probe (row 025-14). Per release step, the first-parent commits on
# main that changed a committed hook bundle most, by its size in bytes.
# Usage: sh commits.sh <hook> <ref>...   (run from the repository root)
hook=$1; shift
f=plugins/claude-code/dist/$hook.mjs
prev=
for ref in "$@"; do
  if [ -n "$prev" ]; then
    echo "## $hook $prev..$ref"
    git log --first-parent --format='%h %s' "$prev..$ref" -- "$f" | while read -r h s; do
      a=$(git cat-file -s "$h^:$f" 2>/dev/null || echo 0)
      b=$(git cat-file -s "$h:$f")
      echo "$((b - a)) $h $s"
    done | sort -rn | head -8 | cut -c1-140
  fi
  prev=$ref
done
