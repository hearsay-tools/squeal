#!/bin/sh
# Throwaway probe for research/issue-44.md. Not product code; delete freely.
# Usage: probe.sh <cli.mjs> [files]
# Builds a synthetic git repo in a fresh temp dir with one node:test project of
# <files> (default 25) passing test files and `baseline.onStart: lookup-only`,
# under a private HOME and XDG dirs so the daemon and store never touch the real
# ones. Starts that repo's daemon, edits one test file, runs a named wait on it,
# stops the daemon and removes the temp dir.
set -u
# Coordinator guard added after the recorded run; do not start above CPU capacity.
python3 -c 'import os, sys; load=os.getloadavg()[0]; cpus=os.cpu_count(); print(f"load guard: {load}, CPUs: {cpus}"); sys.exit(0 if load <= cpus else 3)' || exit 3
cli=$1 n=${2:-25}
tmp=$(mktemp -d)
export HOME="$tmp/home" XDG_CONFIG_HOME="$tmp/home/.config" XDG_DATA_HOME="$tmp/home/.local/share" \
  XDG_STATE_HOME="$tmp/home/.local/state" XDG_CACHE_HOME="$tmp/home/.cache" XDG_RUNTIME_DIR="$tmp/run"
mkdir -p "$HOME" "$XDG_RUNTIME_DIR"; chmod 700 "$XDG_RUNTIME_DIR"
repo="$tmp/repo"; mkdir -p "$repo/test"
sq() { node --disable-warning=ExperimentalWarning "$cli" "$@"; }
cd "$repo"
printf '{"name":"issue44","private":true,"type":"module"}\n' >package.json
printf '{"baseline":{"onStart":"lookup-only"},"nodeTest":[{"name":"unit","cwd":".","node":"%s","argv":[],"include":["test/*.test.mjs"]}]}\n' "$(command -v node)" >squeal.config.json
i=1; while [ "$i" -le "$n" ]; do
  printf 'import assert from "node:assert/strict";\nimport { test } from "node:test";\ntest("t%s", () => assert.equal(1, 1));\n' "$i" >"test/f$(printf %02d "$i").test.mjs"
  i=$((i + 1))
done
git init -q && git add -A && git -c user.name=p -c user.email=p@p commit -qm init
echo "load: $(cut -d' ' -f1-3 /proc/loadavg); cpus: $(nproc); version: $(sq --version 2>&1)"
echo "### \$ squeal start"; sq start >/dev/null 2>&1; echo "exit: $?"
echo "### \$ squeal status --wait 60000 (discovery)"; sq status --wait 60000 >/dev/null 2>&1; echo "exit: $?"
printf 'test("edited", () => assert.equal(2, 2));\n' >>test/f01.test.mjs
echo "### edited test/f01.test.mjs"
echo "### \$ squeal status --wait 60000 test/f01.test.mjs"
sq status --wait 60000 test/f01.test.mjs >"$tmp/out" 2>"$tmp/err"; code=$?
echo "exit: $code; stdout lines: $(wc -l <"$tmp/out"); stderr lines: $(wc -l <"$tmp/err")"
echo "first line starting Selected: $(grep -n '^Selected' "$tmp/out" | cut -d: -f1)"
echo "--- stderr"; cat "$tmp/err"; echo "--- stdout"; cat "$tmp/out"
echo "### \$ squeal status --json --wait 60000 test/f01.test.mjs (stderr only)"
sq status --json --wait 60000 test/f01.test.mjs >"$tmp/out" 2>"$tmp/err"; code=$?
echo "exit: $code; stdout lines: $(wc -l <"$tmp/out"); stderr lines: $(wc -l <"$tmp/err")"; cat "$tmp/err"
echo "### \$ squeal stop"; sq stop >/dev/null 2>&1; echo "exit: $?"
cd / && rm -rf "$tmp"
