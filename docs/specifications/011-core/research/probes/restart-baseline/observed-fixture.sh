#!/bin/sh
# E8 setup: a test whose reads depend on an untracked file, and a second git worktree of the fixture.
set -e
X=${X:-$TMPDIR/rb/x}; cd $X/fx
mkdir -p data
printf 'import { existsSync, readFileSync } from "node:fs";\nexport const r = () => (existsSync("flag") ? readFileSync("data/extra.json", "utf8").trim() : "none");\n' > src/r.ts
printf 'import { test, expect } from "vitest";\nimport { r } from "../src/r.js";\ntest("r", () => { expect(typeof r()).toBe("string"); });\n' > test/r.test.ts
echo '{"extra":1}' > data/extra.json
git add -A && git commit -qm "r reads data/extra.json when flag exists"
git worktree add -q $X/fxb
ln -s "$(readlink node_modules)" $X/fxb/node_modules
