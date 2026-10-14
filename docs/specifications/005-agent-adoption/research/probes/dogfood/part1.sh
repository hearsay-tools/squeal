#!/bin/sh
# Throwaway probe for 005-18 part 1: 006's atomic tier with D8 (variant d8-deny) against p0, as
# squeal-e2e, in the case root /home/squeal-e2e/runs/sq18-p1 (a clone of a `git bundle` of
# f8d3c10a, the coordinator's Q1). The coordinator's cells (2026-10-14):
#   R1 warm, through run-baseline.mjs --atomic --variant d8-deny (p0 and d8-deny side by side):
#     Haiku a2-slow 4 reps, Haiku a1-break 2 reps, Luna a2-slow and a1-break 1 rep: 16 sessions.
#   R2 cold, a2-slow, through run-cell.mjs --cold under one --run id: Haiku 4 reps and Luna 2
#     reps per arm: 12 sessions.
# Every cell starts only while the one-minute load is below 24 (the runner's own gate).
#   sh part1.sh [r1a|r1b|r1c|r2]...   (default: all four, in order)
set -u
here=$(cd "$(dirname "$0")" && pwd)
R=/home/squeal-e2e/runs/sq18-p1
export E2E_PRESERVE=ANTHROPIC_BASE_URL,ANTHROPIC_AUTH_TOKEN,CLIPROXY_API_KEY
as() { node "$here/as-e2e.mjs" "$R" "$R/repo" "$@"; }
stamp() { date -u +%FT%TZ; }
base() { as node evals/bin/run-baseline.mjs --atomic --variant d8-deny --parallel 2 --max-load 24 "$@"; }

r2() {
  run=r2cold-$(date -u +%Y%m%dT%H%M%SZ)
  echo "$(stamp) r2 run $run"
  for spec in "claude claude-haiku-5-5 4" "codex gpt-6-luna 2"; do
    set -- $spec
    rep=1
    while [ "$rep" -le "$3" ]; do
      for arm in p0 d8-deny; do
        while :; do
          echo "$(stamp) r2 cell a2-slow $arm $1 $2 r$rep load $(cut -d' ' -f1 /proc/loadavg)"
          as node evals/bin/run-cell.mjs a2-slow "$arm" "$1" "$2" "$rep" --cold --run "$run" --max-load 24
          code=$?
          [ "$code" = 75 ] && { sleep 30; continue; }
          echo "$(stamp) r2 cell exit $code"
          break
        done
      done
      rep=$((rep + 1))
    done
  done
}

[ $# -eq 0 ] && set -- r1a r1b r1c r2
for step in "$@"; do
  echo "$(stamp) start $step load $(cut -d' ' -f1 /proc/loadavg)"
  case "$step" in
    r1a) base --tasks a2-slow --models claude-haiku-5-5 --repetitions 4 ;;
    r1b) base --tasks a1-break --models claude-haiku-5-5 --repetitions 2 ;;
    r1c) base --tasks a2-slow,a1-break --models gpt-6-luna --repetitions 1 ;;
    r2) r2 ;;
  esac
  echo "$(stamp) end $step exit $?"
done
