import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { codeCommand } from "../../src/cli/code.js";
import type { GateReport } from "../../src/core/code/gate/report.js";
import { initRepo, writeFile } from "../hash/git-repo.js";
import { ownHomeAndTmp } from "./code-gate-fixture.js";

/*
 * Review 0.1.433 B2 (spec 020 D17.3): with two node:test entries, every
 * entry's lookup runs before any run (D14.4), so the keeper holds what
 * each entry is about to run at once. Each completion keeps its own
 * entry's files: the second run on the same bytes reads both entries'
 * files from the stores and runs none. When one entry's file is found and
 * the other's runs, the one that runs is kept too.
 */

const SLOW = { timeout: 240_000 } as const;

const SCRATCH = resolve(import.meta.dirname, "../fixtures/code/gate/.tmp");

const A = "test/a.test.mjs";
const B = "test/b.test.mjs";

const testOf = (title: string) =>
  `import test from "node:test";\nimport assert from "node:assert/strict";\nimport { double } from "../src/math.mjs";\n\ntest(${JSON.stringify(title)}, () => assert.equal(double(2), 4));\n`;

const BASE: Readonly<Record<string, string>> = {
  "package.json": `${JSON.stringify({ name: "gate-keep-node-test", private: true, type: "module" })}\n`,
  "squeal.config.json": `${JSON.stringify({
    complexity: { enabled: true },
    coverage: { enabled: true },
    nodeTest: [
      { name: "a", include: [A] },
      { name: "b", include: [B] },
    ],
  })}\n`,
  "src/math.mjs": "export function double(x) {\n  return x * 2;\n}\n",
  [A]: testOf("a doubles"),
  [B]: testOf("b doubles"),
};

/** `squeal code --base main --json` in `root`. */
async function gate(root: string) {
  let stdout = "";
  let stderr = "";
  const io = {
    stdout: (text: string) => {
      stdout += text;
    },
    stderr: (text: string) => {
      stderr += text;
    },
    cwd: root,
    env: {},
  };
  const code = await codeCommand(["--base", "main", "--json"], io);
  const report = JSON.parse(stdout) as GateReport;
  const [run] = report.runs;
  return { code, stderr, runner: run?.runner, completed: run?.completed, from: run?.from };
}

describe("squeal code --base keeps each node:test entry's files (review 0.1.433 B2)", () => {
  let root: string;

  beforeAll(() => {
    mkdirSync(SCRATCH, { recursive: true });
    root = join(SCRATCH, `keep-node-test-${randomUUID()}`);
    initRepo(root, BASE);
    writeFile(root, "src/math.mjs", "export function double(x) {\n  return x + x;\n}\n");
  });

  afterAll(() => {
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  });

  it("keeps both entries' files, and the next run reads both from the stores", SLOW, async () => {
    ownHomeAndTmp();

    const first = await gate(root);
    expect([first.code, first.runner, first.completed, first.from]).toEqual([
      0,
      "node-test",
      [A, B],
      undefined,
    ]);

    const second = await gate(root);
    expect([second.code, second.completed, second.from]).toEqual([
      0,
      [A, B],
      { [A]: "store", [B]: "store" },
    ]);
    expect(second.stderr).toContain(
      "squeal code: 2 of 2 selected test files read from the stores\n",
    );
  });

  it("keeps the file that runs while the other entry's file is found", SLOW, async () => {
    ownHomeAndTmp();
    writeFile(root, B, testOf("b doubles again"));

    const mixed = await gate(root);
    expect([mixed.code, mixed.completed, mixed.from]).toEqual([
      0,
      [A, B],
      { [A]: "store", [B]: "run" },
    ]);

    const after = await gate(root);
    expect([after.code, after.from]).toEqual([0, { [A]: "store", [B]: "store" }]);
  });
});
