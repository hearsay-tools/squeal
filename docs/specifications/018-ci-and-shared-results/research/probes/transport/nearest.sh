#!/usr/bin/env bash
# Throwaway (018-14). Which export a worktree at commit X imports: the nearest
# first-parent ancestor of merge-base(X, main) that has an export. In a treeless
# clone of cezarion, makes a stand-in ref refs/squeal/<sha> for every main commit
# that has a successful merge_group CI run at that exact SHA (mg-runs.json from
# `gh run list --workflow ci.yml --event merge_group --json headSha,conclusion`),
# then times the lookup for a sample of commits. Refuses timing above load = CPUs.
# Usage: nearest.sh <treeless bare clone> <mg-runs.json>
set -euo pipefail
. "$(dirname "$0")/common.sh"
C=$1; RUNS=$2
load=$(cut -d' ' -f1 /proc/loadavg); awk -v l="$load" -v c="$(nproc)" 'BEGIN{exit !(l>c)}' && { echo "load $load: no timing"; exit 2; }
empty=$(git -C "$C" hash-object -t tree -w --stdin </dev/null)
node -e 'for (const r of require(process.argv[1])) if (r.conclusion==="success") console.log(r.headSha)' "$RUNS" | sort -u > /tmp/ok.$$
git -C "$C" log --first-parent --format=%H main | sort > /tmp/main.$$
comm -12 /tmp/ok.$$ /tmp/main.$$ | while read s; do echo "create refs/squeal/$s $(git -C "$C" commit-tree "$empty" -m "$s")"; done | git -C "$C" update-ref --stdin
echo "stand-in exports: $(git -C "$C" for-each-ref refs/squeal | wc -l)"
nearest() {  # $1 = commit; prints the nearest main ancestor with an export
  local mb; mb=$(git -C "$C" merge-base "$1" main)
  git -C "$C" for-each-ref --format='%(refname:lstrip=2)' refs/squeal > /tmp/have.$$
  local hit; hit=$(git -C "$C" rev-list --first-parent -n 200 "$mb" | grep -x -F -f /tmp/have.$$ | head -1 || true)
  echo "${hit:-none}"
}
for back in 0 1 5 20 43; do
  x=$(git -C "$C" rev-parse "main~$back"); t=$(ms); n=$(nearest "$x"); echo "main~$back: nearest export $( [ "$n" = "$x" ] && echo "at X itself" || echo "$n" ) in $(( $(ms)-t )) ms"
done
rm -f /tmp/ok.$$ /tmp/main.$$ /tmp/have.$$
