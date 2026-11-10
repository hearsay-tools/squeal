import { describe, expect, it } from "vitest";
import { evaluate } from "../../../src/core/code/gate/evaluate.js";
import type { GatePolicy, UncountedPath } from "../../../src/core/code/gate/types.js";
import {
  changedSet,
  evidence,
  fn,
  type PathInput,
  POLICY,
  source,
  TIMES,
  testFile,
  VERSIONS,
} from "./evaluate-fixture.js";

/*
 * Spec 020 D5 (row 020-01): `skipped` from `coverage.exclude`, a pass from
 * a subset of the completed loaders by 015 D9's bound, never beside a loader
 * that did not finish (review 0.1.423 B2), failed tests, uncounted paths and
 * the verdict's precedence.
 */

function judged(
  paths: readonly PathInput[],
  files: Parameters<typeof evidence>[0],
  opts: { readonly policy?: GatePolicy; readonly uncounted?: readonly UncountedPath[] } = {},
) {
  const changed = changedSet(paths, opts.uncounted);
  const report = evaluate(changed, evidence(files), opts.policy ?? POLICY, VERSIONS, TIMES);
  const by = Object.fromEntries(report.functions.map((f) => [f.qualifiedName, f]));
  return { report, by };
}

const SKIP_TESTS: GatePolicy = { ...POLICY, coverageExclude: ["test/**"] };

describe("evaluate: skipped", () => {
  it("skips a function of an excluded file under the CC limit, with no evidence wanted", () => {
    const callback = fn("<test>", [1, 5], 20);
    const { report, by } = judged(
      [{ path: "test/a.test.ts", functions: [callback], changed: ["<test>"] }],
      [],
      { policy: SKIP_TESTS },
    );
    expect(by["<test>"]).toMatchObject({
      state: "skipped",
      gap: null,
      coverage: null,
      crap: null,
      loaders: { expected: [], measured: [] },
    });
    expect(report.verdict).toBe("pass");
    expect(report.counts).toEqual({ pass: 0, violation: 0, incomplete: 0, skipped: 1 });
  });

  it("keeps the CC check of an excluded file: over the limit is a violation", () => {
    const { report, by } = judged(
      [{ path: "test/a.test.ts", functions: [fn("<test>", [1, 5], 21)], changed: ["<test>"] }],
      [],
      { policy: SKIP_TESTS },
    );
    expect(by["<test>"]).toMatchObject({ state: "violation", gap: null, crap: null });
    expect(report.verdict).toBe("violations");
  });

  it("does not block on a skipped function, but a failed test still does", () => {
    const { report, by } = judged(
      [{ path: "test/a.test.ts", functions: [fn("<test>", [1, 5], 2)], changed: ["<test>"] }],
      [testFile("test/a.test.ts", [], [], { failed: ["a > breaks"] })],
      { policy: SKIP_TESTS },
    );
    expect(by["<test>"]?.state).toBe("skipped");
    expect(report.verdict).toBe("incomplete");
  });
});

describe("evaluate: a pass from a subset of the loaders", () => {
  const a = fn("a", [1, 5], 3);
  const path: PathInput = { path: "src/a.ts", functions: [a], changed: ["a"] };
  const measured = testFile("test/a.test.ts", ["src/a.ts"], [source("src/a.ts", [a])]);
  /** A loader that completed and left no record: the subset may leave it out (D5). */
  const unrecorded = testFile("test/b.test.ts", ["src/a.ts"], [], { record: null });
  const stopped = testFile("test/b.test.ts", ["src/a.ts"], [], { completed: false });

  it("passes on the records in hand while another loader completed with no record", () => {
    const { report, by } = judged([path], [measured, unrecorded]);
    expect(by.a).toMatchObject({
      state: "pass",
      gap: null,
      crap: 3,
      coverage: { lines: 5, covered: 5, share: 1 },
      loaders: { expected: ["test/a.test.ts", "test/b.test.ts"], measured: ["test/a.test.ts"] },
    });
    expect(report.verdict).toBe("pass");
  });

  it("never passes while a loader did not finish, though the records in hand would (review 0.1.423 B2)", () => {
    const { report, by } = judged([path], [measured, stopped]);
    expect(by.a).toMatchObject({
      state: "incomplete",
      gap: "not-finished",
      crap: 3,
      loaders: { expected: ["test/a.test.ts", "test/b.test.ts"], measured: ["test/a.test.ts"] },
    });
    expect(report.verdict).toBe("incomplete");
  });

  it("counts every own line from a subset, so it proves only the bound", () => {
    // Lines 4 to 6 of `b`'s ten are code and ran: 100% when complete, 30% as a bound.
    const b = fn("b", [1, 10], 10);
    const record = source("src/b.ts", [b], { lines: [4, 5, 6], covered: [4, 5, 6] });
    const bPath: PathInput = { path: "src/b.ts", functions: [b], changed: ["b"] };
    const complete = judged([bPath], [testFile("test/a.test.ts", ["src/b.ts"], [record])]);
    expect(complete.by.b).toMatchObject({ state: "pass", crap: 10 });
    const subset = judged(
      [bPath],
      [
        testFile("test/a.test.ts", ["src/b.ts"], [record]),
        testFile("test/b.test.ts", ["src/b.ts"], [], { record: null }),
      ],
    );
    expect(subset.by.b).toMatchObject({
      state: "incomplete",
      gap: "no-record",
      coverage: { lines: 10, covered: 3 },
    });
    expect(subset.by.b?.crap).toBeCloseTo(44.3, 10);
  });

  it("needs every loader for a violation", () => {
    const c = fn("c", [1, 5], 10);
    const cPath: PathInput = { path: "src/c.ts", functions: [c], changed: ["c"] };
    const missed = testFile("test/a.test.ts", ["src/c.ts"], [source("src/c.ts", [c], { ran: [] })]);
    const waiting = judged(
      [cPath],
      [missed, testFile("test/b.test.ts", ["src/c.ts"], [], { completed: false })],
    );
    expect(waiting.by.c).toMatchObject({ state: "incomplete", gap: "not-finished", crap: 110 });
    const none = judged([cPath], [missed, testFile("test/b.test.ts", ["src/c.ts"], [])]);
    expect(none.by.c).toMatchObject({ state: "violation", crap: 110 });
    const runs = judged(
      [cPath],
      [missed, testFile("test/b.test.ts", ["src/c.ts"], [source("src/c.ts", [c])])],
    );
    expect(runs.by.c).toMatchObject({
      state: "pass",
      crap: 10,
      loaders: { measured: ["test/a.test.ts", "test/b.test.ts"] },
    });
  });

  it("proves nothing with no record in hand, and no pass while a selected test failed", () => {
    const none = judged([path], [stopped]);
    expect(none.by.a).toMatchObject({ state: "incomplete", gap: "not-finished", crap: null });
    const failed = judged(
      [path],
      [measured, unrecorded, testFile("test/c.test.ts", [], [], { failed: ["c > breaks"] })],
    );
    expect(failed.by.a).toMatchObject({ state: "incomplete", gap: "no-record", crap: 3 });
    expect(failed.report.verdict).toBe("incomplete");
  });
});

describe("evaluate: the verdict", () => {
  const ok = fn("ok", [1, 5], 3);
  const bad = fn("bad", [10, 14], 21);
  const lost = fn("lost", [20, 24], 3);
  const loaded = (...names: string[]) => {
    const functions = [ok, bad, lost].filter((f) => names.includes(f.qualifiedName));
    return testFile("test/a.test.ts", ["src/a.ts"], [source("src/a.ts", functions)]);
  };
  const path = (...changed: string[]): PathInput => ({
    path: "src/a.ts",
    functions: [ok, bad, lost],
    changed,
  });

  it("is violations over incomplete, incomplete over pass, and pass over skipped", () => {
    expect(judged([path("ok", "bad", "lost")], [loaded("ok")]).report.verdict).toBe("violations");
    // `lost` has no V8 entry and none of its lines are code: the join cannot tell.
    const incomplete = judged([path("ok", "lost")], [loaded("ok")]);
    expect(incomplete.by.lost).toMatchObject({ state: "incomplete", gap: "not-joined" });
    expect(incomplete.report.counts).toEqual({ pass: 1, violation: 0, incomplete: 1, skipped: 0 });
    expect(incomplete.report.verdict).toBe("incomplete");
    const withSkipped = judged(
      [
        path("ok"),
        { path: "test/a.test.ts", functions: [fn("<test>", [1, 5], 2)], changed: ["<test>"] },
      ],
      [loaded("ok")],
      { policy: SKIP_TESTS },
    );
    expect(withSkipped.report.counts).toEqual({ pass: 1, violation: 0, incomplete: 0, skipped: 1 });
    expect(withSkipped.report.verdict).toBe("pass");
  });

  it("reads a loader whose whole record has no entry for the source as running none of it", () => {
    // As under a `vi.mock` factory: the closure loads the source, the run executed none of it.
    const mocked = testFile("test/a.test.ts", ["src/a.ts"], []);
    const { by } = judged([path("ok")], [mocked]);
    expect(by.ok).toMatchObject({
      state: "pass",
      crap: 12,
      coverage: { lines: 0, covered: 0, share: 0 },
      loaders: { expected: ["test/a.test.ts"], measured: ["test/a.test.ts"] },
    });
  });

  it("keeps a CC violation a violation when a test failed, and the verdict violations", () => {
    const { report, by } = judged(
      [path("ok", "bad")],
      [
        testFile("test/a.test.ts", ["src/a.ts"], [source("src/a.ts", [ok, bad])], {
          failed: ["x"],
        }),
      ],
    );
    expect(by.bad?.state).toBe("violation");
    expect(by.ok).toMatchObject({ state: "incomplete", gap: "test-failed" });
    expect(report.verdict).toBe("violations");
  });

  it("passes no change at all, and is incomplete when only a selected test failed", () => {
    expect(judged([], []).report.verdict).toBe("pass");
    const failed = judged([], [testFile("test/a.test.ts", [], [], { failed: ["a > breaks"] })]);
    expect(failed.report.verdict).toBe("incomplete");
  });

  it("is incomplete when a selected file that loads no changed function did not finish (D3.4)", () => {
    const stopped = testFile("test/a.test.ts", [], [], { completed: false });
    const alone = judged([], [stopped]);
    expect(alone.report.verdict).toBe("incomplete");
    const beside = judged([path("ok")], [loaded("ok"), { ...stopped, path: "test/b.test.ts" }]);
    expect(beside.by.ok).toMatchObject({ state: "pass", crap: 3 });
    expect(beside.report.verdict).toBe("incomplete");
  });
});

describe("evaluate: uncounted paths", () => {
  it("lists a path the counter could not count, with no function named, and is incomplete", () => {
    const { report } = judged([], [], {
      uncounted: [{ path: "src/huge.ts", reason: "too-large" }],
    });
    expect(report.uncounted).toEqual([
      { path: "src/huge.ts", reason: "too-large", gap: "not-counted" },
    ]);
    expect(report.functions).toEqual([]);
    expect(report.verdict).toBe("incomplete");
  });

  it("passes the other changed functions of a parse-error path and stays incomplete", () => {
    const fine = fn("fine", [1, 5], 3);
    const broken = fn("broken", [10, 14], 3);
    const { report, by } = judged(
      [{ path: "src/a.ts", functions: [fine, broken], changed: ["fine"], inErrors: ["broken"] }],
      [testFile("test/a.test.ts", ["src/a.ts"], [source("src/a.ts", [fine, broken])])],
      { uncounted: [{ path: "src/a.ts", reason: "parse-error" }] },
    );
    expect(by.fine).toMatchObject({ state: "pass", crap: 3 });
    expect(by.broken).toMatchObject({ state: "incomplete", gap: "not-counted", crap: null });
    expect(report.uncounted).toEqual([
      { path: "src/a.ts", reason: "parse-error", gap: "not-counted" },
    ]);
    expect(report.head.paths).toEqual([{ path: "src/a.ts", blob: "b".repeat(40) }]);
    expect(report.verdict).toBe("incomplete");
  });
});
