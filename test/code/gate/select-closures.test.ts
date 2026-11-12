import { describe, expect, it } from "vitest";
import {
  type ClosureGaps,
  closureGaps,
  closureLine,
  type IncompleteClosure,
  tellClosures,
} from "../../../src/core/code/gate/select-closures.js";

/*
 * Row 020-31 (#193; spec 020 D7, D14.4): each node:test project's test
 * files with an incomplete static closure, scoped to what the gate
 * selected: one line per project, and every file in the report.
 */

const computed = (path: string): IncompleteClosure => [
  path,
  [`import() with a computed specifier at ${path}:5:28`],
];

/** `count` files `test/f<i>.test.mjs`, in reverse path order, as an adapter may list them. */
const files = (count: number): IncompleteClosure[] =>
  Array.from({ length: count }, (_, i) => computed(`test/f${i + 1}.test.mjs`)).reverse();

const ref = (project: string, path: string) => ({ project, path });

const gaps = (project: string, selected: readonly boolean[]): ClosureGaps => ({
  runner: "node-test",
  project,
  files: selected.map((chosen, i) => ({
    path: `test/f${i + 1}.test.mjs`,
    reasons: [`import() with a computed specifier at test/f${i + 1}.test.mjs:5:28`],
    selected: chosen,
  })),
});

const OTHERS =
  "The gate selects test files by their static imports, so the other 18 do not run for a changed path they load only through a computed import() or require().";

describe("closureGaps (#193)", () => {
  it("lists every file of each project by path, each selected when the check holds it", () => {
    const lists = new Map([
      ["unit", files(3)],
      ["empty", []],
      ["api", [computed("test/f1.test.mjs")]],
    ]);

    // The same path in another project, and a project with no gap, select nothing here.
    const inCheck = [ref("unit", "test/f2.test.mjs"), ref("other", "test/f1.test.mjs")];

    expect(closureGaps(lists, inCheck)).toEqual([
      gaps("api", [false]),
      gaps("unit", [false, true, false]),
    ]);
  });

  it("gives none when no project has a file with an incomplete closure", () => {
    expect(closureGaps(new Map([["unit", []]]), [])).toEqual([]);
  });
});

describe("closureLine (#193)", () => {
  it("says none of 19 is in this check, what that means and where the list is", () => {
    expect(closureLine(gaps("unit", Array(19).fill(false)))).toBe(
      `node-test project "unit": 0 of 19 test files with an incomplete static closure are in this check. ${OTHERS.replace("18", "19")} The --json report lists all 19 in incompleteClosures.`,
    );
  });

  it("names the one selected file", () => {
    expect(closureLine(gaps("unit", [false, true, ...Array(17).fill(false)]))).toBe(
      `node-test project "unit": 1 of 19 test files with an incomplete static closure is in this check: test/f2.test.mjs. ${OTHERS} The --json report lists all 19 in incompleteClosures.`,
    );
  });

  it("names the first three selected files of more than three, then only counts", () => {
    const selected = [true, false, true, true, true, false];
    expect(closureLine(gaps("unit", selected))).toBe(
      'node-test project "unit": 4 of 6 test files with an incomplete static closure are in this check: test/f1.test.mjs, test/f3.test.mjs, test/f4.test.mjs and 1 more. The gate selects test files by their static imports, so the other 2 do not run for a changed path they load only through a computed import() or require(). The --json report lists all 6 in incompleteClosures.',
    );
  });

  it("says nothing of the others when every file is in this check", () => {
    expect(closureLine(gaps("unit", [true]))).toBe(
      'node-test project "unit": 1 of 1 test file with an incomplete static closure is in this check: test/f1.test.mjs. The --json report lists it in incompleteClosures.',
    );
  });

  it("says the one other file does not run", () => {
    expect(closureLine(gaps("unit", [false]))).toBe(
      'node-test project "unit": 0 of 1 test file with an incomplete static closure are in this check. The gate selects test files by their static imports, so the other one does not run for a changed path it loads only through a computed import() or require(). The --json report lists it in incompleteClosures.',
    );
  });
});

describe("tellClosures (#193)", () => {
  it("tells one line per project and gives the evidence's list", () => {
    const told: string[] = [];
    const lists = new Map([
      ["unit", files(2)],
      ["api", files(1)],
    ]);
    const picked = [
      // A Vitest file at the same path is not a node:test project's.
      { kind: "vitest" as const, run: [ref("unit", "test/f1.test.mjs")] },
      { kind: "node-test" as const, run: [ref("unit", "test/f2.test.mjs")] },
    ];

    const evidence = tellClosures(lists, picked, (text) => told.push(text));

    const expected = [gaps("api", [false]), gaps("unit", [false, true])];
    expect(evidence).toEqual({ incompleteClosures: expected });
    expect(told).toEqual(expected.map(closureLine));
  });

  it("tells nothing and gives no field when no project has such a file", () => {
    const told: string[] = [];
    expect(tellClosures(new Map(), [], (text) => told.push(text))).toEqual({});
    expect(told).toEqual([]);
  });
});
