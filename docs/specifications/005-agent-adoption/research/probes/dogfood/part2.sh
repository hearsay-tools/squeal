#!/bin/sh
# Throwaway probe for 005-18 part 2: cezar, as squeal-e2e, in /home/squeal-e2e/runs/sq18-cz.
#   asis/   `git archive` of cezar 5dbb4b09 committed as fa994be, with cezar's squeal.config.json
#   fresh/  a `git worktree` of asis at 3a5d161: the same tree with squeal.config.json removed,
#           so it shares asis's store, as a fresh cezar worktree shares its main checkout's
#   skill/  a separate clone at 3a5d161, for the setup-skill sessions
# Each has `pnpm install --frozen-lockfile` (pnpm 12.11.2 via corepack). No model runs here.
#   sh part2.sh <out dir> [build|a|b]...   (default: build a b)
#     build  `npm run build` in asis and fresh, so the packaged-CLI e2e has its artifact
#     a      arm (a): `squeal warmup` on cezar's own config, then status
#     b      arm (b): `squeal setup --yes` (every default, warm-up included) in fresh, then its
#            diff, config and status
# Every output line is timestamped (UTC, seconds since the step's start) as it arrives.
set -u
here=$(cd "$(dirname "$0")" && pwd)
out=$1
shift
mkdir -p "$out"
R=/home/squeal-e2e/runs/sq18-cz
export E2E_VAR_COREPACK_ENABLE_DOWNLOAD_PROMPT=0
as() { dir=$1; shift; node "$here/as-e2e.mjs" "$R" "$R/$dir" "$@"; }
stamp() { python3 -I -u -c '
import sys, time
t0 = time.time()
for line in sys.stdin:
    print(f"{time.strftime(\"%H:%M:%SZ\", time.gmtime())} +{time.time() - t0:7.1f}s {line}", end="", flush=True)
'; }
step() {
  name=$1
  shift
  echo "== $name start $(date -u +%FT%TZ) load $(cut -d' ' -f1 /proc/loadavg)"
  "$@" 2>&1 | stamp > "$out/$name.log"
  echo "== $name end $(date -u +%FT%TZ) load $(cut -d' ' -f1 /proc/loadavg)"
}

[ $# -eq 0 ] && set -- build a b
for s in "$@"; do
  case "$s" in
    build)
      step build-asis as asis corepack pnpm run build
      step build-fresh as fresh corepack pnpm run build
      ;;
    a)
      step a-warmup as asis squeal warmup
      as asis squeal status > "$out/a-status.txt" 2>&1
      as asis squeal status --json > "$out/a-status.json" 2>&1
      ;;
    b)
      step b-setup as fresh squeal setup --yes
      as fresh git status --short > "$out/b-git-status.txt" 2>&1
      as fresh git diff > "$out/b-diff.txt" 2>&1
      as fresh cat squeal.config.json > "$out/b-config.json" 2>&1
      as fresh squeal status > "$out/b-status.txt" 2>&1
      as fresh squeal status --json > "$out/b-status.json" 2>&1
      ;;
  esac
done
