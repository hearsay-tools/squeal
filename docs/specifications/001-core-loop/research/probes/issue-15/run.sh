#!/usr/bin/env bash
# Throwaway probe for issue 15 (`../../issue-15.md`). Builds a git repository
# under a fresh /tmp directory with three worktrees of one failing test file,
# runs Squeal's real daemons and CLI there, and saves `why --json` after each
# step under `out/`. Nothing here is product code.
#
#   A: the invoking worktree. Its run fails first, at key K.
#   C: 21 edits, each a new key, each a newer failing result (the 20-result cap).
#   B: the same content as A, so key K; its later run replaces A's row.
#
# Usage: [OUT_DIR=dir] [EDITS=n] run.sh [squeal-cli.mjs]   (default: this worktree's committed bundle, out/)
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
REPO_ROOT=$(cd "$HERE/../../../../../.." && pwd)
CLI=${1:-$REPO_ROOT/plugins/claude-code/dist/cli/squeal.mjs}
VITEST_CACHE=${VITEST_CACHE:-/tmp/squeal-e2e-cache/vitest-5.0.3-vite-8.3.2-node24-linux-x64}
OUT=${OUT_DIR:-$HERE/out}
TMP=$(mktemp -d /tmp/squeal-issue15-XXXXXX)
mkdir -p "$OUT" "$TMP/home"
echo "fixture: $TMP" | tee "$OUT/fixture.txt"

# No real HOME, no session or credential variables: only what Node and git need.
sq() {
  local wt=$1; shift
  (cd "$TMP/$wt" && env -i PATH="$PATH" HOME="$TMP/home" XDG_CONFIG_HOME="$TMP/home/.config" \
    XDG_DATA_HOME="$TMP/home/.local/share" TMPDIR=/tmp node "$CLI" "$@")
}
why() { sq "$1" why "installed runners resolve both bundled mocks" --json > "$OUT/$2.json" || true; }

test_file() {
  # Same bytes in A and B; C appends a counter comment so each edit is a new key.
  cat <<'EOF'
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";

test("installed runners resolve both bundled mocks", () => {
  const dir = mkdtempSync(join(tmpdir(), "cez-cursor-package-"));
  // Each daemon's TMPDIR (/tmp/squeal-<uid>/tmp/<key>/) and a fresh suffix mark each run's error.
  expect(`${process.cwd()} ${dir}`).toBe("present");
});
EOF
}

git init -q -b main "$TMP/wt-a"
cd "$TMP/wt-a"
git config user.email probe@example.invalid && git config user.name probe
cp "$VITEST_CACHE/package.json" "$VITEST_CACHE/package-lock.json" .
printf 'node_modules/\n' > .gitignore
printf 'export default { test: {} };\n' > vitest.config.ts
printf '{}\n' > squeal.config.json
mkdir test && test_file > test/cursor.test.ts
git add -A && git commit -qm fixture
for wt in wt-b wt-c; do git worktree add -q "$TMP/$wt"; done
for wt in wt-a wt-b wt-c; do cp -al "$VITEST_CACHE/node_modules" "$TMP/$wt/node_modules"; done

# 1. A fails at key K.
sq wt-a start > "$OUT/1-a-start.txt" 2>&1 || true
sq wt-a run --all --wait > "$OUT/1-a-run.txt" 2>&1 || true
why wt-a 1-why-a-own
sq wt-a status --json > "$OUT/1-status-a.json" 2>&1 || true
STORE="$TMP/wt-a/.git/squeal/store.sqlite"
MARKER=$(grep -o '/tmp/squeal-[0-9]*/tmp/[0-9a-f]*/cez-cursor-package-[A-Za-z0-9]*' "$OUT/1-why-a-own.json" | head -1)

# 2. C: EDITS (default 21) newer failing results under as many other keys.
sq wt-c start > "$OUT/2-c-start.txt" 2>&1 || true
for i in $(seq 1 "${EDITS:-21}"); do
  { test_file; echo "// edit $i"; } > "$TMP/wt-c/test/cursor.test.ts"
  sq wt-c status --wait 120000 test/cursor.test.ts >> "$OUT/2-c-runs.txt" 2>&1 || true
done
why wt-a 2-why-a-after-foreign-keys
node "$HERE/rows.mjs" "$STORE" "$MARKER" > "$OUT/2-rows.txt"

# 3. B: same bytes as A, so key K; its run replaces A's row.
sq wt-b start > "$OUT/3-b-start.txt" 2>&1 || true
sq wt-b run --all --wait > "$OUT/3-b-run.txt" 2>&1 || true
sleep 5 # let A's daemon see the replaced row if it would
why wt-a 3-why-a-after-same-key
sq wt-a why "installed runners resolve both bundled mocks" > "$OUT/3-why-a-after-same-key.txt" 2>&1 || true
sq wt-a status --json > "$OUT/3-status-a.json" 2>&1 || true
node "$HERE/rows.mjs" "$STORE" "$MARKER" > "$OUT/3-rows.txt"

# Run logs on disk, to tell a lost pointer from a pruned log.
find "$TMP/wt-a/.git/squeal" -name vitest.log | sort > "$OUT/run-logs.txt" || true
for wt in wt-a wt-b wt-c; do sq "$wt" stop > /dev/null 2>&1 || true; done
node "$HERE/summarize.mjs" "$OUT" | tee "$OUT/summary.txt"
