#!/usr/bin/env bash
# Throwaway probe for research/ci-evidence.md, Q2. Run from the scratch clone
# (/tmp/ce/repo) with HOME, XDG_* and TMPDIR under /tmp/ce. Five rounds; each
# round runs plain Vitest, `squeal ci record` around it, `ci record` with the
# probe hook adding Squeal's provider without mapping (`nomap`), and with
# mapping in the Vitest process (`map`), in a rotating order. Logs the
# one-minute load before each run. Same 30 test files as 015-126's timing.
set -u
P=${P:?probe dir}
W=${W:?worktree}
FILES=$(cat "$P/sample.txt")
OUT=${OUT:-/tmp/ce/timing.tsv}
SQ=plugins/claude-code/dist/cli/squeal.mjs
PROVIDER=$W/src/core/code/coverage/provider.mjs
printf 'round\tmode\tload1\twall_s\tuser_s\tsys_s\texit\tin_hook_map_ms\n' > "$OUT"
run() {
  local round=$1 mode=$2; shift 2
  local load; load=$(cut -d' ' -f1 /proc/loadavg)
  local t; t=$(mktemp)
  rm -rf /tmp/ce/tout; mkdir -p /tmp/ce/tout
  /usr/bin/time -o "$t" -f '%e\t%U\t%S\t%x' "$@" > /tmp/ce/last-$mode.log 2>&1
  local map; map=$(grep -ho '"kind":"end"[^}]*' /tmp/ce/tout/*.jsonl 2>/dev/null | sed 's/.*"mapMs":\([0-9.]*\).*/\1/')
  printf '%s\t%s\t%s\t%s\t%s\n' "$round" "$mode" "$load" "$(tail -1 "$t")" "${map:--}" >> "$OUT"
  rm -f "$t"
}
probe() { printf '{"provider":"%s","out":"/tmp/ce/tout","mode":"%s","mapper":"/tmp/ce/mapper.cjs"}' "$PROVIDER" "$1"; }
plain() { run "$1" plain node_modules/.bin/vitest run $FILES --maxWorkers=4; }
record() { rm -rf /tmp/ce/tparts; run "$1" record node "$SQ" ci record --out /tmp/ce/tparts -- node_modules/.bin/vitest run $FILES --maxWorkers=4; }
nomap() { rm -rf /tmp/ce/tparts; PROBE_CI=$(probe nomap) NODE_OPTIONS="--require $P/probe-hook.cjs" run "$1" nomap node "$SQ" ci record --out /tmp/ce/tparts -- node_modules/.bin/vitest run $FILES --maxWorkers=4; }
map() { rm -rf /tmp/ce/tparts; PROBE_CI=$(probe provider) NODE_OPTIONS="--require $P/probe-hook.cjs" run "$1" map node "$SQ" ci record --out /tmp/ce/tparts -- node_modules/.bin/vitest run $FILES --maxWorkers=4; }
for round in 1 2 3 4 5; do
  case $((round % 4)) in
    1) plain $round; record $round; nomap $round; map $round ;;
    2) record $round; nomap $round; map $round; plain $round ;;
    3) nomap $round; map $round; plain $round; record $round ;;
    0) map $round; plain $round; record $round; nomap $round ;;
  esac
done
cat "$OUT"
