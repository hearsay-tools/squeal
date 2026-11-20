#!/usr/bin/env bash
# Throwaway (spec 018 research ci-other-runners): does a CI-shaped clone key node:test files as a
# developer clone does? Clone A: developer path, real HOME. Clone B: GitHub runner layout under
# $BASE (path, HOME, Node copied to a tool-cache path), with or without CI variables ($CI_VARS=1).
# Export from A, import into B, read B's status. Stops both daemons and leaves the clones for reading.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
BASE=${BASE:?set BASE to a scratch dir under TMPDIR}
NODE_SRC=$(dirname "$(readlink -f "$HOME/.nvm/versions/node/v26.13.0/bin/node")")
SQ_CLI=${SQ_CLI:?set SQ_CLI to a squeal.mjs}
rm -rf "$BASE"; mkdir -p "$BASE/origin"
cp -r "$HERE/node-fixture/." "$BASE/origin/"
git -C "$BASE/origin" init -q -b main && git -C "$BASE/origin" add -A && git -C "$BASE/origin" -c user.name=p -c user.email=p@p commit -qm fixture
A=$BASE/dev/port-node; B=$BASE/home/runner/work/port-node/port-node
git clone -q "$BASE/origin" "$A"; git clone -q "$BASE/origin" "$B"
TC=$BASE/opt/hostedtoolcache/node/26.13.0/x64/bin; mkdir -p "$TC"; cp "$NODE_SRC/node" "$TC/node"
mkdir -p "$BASE/home/runner/tmp"
devenv=(env -i HOME="$HOME" PATH="$NODE_SRC:/usr/bin:/bin" TMPDIR="$TMPDIR" LANG=C.UTF-8)
cienv=(env -i HOME="$BASE/home/runner" PATH="$TC:/usr/bin:/bin" TMPDIR="$BASE/home/runner/tmp" LANG=C.UTF-8 RUNNER_TEMP="$BASE/home/runner/tmp")
[ "${CI_VARS:-0}" = 1 ] && cienv+=(CI=true GITHUB_ACTIONS=true)
echo "== A (developer) at $A"
(cd "$A" && nice "${devenv[@]}" node --disable-warning=ExperimentalWarning "$SQ_CLI" start >/dev/null && nice "${devenv[@]}" node --disable-warning=ExperimentalWarning "$SQ_CLI" run --all --wait >/dev/null || true
 "${devenv[@]}" node --disable-warning=ExperimentalWarning "$SQ_CLI" status | head -5
 "${devenv[@]}" node --disable-warning=ExperimentalWarning "$SQ_CLI" export --out "$BASE/a.json.gz"
 "${devenv[@]}" node --disable-warning=ExperimentalWarning "$SQ_CLI" stop >/dev/null)
echo "== B (CI-shaped, CI_VARS=${CI_VARS:-0}) at $B"
(cd "$B" && nice "${cienv[@]}" node --disable-warning=ExperimentalWarning "$SQ_CLI" start >/dev/null
 "${cienv[@]}" node --disable-warning=ExperimentalWarning "$SQ_CLI" status --wait 30000 >/dev/null || true
 "${cienv[@]}" node --disable-warning=ExperimentalWarning "$SQ_CLI" import --dry-run "$BASE/a.json.gz" || true
 "${cienv[@]}" node --disable-warning=ExperimentalWarning "$SQ_CLI" import "$BASE/a.json.gz" || true
 "${cienv[@]}" node --disable-warning=ExperimentalWarning "$SQ_CLI" status --wait 20000 --full | grep -i -A3 'import' | head -20 || true
 nice "${cienv[@]}" node --disable-warning=ExperimentalWarning "$SQ_CLI" run --all --force --wait >/dev/null || true
 "${cienv[@]}" node --disable-warning=ExperimentalWarning "$SQ_CLI" export --out "$BASE/b.json.gz" || true
 "${cienv[@]}" node --disable-warning=ExperimentalWarning "$SQ_CLI" stop >/dev/null)
echo "== keys and environments, A against B's own run"
python3 "$HERE/compare.py" "$BASE/a.json.gz" "$BASE/b.json.gz"
