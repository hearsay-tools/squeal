import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { RunLog } from "../../../src/core/code/gate/evidence.js";
import type { AbsolutePath } from "../../../src/core/types/common.js";
import { changedSet, collect, judged, project, SLOW } from "./collect-fixture.js";

/*
 * #197 (row 020-40): the report has one `runs` entry per runner kind, and
 * node:test has one run per project. So the collector offers the keeper
 * one log per kind, holding the folder of each run with a failed or
 * unfinished file, while those folders still exist.
 */

const E2E = "test/e2e/bin.test.mjs";
const UNIT = "test/unit/names.test.mjs";

describe("collectEvidence: the kept log of two node:test projects (#197)", () => {
  it("offers both failed projects' log folders as one, and the report names it", SLOW, async () => {
    const root = project("prepare");
    // `unit` fails its assertion; `package` runs with no build, so its binary is missing.
    writeFileSync(
      join(root, UNIT),
      'import test from "node:test";\nimport assert from "node:assert/strict";\n\ntest("label", () => assert.equal(1, 2));\n',
    );
    const changed = await changedSet(root, [E2E, UNIT]);
    const given: { run: RunLog; folders: string[][] }[] = [];
    const keepLog = async (run: RunLog) => {
      const folders = run.logDirs.map((dir) => readdirSync(join(dir, "node-test")));
      given.push({ run, folders });
      return "/store/runs/gate-1" as AbsolutePath;
    };

    const { evidence } = await collect(root, changed, {
      prepares: new Map([["package", { command: [process.execPath, "-e", ""] }]]),
      keepLog,
    });

    expect(evidence.testFiles.map((f) => [f.path, f.completed, f.failed.length > 0])).toEqual([
      [E2E, true, true],
      [UNIT, true, true],
    ]);
    // One call for the kind, with each project's folder, present when it was called.
    expect(given.map(({ run }) => [run.runner, run.files.map((f) => f.path).sort()])).toEqual([
      ["node-test", [E2E, UNIT]],
    ]);
    expect(given[0]?.folders.flat().sort()).toEqual(["package", "unit"]);
    expect(evidence.logs).toEqual([{ runner: "node-test", path: "/store/runs/gate-1" }]);
    const { report } = await judged(root, changed, evidence);
    // The fixture's Vitest selects nothing, so it keeps nothing.
    expect(report.runs.map((r) => [r.runner, r.selected.length, r.log])).toEqual([
      ["vitest", 0, undefined],
      ["node-test", 2, "/store/runs/gate-1"],
    ]);
  });
});
