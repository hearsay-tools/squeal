#!/bin/sh
# Throwaway (026, tiered-pre-pr). Builds a fixture repository under $TMPDIR:
# 12 Vitest test files over 12 source files, one complex function, oxlint.
# Usage: make-fixture.sh <worktree root> <fixture dir> <variant>
#   variant "manual": the one Vitest group at "manual", oxlint group at "edit",
#                     complexity on, shared.ref "refs/squeal"
#   variant "stop":   the same with the Vitest group at "stop"
#   variant "edit":   the Vitest group at "edit" (today's default shape)
set -eu
WT=$1; FX=$2; VARIANT=$3
rm -rf "$FX"; mkdir -p "$FX/src" "$FX/test"
cd "$FX"
git init -q -b main .
ln -s "$WT/node_modules" node_modules
cat > package.json <<'J'
{ "name": "tp-fixture", "private": true, "type": "module",
  "devDependencies": { "vitest": "*", "oxlint": "*" } }
J
cat > vitest.config.ts <<'J'
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["test/**/*.test.ts"] } });
J
printf '{ "rules": { "no-unused-vars": "error" } }\n' > .oxlintrc.json
i=1
while [ $i -le 12 ]; do
  printf 'export const f%s = (a, b) => a + b + %s;\n' $i $i > src/m$i.js
  cat > test/m$i.test.ts <<J
import { expect, test } from "vitest";
import { f$i } from "../src/m$i.js";
test("f$i", () => { expect(f$i(1, 2)).toBe(3 + $i); });
J
  i=$((i+1))
done
cat > src/complex.js <<'J'
export function classify(x) {
  if (x > 1) return 1;
  if (x > 2) return 2;
  return 0;
}
J
case "$VARIANT" in
  manual) AT=manual ;;
  stop) AT=stop ;;
  edit) AT=edit ;;
  *) echo "unknown variant $VARIANT" >&2; exit 2 ;;
esac
cat > squeal.config.json <<J
{
  "checks": [
    { "name": "unit", "runner": "vitest", "at": "$AT" },
    { "name": "lint", "lint": ["oxlint"], "at": "edit" }
  ],
  "lint": { "enabled": true, "tools": ["oxlint"] },
  "complexity": { "enabled": true, "threshold": 3 },
  "shared": { "ref": "refs/squeal" },
  "runner": { "hostIdleMinutes": 1 }
}
J
printf '# fixture\n' > README.md
printf 'node_modules\n' > .gitignore
git add -A && git -c user.email=p@p -c user.name=p commit -qm fixture
# A local bare origin, so the shared-ref fetch has a remote that holds no ref.
git init -q --bare "$FX.origin"
git remote add origin "$FX.origin"
git push -q origin main
