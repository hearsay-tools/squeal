#!/usr/bin/env bash
# Throwaway fixture. Run on apptension-lab; do not run inside a product checkout.
set -eu
: "${PROBE_ROOT:?Set PROBE_ROOT to a new scratch directory}"
: "${SQUEAL_CLI:?Set SQUEAL_CLI to the shipped dist/cli/squeal.mjs}"
mkdir -p "$PROBE_ROOT/repo/src" "$PROBE_ROOT/cache" "$PROBE_ROOT/data" "$PROBE_ROOT/config"
export XDG_CACHE_HOME="$PROBE_ROOT/cache"
export XDG_DATA_HOME="$PROBE_ROOT/data"
export XDG_CONFIG_HOME="$PROBE_ROOT/config"
cd "$PROBE_ROOT/repo"
cat > package.json <<'JSON'
{"name":"issue-247-probe","version":"1.0.0","private":true,"type":"module","packageManager":"pnpm@10.32.0","devDependencies":{"vitest":"5.0.3"}}
JSON
cat > .gitignore <<'TEXT'
node_modules/
TEXT
cat > vitest.config.ts <<'TS'
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['src/*.test.ts'], maxWorkers: 1 } });
TS
cat > squeal.config.json <<'JSON'
{}
JSON
cat > src/thin.test.ts <<'TS'
import { runKit } from './rows.testkit';
runKit();
TS
cat > src/value.ts <<'TS'
export const value = 1;
TS
cat > src/rows.testkit.ts <<'TS'
import { it, expect } from 'vitest';
import { value } from './value';
export function runKit() {
  it('existing row', () => expect(value).toBeGreaterThanOrEqual(1));
}
TS
pnpm install --frozen-lockfile=false
# Local identity only; no remote and no credentials.
git init -q
git config user.name 'Issue 247 probe'
git config user.email 'probe@example.invalid'
git add .gitignore package.json pnpm-lock.yaml vitest.config.ts squeal.config.json src
git commit -qm base
base=$(git rev-parse HEAD)
cat > src/value.ts <<'TS'
export const value = 2;
TS
cat > src/rows.testkit.ts <<'TS'
import { it, expect } from 'vitest';
import { value } from './value';
export function runKit() {
  it('existing row', () => expect(value).toBeGreaterThanOrEqual(1));
  it('new row catches the bug', () => expect(value).toBe(2));
}
TS
git add src
git commit -qm 'fix source and add kit row'
printf 'base=%s\nhead=%s\n' "$base" "$(git rev-parse HEAD)"
git diff --stat "$base" HEAD
run_proof() {
  local label=$1
  shift
  printf '\nCOMMAND %s: node "$SQUEAL_CLI" proof' "$label"
  printf ' %q' "$@"
  printf '\n'
  set +e
  node --disable-warning=ExperimentalWarning "$SQUEAL_CLI" proof "$@" > "$PROBE_ROOT/$label.out" 2> "$PROBE_ROOT/$label.err"
  local status=$?
  set -e
  cat "$PROBE_ROOT/$label.out" "$PROBE_ROOT/$label.err"
  printf 'EXIT %s: %s\n' "$label" "$status"
}
run_proof thin src/thin.test.ts --base "$base" --timeout 120
run_proof named-kit src/thin.test.ts src/rows.testkit.ts --base "$base" --timeout 120
run_proof explicit-source src/thin.test.ts --base "$base" --case source --timeout 120
