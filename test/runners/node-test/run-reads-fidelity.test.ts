import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { NodeTestProject } from "../../../src/core/types/index.js";
import { runNodeTest } from "../../../src/runners/node-test/run/run.js";

/*
 * Task 001-390, spec 001 D11 Fidelity: the cezar-shaped case in its own runner.
 * cezar's `scripts/test-changed.test.mjs` is a node:test file that writes a
 * `package.json` that is not JSON into a temp directory and runs Node there. A
 * warm-up (`observeIgnored`, task 001-307) puts 001-132's recorder in every
 * process; as a `--require` it made that child die with ERR_INVALID_PACKAGE_CONFIG.
 */

const FIXTURES = resolve(import.meta.dirname, "../../fixtures/node-test");
const scratch = join(FIXTURES, ".tmp", randomUUID());
const logs = mkdtempSync(join(tmpdir(), "squeal-node-test-reads-fidelity-"));
beforeAll(() => {
  for (const [path, text] of Object.entries(FILES)) {
    mkdirSync(dirname(join(scratch, path)), { recursive: true });
    writeFileSync(join(scratch, path), text);
  }
});
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
  rmSync(logs, { recursive: true, force: true });
});

const FILES: Readonly<Record<string, string>> = {
  "package.json": `${JSON.stringify({ name: "reads-fidelity", private: true })}\n`,
  "scripts/child.cjs":
    'process.stdout.write(require("node:fs").readFileSync(__dirname + "/../data/child.txt", "utf8"));\n',
  "data/child.txt": "child",
  "scripts/old-node.sh": `case "$NODE_OPTIONS" in *--import*) echo "$0: --import is not allowed in NODE_OPTIONS" >&2; exit 9;; esac\n`,
  "test/old.test.mjs": `import { execFileSync } from "node:child_process";
import { test } from "node:test";
test("runs an old Node", () => {
  execFileSync("/bin/sh", [new URL("../scripts/old-node.sh", import.meta.url).pathname], { stdio: "pipe" });
});
`,
  "test/a.test.mjs": `import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
test("runs Node where the nearest package.json is not JSON", () => {
  const dir = mkdtempSync(join(tmpdir(), "bad-package-"));
  writeFileSync(join(dir, "package.json"), "export const value = 1;\\n");
  const child = new URL("../scripts/child.cjs", import.meta.url).pathname;
  const run = (env) => spawnSync(process.execPath, [child], { cwd: dir, env, encoding: "utf8" });
  const inherit = run({ ...process.env });
  const empty = run({});
  assert.deepEqual([inherit.status, inherit.stderr, inherit.stdout], [0, "", "child"]);
  assert.deepEqual([empty.status, empty.stderr, empty.stdout], [0, "", "child"]);
});
`,
};

describe("a node:test warm-up's recorder a test cannot tell is there (task 001-390)", () => {
  it("passes the cezar-shaped case, records the child's read, and keys as without it", {
    timeout: 60_000,
  }, async () => {
    const project: NodeTestProject = {
      name: "p",
      node: process.execPath,
      argv: [],
      env: {},
      include: ["test/*.test.mjs"],
    };
    const testFile = { project: "p", path: "test/a.test.mjs" };
    const { report, observed, reads } = await runNodeTest({
      root: realpathSync(scratch),
      project,
      files: [testFile],
      logDir: join(logs, randomUUID()),
      timeoutMs: 30_000,
      observeIgnored: true,
    });

    expect(report.results.map((r) => [r.outcome, r.errors[0]?.message])).toEqual([
      ["pass", undefined],
    ]);
    expect(reads?.[0]?.paths).toEqual(
      expect.arrayContaining(["data/child.txt", "scripts/child.cjs"]),
    );
    expect(observed).toEqual([
      { testFile, paths: ["test/a.test.mjs"], preloadPaths: [], direct: [], written: [] },
    ]);
  });

  it("names the recorder in a failure with its signature while it is in NODE_OPTIONS", {
    timeout: 60_000,
  }, async () => {
    const project: NodeTestProject = {
      name: "p",
      node: process.execPath,
      argv: [],
      env: {},
      include: ["test/*.test.mjs"],
    };
    const testFile = { project: "p", path: "test/old.test.mjs" };
    const run = async (observeIgnored: boolean) => {
      const { report } = await runNodeTest({
        root: realpathSync(scratch),
        project,
        files: [testFile],
        logDir: join(logs, randomUUID()),
        timeoutMs: 30_000,
        observeIgnored,
      });
      return report.results.map((r) => [r.outcome, r.errors[0]?.recorder]);
    };
    expect(await run(true)).toEqual([["fail", "Node before 18.18 rejects its --import"]]);
    // the module recorder in argv reaches no child: the old Node starts
    expect(await run(false)).toEqual([["pass", undefined]]);
  });
});
