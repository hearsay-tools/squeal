import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { BasePrepares } from "../../../src/core/code/gate/prepare.js";
import { changedSet, collect, judged, project, SLOW, scopeOf, status } from "./collect-fixture.js";

/*
 * Spec 020 D14.2 with D15.3 (row 020-15a+16b I): the fixture of
 * `collect-prepare.test.ts`, with its node:test entry `package`, whose
 * `prepare` builds `dist/`, owned by a `manual` group `e2e`. Left out by the
 * scope, its file does not run, so its `prepare` does not run either: a
 * `prepare` runs only for selected files in scope. `--group e2e` runs both.
 */

const E2E = "test/e2e/bin.test.mjs";
const UNIT = "test/unit/names.test.mjs";
const BASE: BasePrepares = new Map([["package", { command: ["node", "scripts/build.mjs"] }]]);

/** The group `e2e`: `manual`, entry `package`. */
const E2E_GROUP = [{ name: "e2e", at: "manual", runner: "nodeTest", project: "package" } as const];

describe("collectEvidence: a prepare and the scope by check group (spec 020 D14.2, D15.3)", () => {
  it(
    "does not run the prepare of an entry whose selected file the scope left out",
    SLOW,
    async () => {
      const root = project("prepare");
      const changed = await changedSet(root, ["src/names.mjs"]);
      const scope = scopeOf(root, [], E2E_GROUP);
      const { evidence, notes, output } = await collect(root, changed, { prepares: BASE, scope });
      expect(notes).toEqual([]);
      expect(output).toBe("");
      expect(evidence.prepares).toBeUndefined();
      expect(evidence.testFiles.map((f) => [f.path, f.completed, f.notPrepared])).toEqual([
        [UNIT, true, undefined],
      ]);
      expect(evidence.scope?.leftOut).toEqual([
        { name: "e2e", at: "manual", files: 1, selected: 1, add: "--group e2e" },
      ]);
      const [file] = evidence.scope?.files ?? [];
      expect(file).toMatchObject({ runner: "node-test", path: E2E, group: "e2e" });
      expect(file?.loads).toContain("src/names.mjs");
      // The left-out loader is listed, never `not-prepared`.
      const { report, states } = await judged(root, changed, evidence);
      expect(states).toEqual([["label", "pass", null]]);
      expect(report.functions[0]?.loaders).toEqual({
        expected: [UNIT],
        measured: [UNIT],
        leftOut: [E2E],
      });
      expect(report.runs.find((r) => r.runner === "node-test")?.prepare).toBeUndefined();
      // Nothing built: Squeal and the prepare wrote nothing.
      expect(existsSync(join(root, "dist"))).toBe(false);
      expect(status(root)).toBe("");
    },
  );

  it("runs it before the entry's file when --group puts the group in scope", SLOW, async () => {
    const root = project("prepare");
    const changed = await changedSet(root, ["src/names.mjs"]);
    const scope = scopeOf(root, ["e2e"], E2E_GROUP);
    const { evidence, notes } = await collect(root, changed, { prepares: BASE, scope });
    expect(notes).toEqual(['node:test entry "package": prepare: node scripts/build.mjs']);
    expect(evidence.prepares?.map((p) => [p.project, p.outcome, p.notRun])).toEqual([
      ["package", "passed", []],
    ]);
    expect(evidence.testFiles.map((f) => [f.path, f.completed, f.failed])).toEqual([
      [E2E, true, []],
      [UNIT, true, []],
    ]);
    expect(evidence.scope?.files).toEqual([]);
    expect(status(root)).toBe("!! dist/stamp.json\n!! dist/tool.mjs\n");
  });
});
