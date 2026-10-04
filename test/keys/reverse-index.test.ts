import { describe, expect, it } from "vitest";
import { ReverseIndex } from "../../src/core/keys/index.js";
import type { TestFileRef } from "../../src/core/types/index.js";

const a: TestFileRef = { project: "unit", path: "test/a.test.ts" };
const b: TestFileRef = { project: "unit", path: "test/b.test.ts" };
const e2e: TestFileRef = { project: "e2e", path: "test/a.test.ts" };

const sorted = (refs: readonly TestFileRef[]) => refs.map((r) => `${r.project}:${r.path}`).sort();

describe("ReverseIndex", () => {
  const build = () => {
    const index = new ReverseIndex();
    index.set(a, ["src/x.ts", "src/util/y.ts", "test/a.test.ts"]);
    index.set(b, ["src/x.ts", "test/b.test.ts"]);
    index.set(e2e, ["src/z.ts", "test/a.test.ts"]);
    return index;
  };

  it("maps a path to every test file whose closure references it", () => {
    const index = build();
    expect(sorted(index.referencing(["src/x.ts"]))).toEqual([
      "unit:test/a.test.ts",
      "unit:test/b.test.ts",
    ]);
    expect(sorted(index.referencing(["test/a.test.ts"]))).toEqual([
      "e2e:test/a.test.ts",
      "unit:test/a.test.ts",
    ]);
    expect(index.referencing(["src/none.ts"])).toEqual([]);
  });

  it("de-duplicates test files across several paths", () => {
    expect(build().referencing(["src/x.ts", "src/util/y.ts", "test/b.test.ts"])).toHaveLength(2);
  });

  it("replaces a test file's paths on set and forgets them on remove", () => {
    const index = build();
    index.set(a, ["src/new.ts"]);
    expect(sorted(index.referencing(["src/x.ts"]))).toEqual(["unit:test/b.test.ts"]);
    expect(sorted(index.referencing(["src/new.ts"]))).toEqual(["unit:test/a.test.ts"]);
    index.remove(b);
    expect(index.referencing(["src/x.ts"])).toEqual([]);
    expect(index.size).toBe(2);
  });

  it("finds test files by closure paths directly in a directory", () => {
    const index = build();
    expect(sorted(index.inDirectory("src"))).toEqual([
      "e2e:test/a.test.ts",
      "unit:test/a.test.ts",
      "unit:test/b.test.ts",
    ]);
    expect(sorted(index.inDirectory("src/util"))).toEqual(["unit:test/a.test.ts"]);
    expect(index.inDirectory("lib")).toEqual([]);
  });

  it("finds test files by closure paths anywhere below a directory", () => {
    const index = build();
    expect(sorted(index.below("src/util"))).toEqual(["unit:test/a.test.ts"]);
    expect(sorted(index.below("src"))).toHaveLength(3);
    expect(index.below("sr")).toEqual([]);
  });

  it("treats the worktree root as the directory of top-level files", () => {
    const index = new ReverseIndex();
    index.set(a, ["setup.ts"]);
    expect(index.inDirectory("")).toEqual([a]);
  });

  it("forgets directories once no closure path is left in them", () => {
    const index = build();
    index.remove(a);
    expect(index.inDirectory("src/util")).toEqual([]);
  });
});
