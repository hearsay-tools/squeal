#!/usr/bin/env bash
# Q4 (throwaway): oxlint's JSON for findings, a parse error and configs that do
# not load, on each installed version. Usage: output.sh <scratch> <toolDir>...
set -u
S=$1; shift
W=$S/output; rm -rf "$W"; mkdir -p "$W/src"; cd "$W"; git init -q .
printf 'node_modules\n' > .gitignore
cat > .oxlintrc.json <<'J'
{ "plugins": ["eslint", "typescript", "unicorn"], "rules": { "no-unused-vars": "warn", "eqeqeq": "error", "no-debugger": "error" } }
J
printf 'const ü = "ä";\nexport const f = (x: number) => x == 1 && ü;\ndebugger;\n' > src/ok.ts
printf 'export const broken = (;\n' > src/parse.ts
printf 'const unusedThing = 2;\n' > src/warn.js
for T in "$@"; do
  rm -f node_modules; ln -s "$T/node_modules" node_modules
  V=$(node node_modules/oxlint/bin/oxlint --version)
  echo "=== $V: findings, parse error ($T)"
  node node_modules/oxlint/bin/oxlint --format json; echo "exit $?"
  echo "=== $V: invalid JSON config"
  cp .oxlintrc.json good.json; printf '{ "rules": { ' > .oxlintrc.json
  node node_modules/oxlint/bin/oxlint --format json src/ok.ts; echo "exit $?"
  echo "=== $V: unknown rule"
  printf '{ "rules": { "no-such-rule": "error" } }' > .oxlintrc.json
  node node_modules/oxlint/bin/oxlint --format json src/ok.ts; echo "exit $?"
  echo "=== $V: missing JS plugin"
  printf '{ "jsPlugins": ["./nope.mjs"], "rules": {} }' > .oxlintrc.json
  node node_modules/oxlint/bin/oxlint --format json src/ok.ts; echo "exit $?"
  echo "=== $V: nested config invalid"
  cp good.json .oxlintrc.json; mkdir -p src; printf '{ bad' > src/.oxlintrc.json
  node node_modules/oxlint/bin/oxlint --format json src/ok.ts; echo "exit $?"
  rm -f src/.oxlintrc.json
  echo "=== $V: file that does not exist"
  node node_modules/oxlint/bin/oxlint --format json src/gone.ts; echo "exit $?"
  echo "=== $V: type-aware without oxlint-tsgolint"
  node node_modules/oxlint/bin/oxlint --format json --type-aware src/ok.ts 2>&1 | head -5; echo "exit ${PIPESTATUS[0]}"
done
