#!/usr/bin/env bash
# Throwaway boat.dev fixture; prepare with npm install --save-dev --save-exact vitest@5.0.3.
set -eu
: "${SQUEAL_CLI:?shipped CLI path}"
cd /tmp/issue-264-vitest/repo
mkdir -p src
printf '{}\n' > squeal.config.json
printf 'node_modules/\n' > .gitignore
cat > src/a.test.ts <<'JS'
import { it, expect } from 'vitest';
const target = './' + 'value.ts';
it('runtime input', async () => {
  const { value } = await import(target);
  expect(value).toBe(2);
});
JS
printf 'export const value = 1;\n' > src/value.ts
git init -q
git config user.name 'Issue 264 probe'
git config user.email 'probe@example.invalid'
git add package.json package-lock.json squeal.config.json .gitignore src
git commit -qm break
base=$(git rev-parse HEAD)
printf 'export const value = 2;\n' > src/value.ts
git add src/value.ts
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
  node "$SQUEAL_CLI" proof src/a.test.ts --base "$base" --case source --source src/value.ts --timeout 90 --json "$@" > "/tmp/issue-264-vitest/$label.json" 2> "/tmp/issue-264-vitest/$label.err"
  result=$?
  set -e
  printf '\n%s EXIT=%s\n' "$label" "$result"
  cat "/tmp/issue-264-vitest/$label.json" "/tmp/issue-264-vitest/$label.err"
}
run first
run stored
run conditioned --env D5_PROOF=1
