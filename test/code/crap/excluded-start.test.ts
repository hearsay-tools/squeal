import { describe, expect, it } from "vitest";
import {
  ALL_CHECKS,
  type CoverageChecks,
  coverageChecks,
  readCoverageChange,
  readSummary,
  SEED_FILES,
  STEP_BUDGET_MS,
  StepCache,
} from "../../../src/core/code/crap/index.js";
import { DEFAULT_POLICY } from "../../../src/core/types/index.js";
import { WT } from "../../state/helpers.js";
import { fakeCounter, pass } from "../pass/helpers.js";
import { COVERED, type CoverageRig, consumer, coverageRig, sourceOf } from "./rig.js";

/*
 * Review 0.1.345 N2, spec 015 D1 and D9 First judgement: a change of the
 * checks while coverage's first seed runs, before any summary. The daemon
 * drops the seed (`pass/index.ts` `checksOf`), and the new one skips a
 * file now excluded, but the old one may have written pending states
 * there. No file was judged yet, so none was told: the states go quietly.
 */

const EXCLUDED = coverageChecks({
  ...DEFAULT_POLICY,
  coverage: { ...DEFAULT_POLICY.coverage, exclude: ["src/gen/**"] },
});
const S1 = consumer("s1");
const B = "src/gen/b.ts";
const OTHERS = Object.fromEntries(
  Array.from({ length: SEED_FILES }, (_, f) => [`src/m${f}.ts`, `m${f} 2 b${f}\n`]),
);
/** `made` moves with its body unchanged from `src/a.ts` into `src/gen/b.ts`. */
const MOVE = { "src/a.ts": "keep 2 k1\n", [B]: "stay 2 s1\nmade 2 m1\n" };

/** `measure outcome` of each state in `path`. */
const at = (rig: CoverageRig, path: string) =>
  rig.store.states.list(WT, { paths: [path] }).map((s) => `${s.measure} ${s.outcome}`);

/**
 * `src/a.ts`, `src/gen/b.ts` and `SEED_FILES` more, counted, each loaded and
 * run by one test file, S1 registered, and coverage's first step: it seeds
 * one unit, `src/a.ts` and `src/gen/b.ts` in it, and writes no summary. A
 * sliced step does one unit of work; `finish` does the rest in one step.
 */
async function started() {
  const rig = coverageRig();
  await rig.edit({ "src/a.ts": "keep 2 k1\nmade 2 m1\n", [B]: "stay 2 s1\n", ...OTHERS });
  // Each file's record at its current blob, every function run.
  const loads = () => {
    const files = rig.store.files.list(WT);
    const functions = (path: string) =>
      rig.store.states.list(WT, { paths: [path], measure: "complexity" }).length;
    rig.loader("test/all.test.ts", {
      closure: files.map((f) => f.path),
      record: files.map((f) => sourceOf(f.path, f.blob, functions(f.path), [1, 2])),
    });
  };
  loads();
  await rig.register(S1);
  const cache = new StepCache();
  const step = (checks: CoverageChecks, unit = STEP_BUDGET_MS + 1) =>
    rig.step({ checks, cache, now: () => (rig.clock += unit) });
  expect(step(ALL_CHECKS)?.seeding).toBe(true);
  expect(readSummary(rig.store.meta, WT)).toBeNull();
  expect(at(rig, B)).toEqual(["complexity pass", "crap pending", "uncovered pending"]);
  return {
    rig,
    step,
    /** A change of the checks: the daemon drops the seed, and the next step begins a new one. */
    change: () => cache.dropSeed(),
    /** `made` moves into `src/gen/b.ts`, by an edit the daemon's pass follows (`pass/index.ts`). */
    async move() {
      for (const [path, text] of Object.entries(MOVE)) rig.tree.write(path, text);
      rig.tree.revise();
      rig.clock += 1_000;
      const now = rig.clock;
      const over = { policy: COVERED, now: () => now, coverageExcluded: EXCLUDED.excluded };
      const report = await pass(rig.tree, rig.store, fakeCounter(), over);
      expect(report?.moves.map((m) => `${m.from.path} ${m.to.path}`)).toEqual([`src/a.ts ${B}`]);
      if (report !== null) cache.follow(report);
      cache.invalidate();
      loads();
    },
    finish: (checks: CoverageChecks) => expect(step(checks, 0)?.more).toBe(false),
  };
}

describe("an exclude added while coverage's first seed runs (review 0.1.345 N2)", () => {
  it("leaves the excluded file its complexity alone, with a move in the same edit, quietly", async () => {
    const { rig, change, move, finish } = await started();
    change();
    await move();
    finish(EXCLUDED);

    expect(at(rig, B)).toEqual(["complexity pass", "complexity pass"]);
    expect(at(rig, "src/a.ts")).toEqual(["complexity pass", "crap pass", "uncovered pass"]);
    expect(Object.keys(readSummary(rig.store.meta, WT)?.files ?? {})).not.toContain(B);
    expect(readSummary(rig.store.meta, WT)?.exclude).toEqual(["src/gen/**"]);
    expect(readCoverageChange(rig.store.meta, WT)).toBeNull();
    expect(await rig.told(S1)).toEqual([]);
  });

  it("leaves the excluded file its complexity alone, with a move while the new seed runs, quietly", async () => {
    const { rig, step, change, move, finish } = await started();
    change();
    expect(step(EXCLUDED)?.seeding).toBe(true);
    await move();
    finish(EXCLUDED);

    expect(at(rig, B)).toEqual(["complexity pass", "complexity pass"]);
    expect(at(rig, "src/a.ts")).toEqual(["complexity pass", "crap pass", "uncovered pass"]);
    expect(readCoverageChange(rig.store.meta, WT)).toBeNull();
    expect(await rig.told(S1)).toEqual([]);
  });
});

/*
 * The same window for a check switched off (D1): the old seed's states of
 * the check go too, quietly, as no file was judged with it.
 */
describe("a check switched off while coverage's first seed runs (review 0.1.345 N2)", () => {
  it("leaves no state of the check, quietly", async () => {
    const { rig, change, finish } = await started();
    const off = coverageChecks({
      ...DEFAULT_POLICY,
      crap: { ...DEFAULT_POLICY.crap, enabled: false },
    });
    change();
    finish(off);

    expect(rig.states("crap")).toEqual([]);
    expect(at(rig, B)).toEqual(["complexity pass", "uncovered pass"]);
    expect(readSummary(rig.store.meta, WT)?.checks).toEqual(["uncovered"]);
    expect(readCoverageChange(rig.store.meta, WT)).toBeNull();
    expect(await rig.told(S1)).toEqual([]);
  });
});
