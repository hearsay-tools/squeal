#!/bin/sh
# Row 011-135 probe, step 4: what each runner's own name filter selects, and what it reports
# for the checks it leaves out. One fixture of four checks (one red, one in a nested suite, one
# at top level) per runner. Usage: S=/tmp/d1-135-XXXX sh filters.sh [squeal worktree]
#   Vitest 4.1.10: the cezarion clone's node_modules (setup.sh); Vitest 5.0.3: the Squeal
#   worktree's node_modules (default: this script's worktree), each through a symlink in $S,
#   with Vite's cache under $S. node:test: the host's Node. pytest: a venv under $S.
set -u
here=$(cd "$(dirname "$0")" && pwd)
. "$here/env.sh"
squeal=${1:-$(cd "$here/../../../../../.." && pwd)}
export VITE_CONFIG_NATIVE_IGNORE_WARNING=true NO_COLOR=1
fixture() { # <dir>: the Vitest fixture
  mkdir -p "$1/t"
  cat >"$1/t/a.test.ts" <<'EOF'
import { describe, it, expect } from 'vitest'
describe('parity', () => {
  it('old 1', () => {})
  it('new 1', () => { expect(1).toBe(2) })
  describe('inner', () => { it('new 2', () => {}) })
})
it('new 3 top', () => {})
EOF
  printf "import { defineConfig } from 'vitest/config'\nexport default defineConfig({ cacheDir: '%s', test: { include: ['t/*.test.ts'] } })\n" \
    "$1-cache" >"$1/vitest.config.mts"
}
vitest_case() { # <dir> <label>
  echo "== $2: vitest $(node -p "require('$1/node_modules/vitest/package.json').version")"
  for p in "new 1" "parity > new 1" "^parity new 1\$" "^parity inner new 2\$" "-"; do
    echo "-- pattern: $p"
    (cd "$1" && node "$here/spec-filter.mjs" "$1" t/a.test.ts "$p" 2>&1 | grep -E '^(case|module end|module tests)')
  done
}
for v in v4 v5; do rm -rf "$S/$v" "$S/$v-cache"; mkdir -p "$S/$v"; fixture "$S/$v"; done
ln -s "$REPO/node_modules" "$S/v4/node_modules"
ln -s "$squeal/node_modules" "$S/v5/node_modules"
vitest_case "$S/v4" "Vitest 4 (cezarion)"
vitest_case "$S/v5" "Vitest 5 (Squeal)"

echo "== node:test, node $(node --version)"
mkdir -p "$S/nt"
cat >"$S/nt/a.test.mjs" <<'EOF'
import { describe, it } from "node:test";
import assert from "node:assert";
describe("parity", () => {
  it("old 1", () => {});
  it("new 1", () => { assert.equal(1, 2); });
  describe("inner", () => { it("new 2", () => {}); });
});
it("new 3 top", () => {});
EOF
for p in "new" "parity new 1" "parity > new 1" "^parity inner new 2\$" "inner"; do
  echo "-- --test-name-pattern=$p"
  (cd "$S/nt" && node --test --test-reporter=tap --test-name-pattern="$p" a.test.mjs 2>&1 |
    grep -E '^ *(ok|not ok)|^# (tests|pass|fail|skipped)')
done

echo "== pytest"
[ -x "$S/venv/bin/python" ] || { python3 -m venv "$S/venv" && "$S/venv/bin/pip" -q install pytest; }
"$S/venv/bin/python" -I -m pytest --version 2>&1
mkdir -p "$S/py"
cat >"$S/py/test_parity.py" <<'EOF'
import pytest
class TestParity:
    def test_old_1(self): pass
    def test_new_1(self): assert 1 == 2
    @pytest.mark.parametrize("n", [1, 2])
    def test_new_param(self, n): pass
def test_new_top(): pass
EOF
cat >"$S/pyfilter.py" <<'EOF'
# A stand-in for a hook in squeal_pytest: keep the items whose full name holds SELECT.
import os
def pytest_collection_modifyitems(session, config, items):
    text = os.environ.get("SELECT")
    if not text:
        return
    keep, drop = [], []
    for item in items:
        (keep if text in item.nodeid.split("::", 1)[1] else drop).append(item)
    if drop:
        config.hook.pytest_deselected(items=drop)
        items[:] = keep
EOF
cd "$S/py"
echo "-- node ids TestParity::test_new_1 and TestParity::test_new_param[2]"
"$S/venv/bin/python" -I -m pytest -q -p no:cacheprovider -rA \
  "test_parity.py::TestParity::test_new_1" "test_parity.py::TestParity::test_new_param[2]" 2>&1 |
  grep -E 'PASSED|FAILED|passed|failed'
echo "-- -k new_1"
"$S/venv/bin/python" -I -m pytest -q -p no:cacheprovider -rA -k new_1 test_parity.py 2>&1 |
  grep -E 'PASSED|FAILED|passed|failed'
echo "-- deselect hook, SELECT=TestParity::test_new"
SELECT="TestParity::test_new" PYTHONPATH="$S" "$S/venv/bin/python" -m pytest -q -p no:cacheprovider \
  -p pyfilter -rA test_parity.py 2>&1 | grep -E 'PASSED|FAILED|passed|failed'
