// Throwaway probe for research/child-coverage.md. Not product code.
//
// Writes a small fixture project into <scratch>/fx: sources that tests reach
// only through child processes (a tsx child, a plain .mjs child spawned with
// an explicit env, an esbuild bundle with an inline map, a child the test
// kills with SIGKILL, a detached child that exits after its test file), two
// Vitest test files and one node:test file. Also writes the two prototype
// seams:
//   - provider-children.mjs: Squeal's provider.mjs wrapped so that each test
//     file's worker points NODE_V8_COVERAGE at a directory of its own
//     (startCoverage, and again after each takeCoverage);
//   - children.cjs: a node:test preload that, in the test file's process,
//     points NODE_V8_COVERAGE at <Squeal's dir>/children instead of letting
//     the recorder delete it.
//
// Usage: node fixture.mjs <squeal worktree> <scratch> <node_modules dir>

import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const [squeal, scratch, modules] = process.argv.slice(2);
const root = join(scratch, "fx");
rmSync(root, { recursive: true, force: true });
const provider = join(squeal, "src/core/code/coverage/provider.mjs");
const lines = (...l) => `${l.join("\n")}\n`;

const files = {
  "package.json": JSON.stringify({ name: "fx", private: true, type: "module" }),
  "vitest.config.ts": lines(
    `import { defineConfig } from "vitest/config";`,
    `export default defineConfig({ test: { include: ["test/**/*.test.ts"] } });`,
  ),
  // CC 3; x > 10 only from a.test.ts's tsx child
  "src/work.ts": lines(
    "export function work(x: number): number {",
    "  if (x > 10) return x * 2;",
    "  if (x > 5) return x + 1;",
    "  return 0;",
    "}",
    "export const unused = (x: number) => (x ? 1 : 0);",
  ),
  // CC 2; "big" from a.test.ts, "small" from b.test.ts
  "src/plain.mjs": lines(
    "export function plain(x) {",
    "  if (x > 1) return 'big';",
    "  return 'small';",
    "}",
  ),
  "src/lib.ts": lines(
    "export function lib(x: number): string {",
    "  return x > 0 ? 'pos' : 'neg';",
    "}",
  ),
  "src/killed.mjs": lines("export function killedFn() {", "  return 1;", "}"),
  "src/late.mjs": lines("export function lateFn() {", "  return 2;", "}"),
  "bin/run-ts.ts": lines(
    `import { work } from "../src/work.ts";`,
    "process.stdout.write(String(work(Number(process.argv[2]))));",
  ),
  "bin/run-plain.mjs": lines(
    `import { plain } from "../src/plain.mjs";`,
    "process.stdout.write(plain(Number(process.argv[2])));",
  ),
  "bin/run-lib.ts": lines(
    `import { lib } from "../src/lib.ts";`,
    "process.stdout.write(lib(Number(process.argv[2])));",
  ),
  "bin/hang.mjs": lines(
    `import { killedFn } from "../src/killed.mjs";`,
    "killedFn();",
    "process.stdout.write('up');",
    "setInterval(() => {}, 1000);",
  ),
  "bin/late.mjs": lines(
    `import { lateFn } from "../src/late.mjs";`,
    "lateFn();",
    "setTimeout(() => process.exit(0), 1500);",
  ),
  "test/a.test.ts": lines(
    `import { execFileSync, spawn } from "node:child_process";`,
    `import { appendFileSync } from "node:fs";`,
    `import { expect, it } from "vitest";`,
    `const log = (k: string, v: unknown) => appendFileSync(".probe/seen.ndjson", JSON.stringify({ file: "a", k, v, pid: process.pid }) + "\\n");`,
    `it("tsx child", () => {`,
    `  expect(execFileSync(process.execPath, ["--import", "tsx", "bin/run-ts.ts", "12"], { encoding: "utf8" })).toBe("24");`,
    `});`,
    `it("plain child with an explicit env", () => {`,
    `  expect(execFileSync(process.execPath, ["bin/run-plain.mjs", "3"], { encoding: "utf8", env: { PATH: process.env.PATH } })).toBe("big");`,
    `});`,
    `it("bundled child with an inline map", () => {`,
    `  expect(execFileSync(process.execPath, ["dist/cli.mjs", "1"], { encoding: "utf8" })).toBe("pos");`,
    `});`,
    `it("child killed by SIGKILL", async () => {`,
    `  const child = spawn(process.execPath, ["bin/hang.mjs"]);`,
    `  await new Promise((r) => child.stdout.once("data", r));`,
    `  child.kill("SIGKILL");`,
    `  await new Promise((r) => child.once("exit", r));`,
    `});`,
    `it("detached child that outlives the file", () => {`,
    `  spawn(process.execPath, ["bin/late.mjs"], { detached: true, stdio: "ignore" }).unref();`,
    `});`,
    `it("sees the variable", () => {`,
    `  log("NODE_V8_COVERAGE", process.env.NODE_V8_COVERAGE ?? null);`,
    `});`,
  ),
  "test/b.test.ts": lines(
    `import { execFileSync } from "node:child_process";`,
    `import { appendFileSync } from "node:fs";`,
    `import { expect, it } from "vitest";`,
    `it("plain child, other branch", () => {`,
    `  appendFileSync(".probe/seen.ndjson", JSON.stringify({ file: "b", k: "NODE_V8_COVERAGE", v: process.env.NODE_V8_COVERAGE ?? null, pid: process.pid }) + "\\n");`,
    `  expect(execFileSync(process.execPath, ["bin/run-plain.mjs", "0"], { encoding: "utf8" })).toBe("small");`,
    `});`,
  ),
  "test/n.test.mjs": lines(
    `import { execFileSync } from "node:child_process";`,
    `import assert from "node:assert/strict";`,
    `import { test } from "node:test";`,
    `test("node:test children", () => {`,
    `  assert.equal(execFileSync(process.execPath, ["bin/run-plain.mjs", "0"], { encoding: "utf8" }), "small");`,
    `  assert.equal(execFileSync(process.execPath, ["--import", "tsx", "bin/run-ts.ts", "7"], { encoding: "utf8" }), "8");`,
    `});`,
  ),
  // The Vitest seam: Squeal's provider, plus a children directory per test file.
  "provider-children.mjs": lines(
    `import base from ${JSON.stringify(provider)};`,
    `const { randomUUID } = process.getBuiltinModule("node:crypto");`,
    `const { appendFileSync, mkdirSync } = process.getBuiltinModule("node:fs");`,
    `const { join } = process.getBuiltinModule("node:path");`,
    `const OUT = process.env.PROBE_OUT;`,
    `function point() {`,
    `  const dir = join(OUT, "children", randomUUID());`,
    `  mkdirSync(dir, { recursive: true });`,
    `  process.env.NODE_V8_COVERAGE = dir;`,
    `}`,
    `export default {`,
    `  ...base,`,
    `  async startCoverage(options) {`,
    `    await base.startCoverage(options);`,
    `    point();`,
    `  },`,
    `  async takeCoverage(options) {`,
    `    const file = await base.takeCoverage(options);`,
    `    const testFile = globalThis.__vitest_worker__?.filepath ?? null;`,
    `    appendFileSync(join(OUT, "batches.ndjson"), JSON.stringify({ testFile, pid: process.pid, payload: file, children: process.env.NODE_V8_COVERAGE, at: Date.now() }) + "\\n");`,
    `    point();`,
    `    return file;`,
    `  },`,
    `};`,
  ),
  // The node:test seam: before Squeal's recorder deletes the variable.
  "children.cjs": lines(
    `"use strict";`,
    `const dir = process.env.NODE_TEST_CONTEXT && process.env.SQUEAL_NODE_TEST_COVERAGE;`,
    `if (dir && process.env.NODE_V8_COVERAGE === dir) {`,
    `  require("node:fs").mkdirSync(dir + "/children", { recursive: true });`,
    `  process.env.NODE_V8_COVERAGE = dir + "/children";`,
    `}`,
  ),
};
for (const [path, text] of Object.entries(files)) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}
mkdirSync(join(root, ".probe"), { recursive: true });
symlinkSync(modules, join(root, "node_modules"));
execFileSync(
  join(modules, ".bin/esbuild"),
  ["bin/run-lib.ts", "--bundle", "--platform=node", "--format=esm", "--sourcemap=inline", "--outfile=dist/cli.mjs"],
  { cwd: root, stdio: "inherit" },
);
execFileSync("git", ["init", "-q"], { cwd: root });
process.stdout.write(`${root}\n`);
