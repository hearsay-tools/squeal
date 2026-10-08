#!/usr/bin/env bash
# Task 001-143 evidence, not product code. The `--help` child that cezar's
# `artifacts/cli` and `discovery/cli` spawn under a 15 s deadline, timed per
# variant of the recorder copy in `recorder/` (as a Vitest worker's child
# inherits it, through NODE_OPTIONS), the variants rotated each round so none
# always runs first. Variant `off`: no recorder; `on`: the whole copy; any
# other name: the copy with SQUEAL143_OFF=<name> (`+` joins several).
# Prints round, variant, wall s, user+sys CPU s, voluntary and involuntary
# context switches, recorded paths.
# Usage: child.sh <clone> <rounds> <variant ...>
set -u
clone=$1; rounds=$2; shift 2; variants=("$@")
here=$(cd "$(dirname "$0")" && pwd)
recorder=$here/recorder/recorder.cjs
unset_cez=$(env | grep -o '^CEZ_[A-Z_]*' | sed 's/^/-u /' | tr '\n' ' ')
n=${#variants[@]}
for i in $(seq 1 "$rounds"); do
  for k in $(seq 0 $((n - 1))); do
    mode=${variants[$(((i + k) % n))]}
    out=$(mktemp -d)
    case $mode in
      off) extra=() ;;
      on) extra=(NODE_OPTIONS="--require \"$recorder\"" SQUEAL_OBSERVE="{\"out\":\"$out\",\"root\":\"$clone\",\"skip\":[],\"file\":\"$clone/packages/cezar/src/artifacts/cli.test.ts\"}") ;;
      *) extra=(SQUEAL143_OFF="${mode//+/,}" NODE_OPTIONS="--require \"$recorder\"" SQUEAL_OBSERVE="{\"out\":\"$out\",\"root\":\"$clone\",\"skip\":[],\"file\":\"$clone/packages/cezar/src/artifacts/cli.test.ts\"}") ;;
    esac
    t=$( (cd "$clone" && env $unset_cez "${extra[@]}" /usr/bin/time -f "%e %U %S %w %c" node --import tsx packages/cezar/src/index.ts artifact --help >/dev/null) 2>&1 | tail -1)
    paths=$(cat "$out"/*.ndjson 2>/dev/null | grep -o '"/[^"]*"' | sort -u | wc -l)
    echo "$i $mode $t $paths" | awk '{ printf "%d %s wall %.2f cpu %.2f vcs %d ics %d paths %d\n", $1, $2, $3, $4 + $5, $6, $7, $8 }'
    rm -rf "$out"
  done
done
