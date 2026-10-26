import { describe, expect, it } from "vitest";
import { WT } from "../../state/helpers.js";
import { COVERED, type CoverageRig, consumer, coverageRig } from "../crap/rig.js";
import { daemonPass } from "./helpers.js";

/*
 * Row 015-52, spec 015 D1: "These are never counted: test files (any file a
 * runner lists)". On 0.1.309 a fast-forward brought `test/code/crap/seed.test.ts`
 * while the runner part of its revision was pending; the pass counted it as
 * source, and its 61 functions were told as `FAIL uncovered`. The pass holds
 * a file it never counted that a revision after the listed one brings, until
 * that listing (the scheduler's `onListed` nudges it, agreed with
 * coordinator 52e58f23 and 011); a counted file a runner lists later leaves
 * with nothing told, also when the listing comes with no new revision.
 */

const SEED = "test/seed.test.ts";
/** A test file's functions, one over 20. */
const SEED_TEXT = "seeds.<it> 2 s1\nseeds 25 s2\nseeds.<it> 3 s3\n";
const S1 = consumer("s1");
/** The transitions of `seeds` from its count as source; a removal adds none. */
const COUNTED_AS_SOURCE = [
  "complexity first-seen-fail",
  "crap first-seen-fail",
  "uncovered first-seen-fail",
];

/** `src/a.ts` counted and loaded by `test/a.test.ts`, under the daemon's pass, with S1 registered. */
async function counted(policy = () => COVERED) {
  const rig = coverageRig();
  rig.tree.write("src/a.ts", "a 3 a1\n").revise();
  rig.tree.testFiles.push("test/a.test.ts");
  rig.loader("test/a.test.ts", { closure: ["src/a.ts"] });
  const run = daemonPass(rig.tree, {
    policy,
    now: () => rig.clock,
    coverage: { main: rig.main, closures: () => rig.closures, writing: () => false },
  });
  await settle(rig, run);
  await rig.register(S1);
  return { rig, run };
}

/** One pass, as a batch or the scheduler's `onListed` nudges it. */
async function settle(rig: CoverageRig, run: ReturnType<typeof daemonPass>) {
  rig.clock += 1_000;
  run.code.nudge();
  await run.code.idle();
}

/** The runner lists `path`, a test file, at the newest revision. */
function list(rig: CoverageRig, path: string) {
  rig.tree.testFiles.push(path);
  rig.loader(path, { closure: [] });
  rig.tree.listed = null;
}

const rows = (rig: CoverageRig) => rig.store.files.list(WT).map((f) => f.path);
const of = (rig: CoverageRig, path: string) => ({
  states: rig.store.states.list(WT, { paths: [path] }).map((s) => s.measure),
  transitions: rig.store.transitions
    .history(WT, { kind: "code", path, qualifiedName: "seeds", occurrence: 0 })
    .map((t) => `${t.measure} ${t.kind}`),
});
/** The lines that name `path`, and the lines of a block whose head names it (row 015-65). */
function naming(lines: readonly string[], path: string): string[] {
  let named = false;
  return lines.filter((l) => {
    if (l.startsWith("- ")) return named;
    named = l.includes(path) && l.endsWith("):");
    return l.includes(path);
  });
}

describe("a test file and its runner listing (015 D1, row 015-52)", () => {
  it("counts and tells nothing of a test file a revision brings before its listing", async () => {
    const { rig, run } = await counted();
    // Revision 2 brings a test file and a new source, and edits `src/a.ts`; its runner part is pending.
    rig.tree.listed = 1;
    rig.tree.write(SEED, SEED_TEXT).write("src/b.ts", "b 25 b1\n").write("src/a.ts", "a 4 a2\n");
    rig.tree.revise();
    await settle(rig, run);
    // A file it counted before goes on at once; the new ones wait for the listing.
    expect(rows(rig)).toEqual(["src/a.ts"]);
    expect(naming(await rig.told(S1), SEED)).toEqual([]);

    list(rig, SEED);
    await settle(rig, run);
    expect(rows(rig)).toEqual(["src/a.ts", "src/b.ts"]);
    expect(of(rig, SEED)).toEqual({ states: [], transitions: [] });
    const told = await rig.told(S1);
    expect(naming(told, SEED)).toEqual([]);
    expect(naming(told, "src/b.ts")).toEqual(
      expect.arrayContaining(["b (src/b.ts:1):", "- FAIL complexity: 25, over 20 (ESLint rule)"]),
    );
  });

  it("counts a held source file at the next daemon's pass once its revision is listed", async () => {
    const { rig, run } = await counted();
    rig.tree.listed = 1;
    rig.tree.write("src/b.ts", "b 25 b1\n").revise();
    await settle(rig, run);
    expect(rows(rig)).toEqual(["src/a.ts"]);
    await run.code.close();

    rig.tree.listed = null;
    const next = daemonPass(rig.tree, {
      policy: () => COVERED,
      now: () => rig.clock,
      coverage: { main: rig.main, closures: () => rig.closures, writing: () => false },
    });
    await settle(rig, next);
    expect(rows(rig)).toEqual(["src/a.ts", "src/b.ts"]);
    expect(naming(await rig.told(S1), "src/b.ts")).toEqual(
      expect.arrayContaining(["b (src/b.ts:1):", "- FAIL complexity: 25, over 20 (ESLint rule)"]),
    );
    await next.code.close();
  });

  it("waits with a recount for the listing of a file it would hold, then counts the source in it", async () => {
    let policy = COVERED;
    const { rig, run } = await counted(() => policy);
    const passes = run.reports.length;
    // Revision 2 lowers the threshold and brings a test file and a source; its listing is pending.
    policy = { ...COVERED, complexity: { ...COVERED.complexity, threshold: 15 } };
    rig.tree.listed = 1;
    rig.tree.write(SEED, SEED_TEXT).write("src/b.ts", "b 18 b1\n").revise();
    await settle(rig, run);
    expect(run.reports).toHaveLength(passes);
    expect(rows(rig)).toEqual(["src/a.ts"]);

    list(rig, SEED);
    await settle(rig, run);
    expect(run.reports.at(-1)?.mode).toBe("threshold");
    expect(rows(rig)).toEqual(["src/a.ts", "src/b.ts"]);
    expect(of(rig, SEED)).toEqual({ states: [], transitions: [] });
    const told = await rig.told(S1);
    expect(naming(told, SEED)).toEqual([]);
    // The recount counts it with no transition (D5): its summary, not a line of its own, tells it.
    const states = rig.store.states.list(WT, { paths: ["src/b.ts"], measure: "complexity" });
    expect(states.map((s) => `${s.outcome} ${s.value}`)).toEqual(["fail 18"]);
    expect(naming(told, "src/b.ts")).toEqual([]);
    expect(told).toContain(
      "Complexity threshold is now 15: 1 function over; squeal code lists them.",
    );
  });

  it("removes a test file counted before its listing with nothing told", async () => {
    const { rig, run } = await counted();
    await countedAsSource(rig, run);
    // Revision 3's runner part lists it.
    rig.tree.listed = 2;
    rig.tree.write("src/a.ts", "a 4 a2\n").revise();
    await settle(rig, run);
    list(rig, SEED);
    await settle(rig, run);
    expect(rows(rig)).toEqual(["src/a.ts"]);
    expect(of(rig, SEED)).toEqual({ states: [], transitions: COUNTED_AS_SOURCE });
    expect(naming(await rig.told(S1), SEED)).toEqual([]);
  });

  it("removes with nothing told a counted test file that a listing at the same revision lists (review 0.1.315 N1)", async () => {
    const { rig, run } = await counted();
    await countedAsSource(rig, run);
    // A runner-only refinement lists it: no new revision, one more listing.
    list(rig, SEED);
    rig.tree.listings += 1;
    await settle(rig, run);
    expect(rows(rig)).toEqual(["src/a.ts"]);
    expect(of(rig, SEED)).toEqual({ states: [], transitions: COUNTED_AS_SOURCE });
    expect(naming(await rig.told(S1), SEED)).toEqual([]);
  });

  it("removes with nothing told a test file an older daemon counted, at the next daemon's first pass", async () => {
    const { rig, run } = await counted();
    await countedAsSource(rig, run);
    await run.code.close();
    // A store 0.1.311 left: no listing record, and the runner lists the file.
    rig.store.meta.delete(`listed:${WT}`);
    list(rig, SEED);
    const next = daemonPass(rig.tree, {
      policy: () => COVERED,
      now: () => rig.clock,
      coverage: { main: rig.main, closures: () => rig.closures, writing: () => false },
    });
    await settle(rig, next);
    expect(rows(rig)).toEqual(["src/a.ts"]);
    expect(of(rig, SEED)).toEqual({ states: [], transitions: COUNTED_AS_SOURCE });
    expect(naming(await rig.told(S1), SEED)).toEqual([]);
    await next.code.close();
  });
});

/**
 * Revision 2 brings the test file while its listing reads as done, as
 * 0.1.309's did after a refinement that threw: it is counted as source,
 * told, and fails `uncovered`.
 */
async function countedAsSource(rig: CoverageRig, run: ReturnType<typeof daemonPass>) {
  rig.tree.write(SEED, SEED_TEXT).revise();
  await settle(rig, run);
  expect(of(rig, SEED).states).toEqual(expect.arrayContaining(["complexity", "uncovered"]));
  expect(naming(await rig.told(S1), SEED)).toEqual(
    expect.arrayContaining([
      "seeds (test/seed.test.ts:2):",
      "- FAIL complexity: 25, over 20 (ESLint rule)",
    ]),
  );
}
