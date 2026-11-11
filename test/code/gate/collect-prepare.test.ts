import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadBasePolicy } from "../../../src/core/code/gate/policy.js";
import type { BasePrepares } from "../../../src/core/code/gate/prepare.js";
import type { GateAdapters } from "../../../src/core/code/gate/runners.js";
import type { AbsolutePath } from "../../../src/core/types/common.js";
import {
  ADAPTERS,
  changedSet,
  collect,
  judged,
  onRun,
  ownTmpdir,
  project,
  SLOW,
  status,
} from "./collect-fixture.js";

/*
 * Spec 020 D15 (row 020-16b), from the probe of research `build-wrapper.md`
 * (`probes/build-wrapper/fixture`): `test/e2e/bin.test.mjs` holds a helper,
 * `verify()`, that starts the built `dist/tool.mjs`. Its node:test entry,
 * `package`, declares `prepare: node scripts/build.mjs`; the entry `unit`
 * has none. The gate runs the base's `prepare` once before the entry's
 * files, inside the budget, and its success is never evidence.
 */

const E2E = "test/e2e/bin.test.mjs";
const UNIT = "test/unit/names.test.mjs";

const prepares = (command: readonly string[], timeoutSeconds?: number): BasePrepares =>
  new Map([["package", { command, ...(timeoutSeconds === undefined ? {} : { timeoutSeconds }) }]]);
const node = (script: string) => [process.execPath, "-e", script];

describe("collectEvidence: a node:test entry's prepare (spec 020 D15)", () => {
  it(
    "runs the base's prepare first, so the helper behind the build is measured and passes",
    SLOW,
    async () => {
      const leftInTmp = ownTmpdir();
      const root = project("prepare");
      const changed = await changedSet(root, [E2E]);
      const { policy } = await loadBasePolicy(root as AbsolutePath, changed.baseCommit);
      const base = prepares(["node", "scripts/build.mjs"]);
      expect(policy.prepares).toEqual(base);
      const stored: string[] = [];
      const { evidence, notes } = await collect(root, changed, {
        prepares: base,
        // D15: an entry with a prepare takes no stored evidence.
        stored: async (runner) => {
          stored.push(runner);
          return new Map();
        },
      });
      expect(stored).toEqual([]);
      expect(notes).toEqual(['node:test entry "package": prepare: node scripts/build.mjs']);
      expect(evidence.timedOut).toBe(false);
      expect(evidence.prepares).toEqual([
        {
          project: "package",
          command: ["node", "scripts/build.mjs"],
          outcome: "passed",
          exit: 0,
          durationMs: expect.any(Number),
          notRun: [],
        },
      ]);
      expect(evidence.testFiles.map((f) => [f.path, f.completed, f.failed, f.notPrepared])).toEqual(
        [[E2E, true, [], undefined]],
      );
      const { report, states } = await judged(root, changed, evidence);
      expect(states).toEqual([
        ["verify", "pass", null],
        ["<test>", "pass", null],
      ]);
      expect(report.functions[0]?.loaders).toEqual({ expected: [E2E], measured: [E2E] });
      expect(report.verdict).toBe("pass");
      // D15.5: Squeal wrote nothing; the build wrote dist/, which the project ignores.
      expect(status(root)).toBe("!! dist/stamp.json\n!! dist/tool.mjs\n");
      expect(leftInTmp()).toEqual([]);
    },
  );

  it(
    "keeps the entry's files from running when its prepare fails, and no subset of loaders passes",
    SLOW,
    async () => {
      const root = project("prepare");
      const changed = await changedSet(root, ["src/names.mjs"]);
      const stored: string[] = [];
      const { evidence, notes } = await collect(root, changed, {
        prepares: prepares(node("process.exit(3)")),
        stored: async (runner) => {
          stored.push(runner);
          return new Map();
        },
      });
      // Only `unit`, which has no prepare, asks for stored evidence.
      expect(stored).toEqual(["node-test"]);
      expect(notes[1]).toMatch(/^node:test entry "package": prepare exited 3 after/);
      expect(evidence.prepares?.map((p) => [p.outcome, p.exit, p.notRun])).toEqual([
        ["failed", 3, [E2E]],
      ]);
      expect(evidence.testFiles.map((f) => [f.path, f.completed, f.notPrepared])).toEqual([
        [E2E, false, true],
        [UNIT, true, undefined],
      ]);
      // Its closure is known with no run, so only the functions it loads wait for it.
      expect(evidence.testFiles[0]?.loads).toContain("src/names.mjs");
      const { report, states } = await judged(root, changed, evidence);
      // `unit` alone would prove a pass by 015 D9's bound; the file that did not run rules it out.
      expect(states).toEqual([["label", "incomplete", "not-prepared"]]);
      expect(report.functions[0]?.loaders).toEqual({ expected: [E2E, UNIT], measured: [UNIT] });
      expect(report.runs.find((r) => r.runner === "node-test")).toMatchObject({
        notFinished: [],
        completed: [UNIT],
        prepare: [{ project: "package", outcome: "failed", exit: 3, notRun: [E2E] }],
      });
      expect(report.verdict).toBe("incomplete");
      expect(existsSync(join(root, "dist"))).toBe(false);
    },
  );

  it("does not run a prepare when no file of its entry is selected", SLOW, async () => {
    const root = project("prepare");
    const changed = await changedSet(root, [UNIT]);
    const { evidence, notes } = await collect(root, changed, {
      prepares: prepares(["node", "scripts/build.mjs"]),
    });
    expect(notes).toEqual([]);
    expect(evidence.prepares).toBeUndefined();
    expect(evidence.testFiles.map((f) => [f.path, f.completed])).toEqual([[UNIT, true]]);
    expect(existsSync(join(root, "dist"))).toBe(false);
  });

  it(
    "does not run a prepare that only the head declares, and says to land it first",
    SLOW,
    async () => {
      const root = project("prepare");
      const changed = await changedSet(root, [E2E]);
      // The base declares none: no `prepares`.
      const { evidence, notes } = await collect(root, changed);
      expect(notes).toEqual([
        'node:test entry "package" declares a prepare command that the base does not, so it does not run and its 1 selected test file does not run. Land the declaration on the base branch first: the gate runs the base\'s prepare.',
      ]);
      expect(evidence.prepares?.map((p) => [p.outcome, p.command, p.durationMs])).toEqual([
        ["not-at-base", ["node", "scripts/build.mjs"], null],
      ]);
      const { states } = await judged(root, changed, evidence);
      expect(states).toEqual([
        ["verify", "incomplete", "not-prepared"],
        ["<test>", "incomplete", "not-prepared"],
      ]);
      expect(existsSync(join(root, "dist"))).toBe(false);
    },
  );

  it("counts the prepare's time in the one budget", SLOW, async () => {
    const root = project("prepare");
    const changed = await changedSet(root, [E2E]);
    // A prepare that would outlast its 600 s cap ends at the 3 s budget.
    const started = performance.now();
    const ended = await collect(root, changed, {
      budgetSeconds: 3,
      prepares: prepares(node("setTimeout(() => {}, 600000)"), 600),
    });
    expect(performance.now() - started).toBeLessThan(60_000);
    expect(ended.evidence.timedOut).toBe(true);
    expect(ended.evidence.prepares?.map((p) => p.outcome)).toEqual(["timed-out"]);
    expect(ended.evidence.testFiles.map((f) => [f.completed, f.notPrepared])).toEqual([
      [false, true],
    ]);

    // A prepare that passes leaves the run what is left of the budget.
    const timeouts: number[] = [];
    const adapters: GateAdapters = {
      ...ADAPTERS,
      nodeTest: async (project, options) =>
        onRun(await ADAPTERS.nodeTest(project, options), (files, run) => {
          timeouts.push(run.timeoutMs ?? Infinity);
          return files;
        }),
    };
    const budgetMs = 120_000;
    const passed = await collect(root, changed, {
      budgetSeconds: budgetMs / 1000,
      adapters,
      prepares: prepares(node("setTimeout(() => {}, 1500)")),
    });
    const spent = passed.evidence.prepares?.[0]?.durationMs ?? 0;
    expect(spent).toBeGreaterThanOrEqual(1400);
    expect(timeouts).toHaveLength(1);
    expect((timeouts[0] ?? Infinity) + spent).toBeLessThanOrEqual(budgetMs);
  });
});
