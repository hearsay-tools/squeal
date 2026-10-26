import { describe, expect, it } from "vitest";
import {
  ALL_CHECKS,
  type CoverageChecks,
  coverageChecks,
  readCoverageChange,
  readSummary,
  STEP_BUDGET_MS,
  StepCache,
} from "../../../src/core/code/crap/index.js";
import type { PassContext } from "../../../src/core/code/pass/pass.js";
import { DEFAULT_POLICY } from "../../../src/core/types/index.js";
import { WT } from "../../state/helpers.js";
import { type CoverageRig, consumer, coverageRig, sourceOf } from "./rig.js";

/*
 * Review 0.1.337 B1, spec 015 D1: "a matched file keeps its complexity,
 * but gets no `crap` or `untested` state", also when an edit moves a
 * function into a file the unchanged `coverage.exclude` already matches.
 */

const EXCLUDED = coverageChecks({
  ...DEFAULT_POLICY,
  coverage: { ...DEFAULT_POLICY.coverage, exclude: ["src/gen/**"] },
});
const S1 = consumer("s1");
const MADE = { kind: "code", path: "src/gen/b.ts", qualifiedName: "made", occurrence: 0 } as const;

/** `measure outcome` of each state in `path`. */
const at = (rig: CoverageRig, path: string) =>
  rig.store.states.list(WT, { paths: [path] }).map((s) => `${s.measure} ${s.outcome}`);

/** `path measure` of each of S1's view entries in `src/a.ts` or `src/gen/b.ts`. */
const viewed = (rig: CoverageRig) =>
  rig.store.views
    .list(S1)
    .filter((v) => v.check.path === "src/a.ts" || v.check.path === MADE.path)
    .map((v) => `${v.check.path} ${v.measure}`);

/**
 * `made`, over complexity 20, added by an edit after the first count and
 * coverage's start, judged CRAP and untested fail in `src/a.ts` and told
 * to S1, then moved with its body unchanged into `src/gen/b.ts`. Each
 * edit's pass is given `over`, each step `checks`.
 */
async function moved(checks: CoverageChecks, over: Partial<PassContext>) {
  const rig = coverageRig();
  await rig.edit({ "src/keep.ts": "keep 2 k1\n" }, over);
  rig.step({ checks });
  await rig.register(S1);
  await rig.edit({ "src/a.ts": "made 25 m1\n" }, over);
  const blob = rig.store.files.list(WT, ["src/a.ts"])[0]?.blob ?? "";
  rig.loader("test/a.test.ts", {
    closure: ["src/a.ts"],
    record: [sourceOf("src/a.ts", blob, 1, [])],
  });
  rig.step({ checks });
  expect(at(rig, "src/a.ts")).toEqual(["complexity fail", "crap fail", "uncovered fail"]);
  await rig.told(S1);
  expect(viewed(rig)).toEqual(["src/a.ts complexity", "src/a.ts crap", "src/a.ts uncovered"]);
  const before = rig.transitions("src/a.ts", ["made"]);
  expect(before).toEqual(["crap first-seen-fail made", "uncovered first-seen-fail made"]);
  const [source] = rig.store.states.list(WT, { paths: ["src/a.ts"], measure: "complexity" });
  await rig.edit({ "src/a.ts": "", "src/gen/b.ts": "made 25 m1\n" }, over);
  rig.step({ checks });
  return { rig, before, source, told: await rig.told(S1) };
}

describe("a function moved into a file coverage.exclude matches (review 0.1.337 B1)", () => {
  it.each([
    ["the edit pass", {}],
    ["the staged edit pass", { partFiles: 1 }],
  ])("through %s, keeps only its complexity, quietly", async (_, part) => {
    const { rig, before, source, told } = await moved(EXCLUDED, {
      ...part,
      coverageExcluded: EXCLUDED.excluded,
    });
    expect(at(rig, MADE.path)).toEqual(["complexity fail"]);
    expect(at(rig, "src/a.ts")).toEqual([]);
    // No coverage transition: the history the move carried, and nothing more.
    expect(rig.transitions(MADE.path, ["made"])).toEqual(before);
    expect(viewed(rig)).toEqual([`${MADE.path} complexity`]);
    expect(told).toEqual([]);
    expect(readCoverageChange(rig.store.meta, WT)).toBeNull();

    // The move's identity and its complexity mark are those of a move with no exclude.
    const plain = await moved(ALL_CHECKS, part);
    const complexity = (r: CoverageRig) => ({
      state: r.store.states.list(WT, { paths: [MADE.path], measure: "complexity" }),
      history: r.store.transitions.history(WT, MADE).filter((t) => t.measure === "complexity"),
    });
    expect(complexity(rig)).toEqual(complexity(plain.rig));
    expect(complexity(rig).history.map((t) => t.kind)).toEqual(["first-seen-fail"]);
    expect(complexity(rig).state[0]?.changedAt).toBe(source?.changedAt);
  });
});

/*
 * Review 0.1.341 B2, spec 015 D1: "a file newly excluded loses its states
 * with one summary line", also when the same pass moves a function into it.
 */
describe("a move into a file the same pass's coverage.exclude change leaves out (review 0.1.341 B2)", () => {
  const LINE = "Coverage checks changed: 1 file no longer checked (coverage.exclude).";
  const coverageLines = async (rig: CoverageRig) =>
    (await rig.told(S1)).filter((l) => l.startsWith("Coverage "));
  const measures = (rig: CoverageRig) =>
    rig.store.states.list(WT, { paths: [MADE.path] }).map((s) => s.measure);

  /** `src/a.ts` with `a`, `src/gen/b.ts` with `stay`, both judged, no test running either. */
  async function judged(a: string, part: Partial<PassContext>): Promise<CoverageRig> {
    const rig = coverageRig();
    await rig.edit({ "src/a.ts": a, "src/gen/b.ts": "stay 2 s1\n" }, part);
    const source = (path: string, functions: number) =>
      sourceOf(path, rig.store.files.list(WT, [path])[0]?.blob ?? "", functions, []);
    rig.loader("test/a.test.ts", {
      closure: ["src/a.ts", "src/gen/b.ts"],
      record: [source("src/a.ts", a.split("\n").length - 1), source("src/gen/b.ts", 1)],
    });
    rig.step();
    expect(measures(rig)).toEqual(["complexity", "crap", "uncovered"]);
    await rig.register(S1);
    await rig.told(S1);
    return rig;
  }

  it.each([
    ["the edit pass", {}],
    ["the staged edit pass", { partFiles: 1 }],
  ])("through %s, tells the file once", async (_, part) => {
    const rig = await judged("made 9 m1\n", part);
    await rig.edit(
      { "src/a.ts": "", "src/gen/b.ts": "stay 2 s1\nmade 9 m1\n" },
      { ...part, coverageExcluded: EXCLUDED.excluded },
    );
    rig.step({ checks: EXCLUDED });
    expect(measures(rig)).toEqual(["complexity", "complexity"]);
    expect(readCoverageChange(rig.store.meta, WT)).toMatchObject({ off: [], excluded: 1 });
    expect(await coverageLines(rig)).toEqual([LINE]);
    rig.step({ checks: EXCLUDED });
    expect(await rig.told(S1)).toEqual([]);
  });

  it("does not count the file again for a move into it before the step writes the exclude", async () => {
    const rig = await judged("made 9 m1\nmore 9 n1\n", {});
    const over = { coverageExcluded: EXCLUDED.excluded };
    // Each unit of the step takes its budget: the loader map is read over several steps.
    const cache = new StepCache();
    const step = () =>
      rig.step({ checks: EXCLUDED, cache, now: () => (rig.clock += STEP_BUDGET_MS + 1) });
    await rig.edit({ "src/a.ts": "more 9 n1\n", "src/gen/b.ts": "stay 2 s1\nmade 9 m1\n" }, over);
    expect(step()?.reading).toBe(true);
    expect(readSummary(rig.store.meta, WT)?.exclude).toBeUndefined();
    expect(measures(rig)).toEqual(["complexity", "complexity"]);
    expect(await coverageLines(rig)).toEqual([LINE]);

    await rig.edit({ "src/a.ts": "", "src/gen/b.ts": "stay 2 s1\nmade 9 m1\nmore 9 n1\n" }, over);
    expect(measures(rig)).toEqual(["complexity", "complexity", "complexity"]);
    for (let i = 0; i < 10 && step()?.more === true; i++);
    expect(readSummary(rig.store.meta, WT)?.exclude).toEqual(["src/gen/**"]);
    expect(await rig.told(S1)).toEqual([]);
  });
});
