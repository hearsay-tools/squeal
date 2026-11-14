import { describe, expect, it } from "vitest";
import { formatReach } from "../../src/cli/reach-format.js";
import { buildReport } from "../../src/core/reach/report.js";
import type { LoadedFacts } from "../../src/core/reach/types.js";
import { snapshot, testFile } from "./fixture.js";

/*
 * Row 022-04 (spec 022 D4): the estimate of narrowing by loaded modules,
 * per project, from a fixture snapshot: an avoidable pair, a loaded pair, a
 * pair through a declared input, each reason a file has no list, a project
 * with no lists, and a runner that records none. Text and JSON.
 */

const LAZY = "src/lazy.ts";
const DATA = "data/in.json";

function loaded(
  facts: Partial<Omit<LoadedFacts, "lists">> & { lists?: [number, string[]][] },
): LoadedFacts {
  const { lists = [], recordAt = null, failed = false } = facts;
  return { lists: lists.map(([at, paths]) => ({ at, paths: new Set(paths) })), recordAt, failed };
}

const report = (files: Parameters<typeof snapshot>[0], options = {}) =>
  buildReport(
    snapshot(files, {
      declared: { [DATA]: { tests: null, input: "data/*.json" } },
      edits: [
        { at: 100, paths: [LAZY] },
        { at: 110, paths: [DATA] },
      ],
      ...options,
    }),
    { paths: null, limit: null, command: "squeal", listed: files.length },
  );

describe("squeal reach: narrowing by loaded modules (022 D4)", () => {
  const files = [
    // Avoidable: LAZY is on its import path and its list at 50 does not hold it.
    testFile("a.test.ts", ["a.test.ts", LAZY], {
      seconds: 2,
      loaded: loaded({ lists: [[50, ["a.test.ts"]]] }),
    }),
    // Loaded: its list holds LAZY.
    testFile("b.test.ts", ["b.test.ts", LAZY], {
      seconds: 3,
      loaded: loaded({ lists: [[50, ["b.test.ts", LAZY]]] }),
    }),
    // Through a declared input: never avoidable, though its list lacks the file.
    testFile("c.test.ts", ["c.test.ts", DATA], {
      loaded: loaded({ lists: [[50, ["c.test.ts"]]] }),
    }),
    testFile("d.test.ts", ["d.test.ts", LAZY], { loaded: loaded({ failed: true }) }),
    testFile("e.test.ts", ["e.test.ts", LAZY], { loaded: loaded({ recordAt: 60 }) }),
    testFile("f.test.ts", ["f.test.ts", LAZY], { loaded: loaded({ recordAt: 10 }) }),
    testFile("g.test.ts", ["g.test.ts", LAZY], { loaded: loaded({ lists: [[200, [LAZY]]] }) }),
    testFile("h.test.ts", ["h.test.ts", LAZY]),
  ];

  it("counts an avoidable pair only through an import path the list does not hold", () => {
    const [estimate] = report(files).narrowing;
    expect(estimate).toMatchObject({
      project: "",
      status: "estimate",
      lists: "lists: the newest recorded at or before each edit",
      rerunSeconds: 11,
      avoidableSeconds: 2,
      share: 2 / 11,
      files: [{ path: LAZY, avoidableSeconds: 2, importedBy: 7, loadedBy: 2 }],
      moreFiles: 0,
    });
  });

  it("names each reason a re-keyed file has no list", () => {
    const [estimate] = report(files).narrowing;
    expect(estimate?.withoutList).toEqual([
      { reason: "incomplete run", detail: null, testFiles: 1, seconds: 1 },
      { reason: "list lost", detail: null, testFiles: 1, seconds: 1 },
      { reason: "never recorded", detail: null, testFiles: 1, seconds: 1 },
      {
        reason: "never recorded",
        detail: "edited before its first list",
        testFiles: 1,
        seconds: 1,
      },
      {
        reason: "never recorded",
        detail: "ran before lists were recorded",
        testFiles: 1,
        seconds: 1,
      },
    ]);
  });

  it("estimates nothing for a project with no lists, and names why", () => {
    const plain = [testFile("x.test.ts", ["x.test.ts", LAZY], { project: "p", current: false })];
    expect(report(plain).narrowing[0]).toMatchObject({
      project: "p",
      status: "no lists",
      reason: "never recorded",
      share: 0,
      files: [],
    });
    expect(report(plain, { coverageOn: false }).narrowing[0]).toMatchObject({
      status: "no lists",
      reason: "coverage off",
      withoutList: [{ reason: "coverage off", testFiles: 1 }],
    });
    // Results at the current key, no coverage record at any: the project runs with isolate: false.
    expect(
      report([testFile("x.test.ts", ["x.test.ts", LAZY], { project: "p", current: true })])
        .narrowing[0],
    ).toMatchObject({ status: "no lists", reason: "isolate: false" });
    const pytest = testFile("t_x.py", ["t_x.py", LAZY], { project: "py", runner: "pytest" });
    expect(report([pytest]).narrowing[0]).toMatchObject({ status: "not Vitest", share: 0 });
  });

  it("splits a pair re-keyed by several files evenly among them", () => {
    const one = testFile("a.test.ts", ["a.test.ts", LAZY, "src/other.ts"], {
      seconds: 4,
      loaded: loaded({ lists: [[50, ["a.test.ts"]]] }),
    });
    const [estimate] = report([one], {
      edits: [{ at: 100, paths: [LAZY, "src/other.ts"] }],
    }).narrowing;
    expect(estimate?.files.map((f) => [f.path, f.avoidableSeconds])).toEqual([
      [LAZY, 2],
      ["src/other.ts", 2],
    ]);
  });

  it("writes the section in the text", () => {
    const pytest = testFile("t_x.py", ["t_x.py", LAZY], { project: "py", runner: "pytest" });
    const text = formatReach(report([...files, pytest]));
    expect(text).toContain(
      "Narrowing by loaded modules (lists: the newest recorded at or before each edit):",
    );
    expect(text).toContain(
      "  default project: would save 18% of re-run seconds, 2 s of 11 s over the window's edits.\n" +
        "    src/lazy.ts: avoidable 2 s; imported by 7 test files, loaded by 2\n" +
        "    re-run without a list: incomplete run: 1 test file, 1 s; list lost: 1 test file, 1 s; " +
        "never recorded: 1 test file, 1 s; " +
        "never recorded (edited before its first list): 1 test file, 1 s; " +
        "never recorded (ran before lists were recorded): 1 test file, 1 s\n" +
        "  py: its runner records no lists (Vitest only); nothing estimated.\n",
    );
  });
});
