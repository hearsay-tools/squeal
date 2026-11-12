// Throwaway (row 020-41): a git repository shaped like #196.
// node fixture.mjs <dir> <slowSeconds> <edited: a,b,c> <node_modules>
// - node:test entry "slow": test/n1/slow.test.mjs (sleeps <slowSeconds>) and three quick files, all load src/a.mjs.
// - node:test entry "quick": two quick files that load src/c.mjs.
// - Vitest: eight files that load src/b.ts, 1 s each.
// Base commit on "main", then the working tree edits one function in each named source.
import { execFileSync } from "node:child_process";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const [dir, slowArg, editedArg, modules] = process.argv.slice(2);
const slow = Number(slowArg);
const edited = new Set(editedArg.split(","));
const files = {
  "package.json": `${JSON.stringify({ name: "gate-budget", private: true, type: "module" })}\n`,
  ".gitignore": "node_modules\n",
  "vitest.config.ts": `import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { include: ["test/v/*.test.ts"] } });\n`,
  "squeal.config.json": `${JSON.stringify({
    nodeTest: [
      { name: "slow", include: ["test/n1/*.test.mjs"] },
      { name: "quick", include: ["test/n2/*.test.mjs"] },
    ],
  })}\n`,
  "src/a.mjs": "export function a(x) {\n  return x + 1;\n}\n",
  "src/b.ts": "export function b(x: number): number {\n  return x + 2;\n}\n",
  "src/c.mjs": "export function c(x) {\n  return x + 3;\n}\n",
  "test/n1/slow.test.mjs": `import { test } from "node:test";\nimport assert from "node:assert";\nimport { setTimeout as sleep } from "node:timers/promises";\nimport { a } from "../../src/a.mjs";\ntest("slow", async () => { await sleep(${slow * 1000}); assert.equal(a(1), 2); });\n`,
};
for (const i of [1, 2, 3]) {
  files[`test/n1/q${i}.test.mjs`] =
    `import { test } from "node:test";\nimport assert from "node:assert";\nimport { a } from "../../src/a.mjs";\ntest("q${i}", () => assert.equal(a(1), 2));\n`;
}
for (const i of [1, 2]) {
  files[`test/n2/c${i}.test.mjs`] =
    `import { test } from "node:test";\nimport assert from "node:assert";\nimport { c } from "../../src/c.mjs";\ntest("c${i}", () => assert.equal(c(1), 4));\n`;
}
for (const i of [1, 2, 3, 4, 5, 6, 7, 8]) {
  files[`test/v/b${i}.test.ts`] =
    `import { expect, it } from "vitest";\nimport { b } from "../../src/b";\nit("b${i}", async () => { await new Promise((r) => setTimeout(r, 1000)); expect(b(1)).toBe(3); });\n`;
}
const write = (path, text) => {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), text);
};
for (const [path, text] of Object.entries(files)) write(path, text);
symlinkSync(modules, join(dir, "node_modules"));
const git = (...args) => execFileSync("git", args, { cwd: dir, stdio: "pipe" });
git("init", "-q", "-b", "main");
git("-c", "user.email=p@example.invalid", "-c", "user.name=probe", "add", "-A");
git("-c", "user.email=p@example.invalid", "-c", "user.name=probe", "commit", "-qm", "base");
// The edit: each named source gains a branch, so its one function changes.
if (edited.has("a")) write("src/a.mjs", "export function a(x) {\n  if (x < 0) return 0;\n  return x + 1;\n}\n");
if (edited.has("b")) write("src/b.ts", "export function b(x: number): number {\n  if (x < 0) return 0;\n  return x + 2;\n}\n");
if (edited.has("c")) write("src/c.mjs", "export function c(x) {\n  if (x < 0) return 0;\n  return x + 3;\n}\n");
