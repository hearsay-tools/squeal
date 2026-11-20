#!/usr/bin/env bash
# Throwaway (spec 018 research ci-other-runners): cezar's 148 node:test files in two fresh clones at
# one commit, prepared beforehand under $C: A at a developer path with the real HOME, B at a GitHub
# runner path with its own HOME, Node copied to a tool-cache path, CI variables unset. Each runs only
# the node:test files (never the whole suite) and exports; the exports' keys are compared.
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
C=${C:?}; SQ_CLI=${SQ_CLI:?}
A=$C/dev/cezar; B=$C/home/runner/work/cezar/cezar
NODE_SRC=$(dirname "$(readlink -f "$HOME/.nvm/versions/node/v26.13.0/bin/node")")
TC=$C/opt/hostedtoolcache/node/26.13.0/x64/bin; mkdir -p "$TC"; cp "$NODE_SRC/node" "$TC/node"
mapfile -t FILES < <(git -C "$A" ls-files | grep -E '^packages/cezar/test/unit/[^/]*\.test\.ts$|^\.github/scripts/[^/]*\.test\.cjs$|^scripts/[^/]*\.test\.mjs$|^\.ai/skills/[^/]*/scripts/[^/]*\.test\.mjs$')
echo "node:test files: ${#FILES[@]}"
sq() { node --disable-warning=ExperimentalWarning "$SQ_CLI" "$@"; }
devenv=(env -i HOME="$HOME" PATH="$NODE_SRC:/usr/bin:/bin" TMPDIR="$TMPDIR" LANG=C.UTF-8)
cienv=(env -i HOME="$C/home/runner" PATH="$TC:/usr/bin:/bin" TMPDIR="$C/home/runner/tmp" RUNNER_TEMP="$C/home/runner/tmp" LANG=C.UTF-8)
side() { # name env... -- out
  local name=$1; shift; local -a e=(); while [ "$1" != -- ]; do e+=("$1"); shift; done; shift; local out=$1
  echo "== $name: $(uptime)"; local t0=$(date +%s)
  nice "${e[@]}" node --disable-warning=ExperimentalWarning "$SQ_CLI" start >/dev/null
  "${e[@]}" node --disable-warning=ExperimentalWarning "$SQ_CLI" status --wait 180000 | head -4
  [ -n "${IMPORT:-}" ] && "${e[@]}" node --disable-warning=ExperimentalWarning "$SQ_CLI" import --dry-run "$IMPORT"
  nice "${e[@]}" node --disable-warning=ExperimentalWarning "$SQ_CLI" run tests "${FILES[@]}" --wait 1500000 | tail -4
  "${e[@]}" node --disable-warning=ExperimentalWarning "$SQ_CLI" export --out "$out"
  "${e[@]}" node --disable-warning=ExperimentalWarning "$SQ_CLI" stop >/dev/null
  echo "== $name done in $(( $(date +%s) - t0 )) s; $(uptime)"
}
(cd "$A" && side A "${devenv[@]}" -- "$C/a.json.gz")
(cd "$B" && IMPORT="$C/a.json.gz" side B "${cienv[@]}" -- "$C/b.json.gz")
python3 "$HERE/compare.py" "$C/a.json.gz" "$C/b.json.gz"
