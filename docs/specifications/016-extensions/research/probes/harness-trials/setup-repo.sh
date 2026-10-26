#!/bin/sh
# Throwaway probe (016-35). Run as squeal-e2e with HOME=/home/squeal-e2e.
# Makes the scratch repository $1 (default ~/ht035/repo): one Vitest test that
# passes, squeal.config.json, Vitest installed from npm, one commit.
set -eu
r=${1:-$HOME/ht035/repo}
mkdir -p "$r"
cd "$r"
git init -q
git config user.email e2e@example.invalid
git config user.name e2e
cat >package.json <<'EOF'
{ "name": "ht035", "private": true, "type": "module", "devDependencies": { "vitest": "5.0.3" } }
EOF
printf 'export const sum = (a, b) => a + b;\n' >sum.js
cat >sum.test.js <<'EOF'
import { expect, test } from "vitest";
import { sum } from "./sum.js";
test("sum adds", () => expect(sum(2, 3)).toBe(5));
EOF
printf '{}\n' >squeal.config.json
printf 'node_modules\n' >.gitignore
npm install --silent --no-audit --no-fund >/dev/null
npx vitest run >/dev/null
git add -A
git commit -qm init
echo "repo ready: $r"
