#!/usr/bin/env bash
# Throwaway (018-14). Do many per-commit refs (refs/squeal/<sha>) burden a developer's
# ordinary `git fetch`? With protocol v2 the client asks only for its refspecs' prefixes
# (ls-refs ref-prefix), so the origin should not list refs/squeal/*. Counts the refs the
# origin advertises to a plain fetch, with 400 per-commit refs present.
# Usage: refs-scale.sh <work dir under $TMPDIR>
set -euo pipefail
. "$(dirname "$0")/common.sh"
fresh "$1"; e=$(git -C ci hash-object -t tree -w --stdin </dev/null)
for i in $(seq 400); do echo "create refs/squeal/$(printf '%040x' $i) $(git -C ci commit-tree "$e" -m "r$i")"; done | git -C origin.git update-ref --stdin 2>/dev/null || \
  { for i in $(seq 400); do echo "create refs/squeal/$(printf '%040x' $i) $(git -C ci commit-tree "$e" -m "r$i")"; done > list; git -C ci push -q origin $(awk '{print $3":"$2}' list); }
git clone -q origin.git dev
for v in 2 0; do
  n=$(GIT_TRACE_PACKET=1 git -C dev -c protocol.version=$v fetch origin 2>&1 | grep -c 'refs/squeal/' || true)
  echo "protocol v$v: plain fetch saw refs/squeal/* in $n packet lines"
done
echo "ls-remote of the prefix lists $(git -C dev ls-remote origin 'refs/squeal/*' | wc -l) refs"
