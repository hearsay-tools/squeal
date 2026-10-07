#!/usr/bin/env bash
# Throwaway: a scratch Vitest repository under /tmp/p16/<name>, committed, with
# squeal.config.json from the installed plugin's `squeal init --harness codex`.
set -e; d="/tmp/p16/$1"; rm -rf "$d"; mkdir -p "$d"; cd "$d"
git init -q
# A real copy: a symlinked node_modules stops the daemon at start (lessons, defect 1).
cp -a /tmp/p16/nm/node_modules node_modules
printf 'node_modules\n' > .gitignore
printf '{ "name": "scratch", "type": "module", "private": true, "scripts": { "test": "vitest run" } }\n' > package.json
mkdir -p src test
printf 'export const add = (a, b) => a + b;\nexport const mul = (a, b) => a * b;\n' > src/math.js
printf 'export const greet = (name) => `hello ${name}`;\n' > src/greet.js
cat > test/math.test.js <<'T'
import { expect, test } from "vitest";
import { add, mul } from "../src/math.js";
test("add sums", () => { expect(add(2, 3)).toBe(5); });
test("mul multiplies", () => { expect(mul(2, 3)).toBe(6); });
T
cat > test/greet.test.js <<'T'
import { expect, test } from "vitest";
import { greet } from "../src/greet.js";
test("greet says hello", () => { expect(greet("ada")).toBe("hello ada"); });
T
printf '# scratch\n' > README.md
squeal init --harness codex > /tmp/p16/logs/init-$1.txt
git add -A; git commit -qm init
echo "$d"
