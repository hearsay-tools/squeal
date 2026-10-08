#!/usr/bin/env bash
# Task 001-143 evidence, not product code. Rounds of two.ts on a cezar clone,
# one run per variant per round, the variants rotated each round so none
# always runs first; every cezar command with each CEZ_* variable unset, its cwd
# in the clone, in its own session. Output per run: <label>-<round>-<variant>.{json,log}.
# Usage: [FIRST=<n>] rounds.sh <clone> <out dir> <rounds> <label> <files> <variant ...>
#   FIRST numbers the rounds from n (default 1), to add rounds to a label.
#   <files>: test paths relative to the clone, space-separated in one argument.
set -u
clone=$1; out=$2; rounds=$3; label=$4; files=$5; shift 5; variants=("$@")
here=$(cd "$(dirname "$0")" && pwd)
tsx=$clone/node_modules/.bin/tsx
unset_cez=$(env | grep -o '^CEZ_[A-Z_]*' | sed 's/^/-u /' | tr '\n' ' ')
n=${#variants[@]}
mkdir -p "$out"
first=${FIRST:-1}
for i in $(seq "$first" $((first + rounds - 1))); do
  for k in $(seq 0 $((n - 1))); do
    v=${variants[$(((i + k) % n))]}
    (cd "$clone" && env $unset_cez setsid -w "$tsx" "$here/two.ts" "$clone" "$v" "$out/$label-$i-$v.json" 23 $files) > "$out/$label-$i-$v.log" 2>&1
    if [ -f "$out/$label-$i-$v.json" ]; then echo "$i $(tail -1 "$out/$label-$i-$v.log")"; else echo "$i $v: failed, exit $? at $(date -u +%FT%TZ)"; fi
  done
done
