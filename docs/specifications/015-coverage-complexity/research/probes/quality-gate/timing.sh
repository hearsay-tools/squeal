#!/usr/bin/env bash
# Throwaway probe for research/quality-gate.md, Q1. Run from the scratch copy
# (/tmp/qg/repo) with HOME, XDG_* and TMPDIR under /tmp/qg. Five rounds; each
# round runs plain Vitest, `squeal ci record` around it, and the one-shot probe,
# in a rotating order, and logs the one-minute load before each run.
set -u
P=${P:?probe dir}
FILES=$(cat "$P/sample.txt")
OUT=${OUT:-/tmp/qg/timing.tsv}
SQ=plugins/claude-code/dist/cli/squeal.mjs
printf 'round\tmode\tload1\twall_s\tuser_s\tsys_s\texit\n' > "$OUT"
run() {
  local round=$1 mode=$2; shift 2
  local load; load=$(cut -d' ' -f1 /proc/loadavg)
  local t; t=$(mktemp)
  /usr/bin/time -o "$t" -f '%e\t%U\t%S\t%x' "$@" > /tmp/qg/last-$mode.log 2>&1
  printf '%s\t%s\t%s\t%s\n' "$round" "$mode" "$load" "$(tail -1 "$t")" >> "$OUT"
  rm -f "$t"
}
plain() { run "$1" plain node_modules/.bin/vitest run $FILES --maxWorkers=4; }
record() { rm -rf /tmp/qg/parts; run "$1" record node "$SQ" ci record --out /tmp/qg/parts -- node_modules/.bin/vitest run $FILES --maxWorkers=4; }
oneshot() { run "$1" oneshot node_modules/.bin/tsx /tmp/qg/one-shot.mts "$PWD" "/tmp/qg/oneshot-$1.json" $FILES; }
for round in 1 2 3 4 5; do
  case $((round % 3)) in
    1) plain $round; record $round; oneshot $round ;;
    2) record $round; oneshot $round; plain $round ;;
    0) oneshot $round; plain $round; record $round ;;
  esac
done
cat "$OUT"
