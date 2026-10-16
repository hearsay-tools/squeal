#!/usr/bin/env bash
# Throwaway: which cezarion browser specs select a data-slot that packages/web/src/components/diff renders,
# in the spec itself and through its local helper imports. Read only (git show). Usage: tokens.sh <cezarion clone> <rev>
set -euo pipefail
C=$1; R=$2; T=$(mktemp)
git -C "$C" grep -ohE 'data-slot="diff-[a-z-]+"' "$R" -- packages/web/src/components/diff | sed "s/^$R://" | sort -u > "$T"
for f in $(git -C "$C" ls-tree --name-only "$R" packages/web/e2e/ | grep '\.e2e\.ts$'); do
  text=$(git -C "$C" show "$R:$f")
  for h in $(printf '%s\n' "$text" | grep -oE "from '\./[a-z0-9-]+'" | sed -E "s/from '\.\/(.*)'/\1/"); do
    text="$text
$(git -C "$C" show "$R:packages/web/e2e/$h.ts" 2>/dev/null || true)"
  done
  own=$(git -C "$C" show "$R:$f" | grep -oFf "$T" | sort -u | wc -l || true)
  all=$(printf '%s\n' "$text" | grep -oFf "$T" | sort -u | wc -l || true)
  if [ "$all" -gt 0 ]; then echo "$(basename "$f") own=$own with-helpers=$all"; fi
done
rm -f "$T"
