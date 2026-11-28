#!/usr/bin/env bash
# Throwaway probe, row 011-440. Runs ON the sandbox. Patches two proof tests (in the sandbox's clone only)
# to write the proof command's stderr and JSON report (`first.why`) to $WHY_DIR before the assertions.
set -euo pipefail
cd /home/user/squeal
git checkout -q -- test/cli/proof-kept-key.test.ts test/cli/proof-not-kept.test.ts
for f in test/cli/proof-kept-key.test.ts test/cli/proof-not-kept.test.ts; do
  name=$(basename $f .test.ts)
  sed -i '1i import { writeFileSync as __w } from "node:fs";' $f
  sed -i "s|^\(\s*\)const first = await prove(\(.*\));|&\n\1__w(\`\${process.env.WHY_DIR}/$name-\${Date.now()}.txt\`, first.why);|" $f
  grep -c "__w(" $f
done
# Also: src/cli/proof.ts's `forward` appends every child's stdout/stderr (the keeper's notes) to
# $WHY_DIR/forward.log, even with --json, which otherwise drops them.
git checkout -q -- src/cli/proof.ts
sed -i '1i import { appendFileSync as __a } from "node:fs";' src/cli/proof.ts
sed -i 's|    forward: (text) => (args.json ? undefined : io.stderr(text)),|    forward: (text) => { if (process.env.WHY_DIR) __a(`${process.env.WHY_DIR}/forward.log`, text); return args.json ? undefined : io.stderr(text); },|' src/cli/proof.ts
grep -c "__a(" src/cli/proof.ts
