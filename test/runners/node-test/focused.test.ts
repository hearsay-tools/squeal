import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  AbsolutePath,
  FocusedFile,
  NodeTestProject,
  RunnerAdapter,
  RunReport,
} from "../../../src/core/types/index.js";
import { createNodeTestAdapter } from "../../../src/runners/node-test/adapter.js";

/*
 * Row 011-135 R1 (spec 011 C14, 003 D5): a run given texts for a file adds
 * `--test-name-pattern` before it, under the Node running this suite, and
 * reports only the checks whose full name holds a text. Node hides the
 * checks the pattern leaves out, and reports a file it selects nothing in
 * as one passing test, which is never a result.
 */

const SLOW = { timeout: 60_000 } as const;

const FOUR = [
  'import assert from "node:assert/strict";',
  'import { describe, it, test } from "node:test";',
  'describe("parity", () => {',
  '  it("old 1", () => {});',
  '  it("new 1", () => assert.equal(1, 2));',
  '  describe("inner", () => {',
  '    it("new 2", () => {});',
  "  });",
  "});",
  'test("new 3 top", () => {});',
  "",
].join("\n");

/** Node's pattern for `a > b` also matches a test named `a b`; that check holds no text. */
const JOIN = [
  'import { describe, it, test } from "node:test";',
  'describe("a", () => it("b", () => {}));',
  'test("a b", () => {});',
  'test("outer", async (t) => {',
  '  await t.test("sub", () => {});',
  "});",
  "",
].join("\n");

let root = "" as AbsolutePath;
let logs = "";
let adapter: RunnerAdapter;
beforeAll(async () => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "squeal-node-test-focused-"))) as AbsolutePath;
  logs = join(root, ".logs");
  mkdirSync(join(root, "test"));
  writeFileSync(join(root, "test/four.test.mjs"), FOUR);
  writeFileSync(join(root, "test/broken.test.mjs"), `throw new Error("cannot load");\n${FOUR}`);
  writeFileSync(join(root, "test/join.test.mjs"), JOIN);
  writeFileSync(
    join(root, "test/other.test.mjs"),
    'import { test } from "node:test";\ntest("other", () => {});\n',
  );
  const project: NodeTestProject = {
    name: "unit",
    cwd: "",
    node: process.execPath,
    argv: [],
    env: {},
    include: ["test/*.test.mjs"],
  };
  adapter = await createNodeTestAdapter(project, { root });
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

const ref = (name: string) => ({ project: "unit", path: `test/${name}.test.mjs` });
const FILE = ref("four");
let runs = 0;
const run = (names: string[], checks?: FocusedFile[]) =>
  adapter.run(names.map(ref), {
    runId: "r",
    logDir: join(logs, String(runs++)) as AbsolutePath,
    timeoutMs: 30_000,
    ...(checks === undefined ? {} : { checks }),
  });
const checks = (report: RunReport) => report.results.map((r) => [r.check.fullName, r.outcome]);

describe("node:test adapter: focused runs", SLOW, () => {
  it("runs and reports only the checks a text selects, the red one with its error", async () => {
    expect(adapter.focuses).toBe(true);
    const report = await run(["four"], [{ testFile: FILE, texts: ["new"] }]);

    expect(report.end).toBe("completed");
    expect(report.completedFiles).toEqual([FILE]);
    expect(checks(report)).toEqual([
      ["parity > new 1", "fail"],
      ["parity > inner > new 2", "pass"],
      ["new 3 top", "pass"],
    ]);
    expect(report.results[0]?.errors[0]?.message).toContain("1 !== 2");
    expect(report.fileErrors).toEqual([]);
    expect(report.focused).toEqual([{ testFile: FILE, collected: null, matched: 3 }]);
  });

  it("selects with a text holding ` > `, a suite's name included", async () => {
    const nested = await run(["four"], [{ testFile: FILE, texts: ["parity > inner > new"] }]);
    expect(checks(nested)).toEqual([["parity > inner > new 2", "pass"]]);

    // Node runs a whole suite whose name matches; each of its checks holds the text.
    const suite = await run(["four"], [{ testFile: FILE, texts: ["parity > inner", "3 top"] }]);
    expect(checks(suite)).toEqual([
      ["parity > inner > new 2", "pass"],
      ["new 3 top", "pass"],
    ]);
  });

  it("drops a check the pattern lets through that holds no text", async () => {
    const join = ref("join");
    const report = await run(["join"], [{ testFile: join, texts: ["a > b"] }]);
    expect(checks(report)).toEqual([["a > b", "pass"]]);
    expect(report.focused).toEqual([{ testFile: join, collected: null, matched: 1 }]);

    // Node filters a test before it runs, so a subtest is selected through its parent's name only.
    const parent = await run(["join"], [{ testFile: join, texts: ["outer"] }]);
    expect(checks(parent)).toEqual([
      ["outer > sub", "pass"],
      ["outer", "pass"],
    ]);
    const sub = await run(["join"], [{ testFile: join, texts: ["outer > sub"] }]);
    expect(sub.results).toEqual([]);
    expect(sub.focused).toEqual([{ testFile: join, collected: null, matched: 0 }]);
  });

  it("reports matched 0 and no result for a text that selects nothing, never a pass", async () => {
    const report = await run(["four"], [{ testFile: FILE, texts: ["no such check"] }]);

    expect(report.completedFiles).toEqual([FILE]);
    expect(report.results).toEqual([]);
    expect(report.fileErrors).toEqual([]);
    expect(report.focused).toEqual([{ testFile: FILE, collected: null, matched: 0 }]);
  });

  it("reports the file-level error of a file that does not load", async () => {
    const broken = ref("broken");
    const report = await run(["broken"], [{ testFile: broken, texts: ["new"] }]);

    expect(report.completedFiles).toEqual([broken]);
    expect(report.results).toEqual([]);
    expect(report.fileErrors.map((e) => e.testFile)).toEqual([broken]);
    expect(report.fileErrors[0]?.errors.map((e) => e.message).join("\n")).toContain("cannot load");
    expect(report.focused).toEqual([{ testFile: broken, collected: null, matched: 0 }]);
  });

  it("runs a file without texts whole, beside a focused file", async () => {
    const report = await run(["four", "other"], [{ testFile: FILE, texts: ["old 1"] }]);

    expect(report.completedFiles).toEqual([FILE, ref("other")]);
    expect(checks(report)).toEqual([
      ["parity > old 1", "pass"],
      ["other", "pass"],
    ]);
    expect(report.focused).toEqual([{ testFile: FILE, collected: null, matched: 1 }]);

    const whole = await run(["four"]);
    expect(checks(whole)).toEqual([
      ["parity > old 1", "pass"],
      ["parity > new 1", "fail"],
      ["parity > inner > new 2", "pass"],
      ["new 3 top", "pass"],
    ]);
    expect(whole.focused).toBeUndefined();
  });
});
