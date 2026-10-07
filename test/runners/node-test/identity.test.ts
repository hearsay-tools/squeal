import { describe, expect, it } from "vitest";
import {
  identify,
  type ReportedTest,
  suffixDuplicates,
} from "../../../src/runners/node-test/identity.js";

const test = (name: string, nesting: number, line: number, ids?: [number, number]) => ({
  name,
  nesting,
  line,
  suite: false,
  ...(ids === undefined ? {} : { testId: ids[0], parentId: ids[1] }),
});
const suite = (name: string, nesting: number, line: number, ids?: [number, number]) => ({
  ...test(name, nesting, line, ids),
  suite: true,
});
const names = (tests: readonly ReportedTest[]) => identify(tests).map((t) => t.fullName);

describe("identify", () => {
  // Report order: every test after its subtests, as `test:pass` arrives on Node 22.
  const reported = [
    test("leaf", 1, 2),
    test("deep", 2, 4),
    suite("inner", 1, 3),
    suite("outer", 0, 1),
    test("child", 1, 8),
    test("parent", 0, 7),
    test("top", 0, 10),
  ];

  it("names from nesting and report order, suites as prefixes only", () => {
    expect(names(reported)).toEqual([
      "outer > leaf",
      "outer > inner > deep",
      "parent > child",
      "parent",
      "top",
    ]);
  });

  it("names from parentId when every test carries ids, whatever the order", () => {
    const withIds = [
      test("child", 1, 8, [5, 4]),
      test("leaf", 1, 2, [2, 1]),
      suite("outer", 0, 1, [1, 0]),
      test("deep", 2, 4, [6, 3]),
      suite("inner", 1, 3, [3, 1]),
      test("parent", 0, 7, [4, 0]),
    ];
    expect(names(withIds)).toEqual([
      "parent > child",
      "outer > leaf",
      "outer > inner > deep",
      "parent",
    ]);
  });

  it("lists each check's enclosing suites and tests, outermost first", () => {
    const deep = identify(reported).find((t) => t.test.name === "deep");
    expect(deep?.ancestors.map((a) => a.name)).toEqual(["outer", "inner"]);
  });

  it("is the same for the same tests", () => {
    expect(names(reported)).toEqual(names(reported.map((t) => ({ ...t }))));
  });
});

describe("suffixDuplicates", () => {
  it("suffixes the second and later by line, then by ordinal on one line", () => {
    expect(
      suffixDuplicates([
        { fullName: "a", line: 5 },
        { fullName: "a", line: 6 },
        { fullName: "b", line: 7 },
        { fullName: "a", line: 8 },
        { fullName: "a", line: 8 },
        { fullName: "a", line: 8 },
        { fullName: "a", line: null },
      ]),
    ).toEqual([
      "a",
      "a (line 6)",
      "b",
      "a (line 8)",
      "a (line 8, 2)",
      "a (line 8, 3)",
      "a (line ?)",
    ]);
  });
});
