#!/bin/sh
# Throwaway probe (016-35). Run as squeal-e2e with HOME=/home/squeal-e2e.
# Adds mul.js and slow.test.js (a 4 s test, under Vitest's 5 s timeout) to the scratch repository, so an
# edit of mul.js leaves a check pending when the turn ends: the case Squeal's
# idle wake covers (the test files pending at the end of the turn).
set -eu
cd "$HOME/ht035/repo"
printf 'export const mul = (a, b) => a * b;\n' >mul.js
cat >slow.test.js <<'EOF'
import { expect, test } from "vitest";
import { mul } from "./mul.js";
test("mul multiplies, slowly", async () => {
  await new Promise((r) => setTimeout(r, 4000));
  expect(mul(2, 3)).toBe(6);
});
EOF
git add mul.js slow.test.js
git commit -qm "slow test"
echo added
