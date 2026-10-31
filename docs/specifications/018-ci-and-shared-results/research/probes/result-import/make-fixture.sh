#!/bin/sh
# Throwaway (topic result-import): builds a small Vitest fixture as a bare git origin.
set -eu
dir=$1
mkdir -p "$dir/src-tree"
cd "$dir/src-tree"
git init -q -b main
git config user.email probe@example.invalid
git config user.name probe
mkdir -p src test data
cat > package.json <<'J'
{ "name": "fixture", "private": true, "type": "module",
  "packageManager": "pnpm@12.15.0",
  "devDependencies": { "vitest": "5.0.3" },
  "dependencies": { "acorn": "8.19.0" } }
J
cat > vitest.config.ts <<'J'
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["test/**/*.test.ts"] } });
J
printf 'export const add = (a: number, b: number) => a + b;\n' > src/math.ts
printf 'import { parse } from "acorn";\nexport const nodes = (code: string) => parse(code, { ecmaVersion: 2022 }).body.length;\n' > src/parse.ts
printf 'hello\n' > data/input.txt
# 1: pure static closure
printf 'import { expect, test } from "vitest";\nimport { add } from "../src/math";\ntest("adds", () => expect(add(1, 2)).toBe(3));\n' > test/pure.test.ts
# 2: an installed package in the closure (per-package key segment)
printf 'import { expect, test } from "vitest";\nimport { nodes } from "../src/parse";\ntest("parses", () => expect(nodes("a; b;")).toBe(2));\n' > test/package.test.ts
# 3: a runtime file read (observed input)
printf 'import { readFileSync } from "node:fs";\nimport { expect, test } from "vitest";\ntest("reads", () => expect(readFileSync("data/input.txt", "utf8")).toBe("hello\\n"));\n' > test/fsread.test.ts
# 4: a snapshot file
printf 'import { expect, test } from "vitest";\nimport { add } from "../src/math";\ntest("snap", () => expect({ sum: add(2, 2) }).toMatchSnapshot());\n' > test/snap.test.ts
# 5: reads the .git entry (a directory in a clone, a file in a linked worktree)
printf 'import { statSync } from "node:fs";\nimport { expect, test } from "vitest";\ntest("git entry", () => expect(statSync(".git") !== undefined).toBe(true));\n' > test/gitentry.test.ts
# 6: depends on the machine through env and cwd, which no key holds
printf 'import { expect, test } from "vitest";\ntest("home", () => expect(typeof process.env.HOME).toBe("string"));\ntest("cwd", () => expect(process.cwd().length).toBeGreaterThan(0));\n' > test/machine.test.ts
# 7: a child process (opaque builtin: whole dependency fingerprint)
printf 'import { execFileSync } from "node:child_process";\nimport { expect, test } from "vitest";\ntest("child", () => expect(execFileSync(process.execPath, ["-e", "process.stdout.write(\\"1\\")"]).toString()).toBe("1"));\n' > test/child.test.ts
mkdir -p test/__snapshots__
printf '// Vitest Snapshot v1, https://vitest.dev/guide/snapshot.html\n\nexports[`snap 1`] = `\n{\n  "sum": 4,\n}\n`;\n' > test/__snapshots__/snap.test.ts.snap
printf 'node_modules\n' > .gitignore
pnpm install --offline --lockfile-only --silent
git add -A
git commit -qm "fixture"
cd "$dir"
git clone -q --bare src-tree origin.git
echo "$dir/origin.git"
