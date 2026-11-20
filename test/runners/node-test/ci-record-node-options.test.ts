import { describe, expect, it } from "vitest";
import { exportParts, project, record, reporterPair, withoutNodeOptions } from "./ci-record-kit.js";

/*
 * Review of 0.1.579 B1 (spec 018 D25, D26.1): Node reads `NODE_OPTIONS`
 * before its argv, so a flag there shapes the run as one in `execArgv`
 * does. A refused flag from `NODE_OPTIONS`, inherited by `ci record` or set
 * inside `sh -c`, records no file of that process, and the export of the
 * unfiltered entry holds no pass of the file it filtered; a valid process
 * beside it in the same command still exports. Any other flag there must
 * equal what the entry's processes get here, or its files are left out.
 */

const SLOW = { timeout: 120_000 } as const;
const FILES = {
  "squeal.config.json": `${JSON.stringify({
    nodeTest: [
      { name: "unit", include: ["a.test.mjs"] },
      { name: "other", include: ["b.test.mjs"] },
    ],
  })}\n`,
  "a.test.mjs": [
    'import { test } from "node:test";',
    'import assert from "node:assert/strict";',
    'test("passing", () => {});',
    'test("failing", () => assert.fail("must fail without filter"));',
    "",
  ].join("\n"),
  "b.test.mjs": 'import { test } from "node:test";\ntest("b", () => {});\n',
};

const quote = (args: readonly string[]) => args.map((a) => `'${a}'`).join(" ");
const nodeTest = (file: string) => quote([process.execPath, "--test", ...reporterPair(), file]);

describe("NODE_OPTIONS of a recorded node:test run (review of 0.1.579 B1)", () => {
  it(
    "refuses a name filter ci record inherits, and exports no pass of the file",
    SLOW,
    async () => {
      const root = project(FILES);
      const env = { ...withoutNodeOptions(), NODE_OPTIONS: "--test-name-pattern=passing" };
      const command = [process.execPath, "--test", ...reporterPair(), "a.test.mjs"];
      const recorded = await record(root, command, env);
      expect(recorded.code, recorded.stderr).toBe(0);
      expect(recorded.stderr).toContain("--test-name-pattern from NODE_OPTIONS");
      expect(recorded.parts.flatMap((p) => p.testFiles)).toEqual([]);
      const exported = await exportParts(root, recorded.out, withoutNodeOptions());
      expect(exported.stdout).not.toContain("Exported");
      expect(exported.stderr).toContain("--test-name-pattern from NODE_OPTIONS");
    },
  );

  it(
    "refuses a name filter set inside sh -c and keeps the valid process beside it",
    SLOW,
    async () => {
      const root = project(FILES);
      const filtered = `NODE_OPTIONS="$NODE_OPTIONS --test-name-pattern=passing" ${nodeTest("a.test.mjs")}`;
      const command = ["sh", "-c", `${filtered} && ${nodeTest("b.test.mjs")}`];
      const recorded = await record(root, command, withoutNodeOptions());
      expect(recorded.code, recorded.stderr).toBe(0);
      const files = recorded.parts.flatMap((p) => p.testFiles.map((f) => f.path));
      expect(files).toEqual(["b.test.mjs"]);
      const exported = await exportParts(root, recorded.out, withoutNodeOptions());
      expect(exported.code, exported.stderr).toBe(0);
      expect(exported.stdout).toContain("Exported 1 test file, 2 results");
    },
  );

  it("matches other NODE_OPTIONS flags to what the entry gets here", SLOW, async () => {
    const root = project(FILES);
    const options = { ...withoutNodeOptions(), NODE_OPTIONS: "--conditions=ci" };
    const command = [process.execPath, "--test", ...reporterPair(), "b.test.mjs"];
    const recorded = await record(root, command, options);
    expect(recorded.code, recorded.stderr).toBe(0);
    expect(recorded.parts[0]?.header.nodeTest?.nodeOptions).toEqual(["--conditions=ci"]);
    const without = await exportParts(root, recorded.out, withoutNodeOptions());
    expect(without.stdout).not.toContain("Exported");
    expect(without.stderr).toContain('flags ["--conditions=ci"], NODE_OPTIONS first');
    const same = await exportParts(root, recorded.out, options);
    expect(same.code, same.stderr).toBe(0);
    expect(same.stdout).toContain("Exported 1 test file, 2 results");
  });
});
