#!/bin/sh
# Throwaway probe for research 017-26: the stages.mjs variants, one at a time, at nice 10.
#   run-stages.sh <scratch> <out.jsonl> [variant...]
# Variants: svelte-typed svelte-typed-nogc svelte-untyped saas-root saas-flag saas-flag-nogc,
# and svelte-typed-cap<N>, saas-flag-cap<N>: no GC between stages, the worker's old space capped at N MB.
S=$1; OUT=$2; shift 2
HERE=$(cd "$(dirname "$0")" && pwd)
. "$S/env.sh"
run() { # label repo branch [env...]
  label=$1 repo=$S/repos/$2 branch=$3; shift 3
  git -C "$repo" checkout -q "$branch" || exit 1
  echo "== $label $(date -u +%H:%M:%SZ) load $(cut -d' ' -f1 /proc/loadavg)"
  (cd "$repo" && env "$@" nice -n 10 node --expose-gc "$HERE/stages.mjs" "$repo" "$S/squeal/dist/cli" "$OUT" "$label")
}
for v in "$@"; do
  case $v in
    svelte-typed) run $v svelte dogfood LM_IDLE_S=${LM_IDLE_S:-0} ;;
    svelte-typed-nogc) run $v svelte dogfood LM_NOGC=1 ;;
    svelte-untyped) run $v svelte untyped ;;
    saas-root) run $v saas dogfood ;;
    saas-flag) run $v saas dogfood ESLINT_FLAGS=v10_config_lookup_from_file ;;
    saas-flag-nogc) run $v saas dogfood ESLINT_FLAGS=v10_config_lookup_from_file LM_NOGC=1 ;;
    svelte-typed-cap*) run $v svelte dogfood LM_NOGC=1 LM_OLD_MB=${v#svelte-typed-cap} ;;
    saas-flag-cap*) run $v saas dogfood ESLINT_FLAGS=v10_config_lookup_from_file LM_NOGC=1 LM_OLD_MB=${v#saas-flag-cap} ;;
  esac
done
git -C "$S/repos/svelte" checkout -q dogfood
