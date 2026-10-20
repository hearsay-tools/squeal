import { describe, expect, it } from "vitest";
import { namesakesOf } from "../../src/core/scheduler/namesakes.js";

/*
 * Task 011-25 (spec 011 C4 step 4 as amended 2026-10-20, `research/edit-cut.md`
 * done-when 2): a source's namesakes are the test files of its name beside
 * it, in its `__tests__` or in a test tree mirroring its path below `src/`;
 * failing those, the only test file of its name; an `index` has none.
 */
describe("namesakesOf (C4 step 4, task 011-25)", () => {
  it("finds a sibling with .test or .spec before any JS or TS extension", () => {
    const tests = ["src/runs/store.test.ts", "src/runs/store.spec.mjs", "src/runs/other.test.ts"];
    expect(namesakesOf("src/runs/store.ts", tests)).toEqual([
      "src/runs/store.test.ts",
      "src/runs/store.spec.mjs",
    ]);
  });

  it("finds a file of its name in its __tests__, with or without .test", () => {
    expect(namesakesOf("lib/a/b.js", ["lib/a/__tests__/b.js", "lib/a/__tests__/c.test.js"])).toEqual(
      ["lib/a/__tests__/b.js"],
    );
    expect(namesakesOf("lib/a/b.js", ["lib/a/__tests__/b.test.ts"])).toEqual([
      "lib/a/__tests__/b.test.ts",
    ]);
  });

  it("finds a mirrored test/x/b.test.ts for src/x/b.ts, under a package too", () => {
    const tests = ["test/x/b.test.ts", "test/y/b.test.ts"];
    expect(namesakesOf("src/x/b.ts", tests)).toEqual(["test/x/b.test.ts"]);
    expect(namesakesOf("packages/p/src/b.ts", ["packages/p/tests/b.test.ts", "test/b.test.ts"])).toEqual(
      ["packages/p/tests/b.test.ts"],
    );
  });

  it("finds the only c.test.ts of the tree for src/deep/c.ts", () => {
    expect(namesakesOf("src/deep/c.ts", ["test/elsewhere/c.test.ts", "test/d.test.ts"])).toEqual([
      "test/elsewhere/c.test.ts",
    ]);
  });

  it("finds pytest's tests/test_d.py and pkg/d_test.py for pkg/d.py", () => {
    expect(namesakesOf("pkg/d.py", ["tests/test_d.py", "tests/test_e.py"])).toEqual([
      "tests/test_d.py",
    ]);
    expect(namesakesOf("pkg/d.py", ["pkg/d_test.py", "pkg/test_e.py"])).toEqual(["pkg/d_test.py"]);
    expect(namesakesOf("pkg/d.py", ["pkg/test_d.py"])).toEqual(["pkg/test_d.py"]);
    // A sibling wins over the only one elsewhere: the anywhere match is a fallback.
    expect(namesakesOf("pkg/d.py", ["pkg/d_test.py", "tests/test_d.py"])).toEqual(["pkg/d_test.py"]);
    // A mirrored pytest tree below `src/`.
    expect(namesakesOf("src/pkg/d.py", ["tests/pkg/test_d.py", "tests/other/test_d.py"])).toEqual([
      "tests/pkg/test_d.py",
    ]);
  });

  it("gives none for two e.test.ts in other directories and no sibling", () => {
    expect(namesakesOf("src/e.ts", ["test/a/e.test.ts", "test/b/e.test.ts"])).toEqual([]);
  });

  it("gives an index file none, however its directory's tests are named", () => {
    expect(namesakesOf("src/keys/index.ts", ["src/keys/index.test.ts", "test/index.test.ts"])).toEqual(
      [],
    );
  });

  it("matches within a language only, and gives a non-code source none", () => {
    expect(namesakesOf("src/a.py", ["src/a.test.ts"])).toEqual([]);
    expect(namesakesOf("src/a.ts", ["src/test_a.py"])).toEqual([]);
    expect(namesakesOf("config/a.json", ["config/a.test.ts"])).toEqual([]);
  });

  it("is not its own namesake, and a test file without a test mark outside __tests__ is none", () => {
    expect(namesakesOf("src/a.ts", ["src/a.ts"])).toEqual([]);
    expect(namesakesOf("src/a.ts", ["test/a.ts"])).toEqual([]);
  });
});
