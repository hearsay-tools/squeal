#!/usr/bin/env bash
# Throwaway probe (016-33). Runs tsc, ESLint and Ruff on every state that
# states.mjs wrote, with tools from a scratch install outside the worktree.
# Usage: run.sh <scratch-dir-with-node_modules-and-.venv> <out-dir>
set -u
S=$1; OUT=$2; HERE=$(cd "$(dirname "$0")" && pwd)
rm -rf "$S/states" && node "$HERE/states.mjs" "$S/states" >/dev/null
mkdir -p "$OUT/ts" "$OUT/js" "$OUT/py"
for d in "$S"/states/ts/*/; do n=$(basename "$d"); cp "$HERE/config/tsconfig.json" "$d"
  (cd "$d" && "$S/node_modules/.bin/tsc" --noEmit --pretty false -p . > "$OUT/ts/$n.txt"; echo "exit $?" >> "$OUT/ts/$n.txt"); done
for d in "$S"/states/js/*/; do n=$(basename "$d"); cp "$HERE/config/eslint.config.js" "$d"; echo '{"type":"module"}' > "$d/package.json"
  (cd "$d" && "$S/node_modules/.bin/eslint" -f json a.js b.js > "$OUT/js/$n.json"
   "$S/node_modules/.bin/eslint" -f "$S/node_modules/@microsoft/eslint-formatter-sarif/sarif.js" a.js b.js > "$OUT/js/$n.sarif"); done
for d in "$S"/states/py/*/; do n=$(basename "$d"); cp "$HERE/config/ruff.toml" "$d"
  (cd "$d" && for f in json gitlab sarif; do "$S/.venv/bin/ruff" check --no-cache --output-format $f a.py b.py > "$OUT/py/$n.$f"; done); done
echo "tsc $("$S/node_modules/.bin/tsc" --version); eslint $("$S/node_modules/.bin/eslint" --version); $("$S/.venv/bin/ruff" --version); node $(node --version)" > "$OUT/versions.txt"
