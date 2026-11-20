import { describe, expect, it } from "vitest";
import { exportParts, project, record, reporterPair, withoutNodeOptions } from "./ci-record-kit.js";

/*
 * Review of 0.1.579 B4 (spec 018 D23.2, D26): two `nodeTest` entries with
 * one `cwd` and one `argv` and their own test files. A recorded command
 * that runs each entry's files in its own `node --test` process, or both in
 * one, exports every file: a process that ran only another entry's files is
 * no shard of this one.
 */

const SLOW = { timeout: 120_000 } as const;
const FILES = {
  "squeal.config.json": `${JSON.stringify({
    nodeTest: [
      { name: "alpha", include: ["nt/a.test.mjs"] },
      { name: "beta", include: ["nt/b.test.cjs"] },
    ],
  })}\n`,
  "nt/a.test.mjs": 'import { test } from "node:test";\ntest("a", () => {});\n',
  "nt/b.test.cjs": 'const { test } = require("node:test");\ntest("b", () => {});\n',
};

const quote = (args: readonly string[]) => args.map((a) => `'${a}'`).join(" ");
const nodeTest = (...files: string[]) =>
  quote([process.execPath, "--test", ...reporterPair(), ...files]);

describe("entries of one shape in one recorded command (review of 0.1.579 B4)", () => {
  it.each([
    ["apart", `${nodeTest("nt/a.test.mjs")} && ${nodeTest("nt/b.test.cjs")}`, 2],
    ["together", nodeTest("nt/a.test.mjs", "nt/b.test.cjs"), 1],
  ])("exports both entries' files (%s)", SLOW, async (_, command, processes) => {
    const root = project(FILES);
    const env = withoutNodeOptions();
    const recorded = await record(root, ["sh", "-c", command], env);
    expect(recorded.code, recorded.stderr).toBe(0);
    expect(recorded.parts).toHaveLength(processes);
    const exported = await exportParts(root, recorded.out, env);
    expect(exported.code, exported.stderr).toBe(0);
    expect(exported.stderr).not.toContain("left out");
    expect(exported.stdout).toContain("Exported 2 test files, 4 results");
  });
});
