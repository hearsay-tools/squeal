#!/usr/bin/env bash
# Throwaway, dependency-free fixture; never run in a product checkout.
set -eu
: "${PROBE_ROOT:?new scratch directory}"
: "${SQUEAL_CLI:?shipped CLI absolute path}"
mkdir -p "$PROBE_ROOT/repo/src" "$PROBE_ROOT/cache" "$PROBE_ROOT/data" "$PROBE_ROOT/config"
export XDG_CACHE_HOME="$PROBE_ROOT/cache" XDG_DATA_HOME="$PROBE_ROOT/data" XDG_CONFIG_HOME="$PROBE_ROOT/config"
cd "$PROBE_ROOT/repo"
cat > package.json <<'JSON'
{"name":"issue-256-probe","version":"1.0.0","private":true,"type":"commonjs","packageManager":"pnpm@10.32.0"}
JSON
printf 'lockfileVersion: '\''9.0'\''\nsettings:\n  autoInstallPeers: true\n  excludeLinksFromLockfile: false\nimporters:\n  .: {}\n' > pnpm-lock.yaml
printf '{"nodeTest":[{"name":"node","include":["src/*.test.cjs"]}]}\n' > squeal.config.json
printf 'node_modules/\n' > .gitignore
printf 'const { runKit } = require("./rows.testkit.cjs");\nrunKit();\n' > src/thin.test.cjs
cat > src/rows.testkit.cjs <<'JS'
const { test } = require('node:test');
const assert = require('node:assert/strict');
async function guarded(guard) {
  if (false && guard) throw new Error('guard rejected');
}
exports.runKit = () => test('guard rejects', async () => {
  await assert.rejects(guarded(true), /guard rejected/);
});
JS
git init -q
git config user.name 'Issue 256 probe'
git config user.email 'probe@example.invalid'
git add package.json pnpm-lock.yaml squeal.config.json .gitignore src
git commit -qm 'broken imported guard'
base=$(git rev-parse HEAD)
sed -i 's/false \&\& guard/guard/' src/rows.testkit.cjs
git add src/rows.testkit.cjs
git commit -qm 'fix imported guard'
printf 'BASE=%s\nHEAD=%s\n' "$base" "$(git rev-parse HEAD)"
node --disable-warning=ExperimentalWarning "$SQUEAL_CLI" checks
run() {
  local label=$1
  shift
  set +e
  node --disable-warning=ExperimentalWarning "$SQUEAL_CLI" proof "$@" --base "$base" --case source --timeout 90 --json > "$PROBE_ROOT/$label.json" 2> "$PROBE_ROOT/$label.err"
  local result=$?
  set -e
  printf '\n%s EXIT=%s\n' "$label" "$result"
  cat "$PROBE_ROOT/$label.json" "$PROBE_ROOT/$label.err"
}
run positional src/thin.test.cjs src/rows.testkit.cjs
run source src/thin.test.cjs --source src/rows.testkit.cjs
run with src/thin.test.cjs --with src/rows.testkit.cjs
run source-repeat src/thin.test.cjs --source src/rows.testkit.cjs
git status --short
git worktree list
