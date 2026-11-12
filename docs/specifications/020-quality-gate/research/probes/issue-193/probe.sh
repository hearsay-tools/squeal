#!/bin/sh
# Throwaway probe for issue 193. Not a product test. Usage, from the checkout root:
#   sh docs/specifications/020-quality-gate/research/probes/issue-193/probe.sh <squeal.mjs> <out-dir>
# Builds a temp git repo with one node:test project (preload importing node:module through a
# helper; a test with a computed import()), then runs `squeal code --base main --json` twice:
# case "unrelated" changes a CI-only script; case "selected" changes the module the test imports.
# Set VITEST_MODULES to a node_modules holding vitest for the fourth case.
# No daemon (one-shot gate), HOME and XDG dirs point into the temp dir, the store is the temp repo's.
set -eu
CLI=$1; OUT=$2
cpus=$(nproc); load=$(cut -d' ' -f1 /proc/loadavg)
if [ "$(echo "$load > $cpus" | bc)" = 1 ]; then echo "skip: load $load > $cpus CPUs"; exit 0; fi
mkdir -p "$OUT"; OUT=$(cd "$OUT" && pwd); T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
R=$T/repo; mkdir -p $R/test $R/src $R/scripts $R/.github/scripts $T/home
cd $R; git init -q -b main; git config user.email p@example.invalid; git config user.name probe
cat > squeal.config.json <<'J'
{ "nodeTest": [{ "name": "unit", "argv": ["--import", "./scripts/preload.mjs"], "include": ["test/**/*.test.mjs"] },
  { "name": "root:unit", "argv": ["--import", "./scripts/preload.mjs"], "include": ["test/**/*.test.mjs"] }] }
J
echo '{ "name": "p193", "private": true, "type": "module" }' > package.json
echo 'import "./hooks-helper.mjs";' > scripts/preload.mjs
echo 'import { createRequire } from "node:module"; export const req = createRequire(import.meta.url);' > scripts/hooks-helper.mjs
echo 'export function add(a, b) { return a + b; }' > src/math.mjs
echo 'export const pick = (n) => n;' > src/extra.mjs
cat > test/math.test.mjs <<'J'
import { test } from "node:test";
import assert from "node:assert/strict";
import { add } from "../src/math.mjs";
const name = ["..", "src", "extra.mjs"].join("/");
test("add", async () => {
  const m = await import(name);
  assert.equal(add(1, m.pick(1)), 2);
});
J
cat > test/plain.test.mjs <<'J'
import { test } from "node:test";
import assert from "node:assert/strict";
test("plain", () => assert.equal(1, 1));
J
echo 'module.exports = 1;' > .github/scripts/ci.cjs
git add -A; git commit -qm base
run() {
  case=$1
  HOME=$T/home XDG_CONFIG_HOME=$T/home/.config XDG_STATE_HOME=$T/home/.state XDG_CACHE_HOME=$T/home/.cache \
    node "$CLI" code --base main --json >"$OUT/$case.stdout.json" 2>"$OUT/$case.stderr.txt" || echo "exit $?" >>"$OUT/$case.stderr.txt"
  echo "== $case: load $(cut -d' ' -f1 /proc/loadavg)/$cpus"; cat "$OUT/$case.stderr.txt"
}
git checkout -qb change1; echo 'module.exports = 2;' > .github/scripts/ci.cjs; git commit -qam ci; run unrelated
git checkout -q main; git checkout -qb change2
echo 'export function add(a, b) { const s = a + b; return s; }' > src/math.mjs; git commit -qam math; run selected
# The store now holds the selected runs: rerun, so the gate reads them and opens the store's key adapters.
run selected-again
echo "== store: $(ls -d .git/squeal* 2>/dev/null | tr '\n' ' ')"
# Only the module the computed import() loads changes: does the gate select the test?
git checkout -q main; git checkout -qb change4; echo 'export const pick = (n) => n + 0;' > src/extra.mjs; git commit -qam extra; run dynamic-only
# As in the issue: a linked task worktree, Vitest configured with no test file, the CI-only change.
if [ -n "${VITEST_MODULES:-}" ]; then
  git checkout -q main; ln -s "$VITEST_MODULES" node_modules; echo node_modules > .gitignore
  echo 'export default { test: { include: ["vt/**/*.test.ts"] } };' > vitest.config.mjs
  git add -A; git commit -qm vitest; git worktree add -q -b change3 $T/wt main; cd $T/wt; ln -s "$VITEST_MODULES" node_modules
  echo 'module.exports = 3;' > .github/scripts/ci.cjs; git commit -qam ci3; run worktree-vitest-unrelated
fi
