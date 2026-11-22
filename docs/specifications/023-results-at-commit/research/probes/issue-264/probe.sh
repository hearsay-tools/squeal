#!/usr/bin/env bash
# Throwaway fixture. Run only in the task-owned boat.dev sandbox.
set -eu
: "${SQUEAL_CLI:?shipped CLI path}"
mkdir -p /tmp/issue-264/repo/src
cd /tmp/issue-264/repo
printf '{"name":"proof-probe","version":"1.0.0","private":true,"type":"module"}\n' > package.json
printf '{"name":"proof-probe","version":"1.0.0","lockfileVersion":3,"requires":true,"packages":{"":{"name":"proof-probe","version":"1.0.0"}}}\n' > package-lock.json
printf '{"nodeTest":[{"name":"node","include":["src/*.test.mjs"]}]}\n' > squeal.config.json
printf 'node_modules/\n' > .gitignore
cat > src/a.test.mjs <<'JS'
import { test } from 'node:test';
import assert from 'node:assert/strict';
const target = './' + 'value.mjs';
test('runtime input', async () => {
  const { value } = await import(target);
  assert.equal(value, 2);
});
JS
printf 'export const value = 1;\n' > src/value.mjs
git init -q
git config user.name 'Issue 264 probe'
git config user.email 'probe@example.invalid'
git add package.json package-lock.json squeal.config.json .gitignore src
git commit -qm break
base=$(git rev-parse HEAD)
printf 'export const value = 2;\n' > src/value.mjs
git add src/value.mjs
git commit -qm fix
cat /proc/loadavg
getconf _NPROCESSORS_ONLN
node --version
node "$SQUEAL_CLI" --version
node "$SQUEAL_CLI" checks
run() {
  label=$1
  shift
  set +e
  node "$SQUEAL_CLI" proof src/a.test.mjs --base "$base" --case source --source src/value.mjs --timeout 90 --json "$@" > "/tmp/issue-264/$label.json" 2> "/tmp/issue-264/$label.err"
  result=$?
  set -e
  printf '\n%s EXIT=%s\n' "$label" "$result"
  cat "/tmp/issue-264/$label.json" "/tmp/issue-264/$label.err"
}
run first
run stored
run conditioned --env D5_PROOF=1
