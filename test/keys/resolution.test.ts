import { describe, expect, it } from "vitest";
import {
  closuresToReresolve,
  createInputMatcher,
  ReverseIndex,
} from "../../src/core/keys/index.js";
import type { FileChange, TestFileRef } from "../../src/core/types/index.js";

const ref = (path: string): TestFileRef => ({ project: "unit", path });
const add = (path: string): FileChange => ({ path, oldHash: null, newHash: "h" });
const del = (path: string): FileChange => ({ path, oldHash: "h", newHash: null });
const edit = (path: string): FileChange => ({ path, oldHash: "h1", newHash: "h2" });

const importsSrc = ref("test/src.test.ts");
const importsFoo = ref("test/foo.test.ts");
const importsLib = ref("test/lib.test.ts");
const rootSetup = ref("test/root.test.ts");
const importsPkg = ref("test/pkg.test.ts");

const build = () => {
  const index = new ReverseIndex();
  index.set(importsSrc, ["src/a.ts", "test/src.test.ts"]);
  index.set(importsFoo, ["src/foo/index.ts", "src/foo/impl.ts", "test/foo.test.ts"]);
  index.set(importsLib, ["lib/c.ts", "test/lib.test.ts"]);
  index.set(rootSetup, ["setup.ts", "test/root.test.ts"]);
  index.set(importsPkg, ["src/pkg/lib/entry.ts", "test/pkg.test.ts"]);
  return index;
};
const none = createInputMatcher([]);
const paths = (refs: readonly TestFileRef[]) => refs.map((r) => r.path);

describe("closuresToReresolve", () => {
  it("ignores content changes, which keep resolution as it was", () => {
    expect(closuresToReresolve([edit("src/a.ts"), edit("src/new.ts")], build(), none)).toEqual([]);
  });

  // Task 001-72, reviews/wave-9.md S1 and S2: the cases neither `rekey` nor the
  // runner's `affected` reports (test/runners/vitest/reresolution.test.ts).
  // "./foo" resolved to src/foo/index.ts, "./pkg" to src/pkg/lib/entry.ts.
  it("picks importers of a directory whose package.json was added", () => {
    // Its `main` may now win over the index.
    expect(paths(closuresToReresolve([add("src/foo/package.json")], build(), none))).toEqual([
      "test/foo.test.ts",
    ]);
  });

  it("picks importers of a directory whose package.json was deleted", () => {
    // Its `main` gave way to the index.
    expect(paths(closuresToReresolve([del("src/foo/package.json")], build(), none))).toEqual([
      "test/foo.test.ts",
    ]);
  });

  it("picks importers below a directory whose package.json was deleted", () => {
    // Its `main` named lib/entry.ts; the directory falls back to its index.
    expect(paths(closuresToReresolve([del("src/pkg/package.json")], build(), none))).toEqual([
      "test/pkg.test.ts",
    ]);
  });

  it("picks importers below a directory whose package.json was edited", () => {
    // Its `main` may now name another entry, or none.
    const edits = [edit("src/pkg/package.json"), edit("src/foo/package.json")];
    expect(paths(closuresToReresolve(edits, build(), none))).toEqual([
      "test/foo.test.ts",
      "test/pkg.test.ts",
    ]);
  });

  it("picks nothing for a package.json below the directory a closure resolves", () => {
    // "./foo" still resolves to src/foo/index.ts.
    expect(closuresToReresolve([add("src/foo/inner/package.json")], build(), none)).toEqual([]);
  });

  it("picks only importers of root files for the root package.json", () => {
    // A package importing itself by name is not modelled.
    expect(paths(closuresToReresolve([edit("package.json")], build(), none))).toEqual([
      "test/root.test.ts",
    ]);
  });

  it("picks importers of a directory that a new file of the same name shadows", () => {
    // "./foo" resolved to src/foo/index.ts; a new src/foo.ts wins over the directory.
    expect(paths(closuresToReresolve([add("src/foo.ts")], build(), none))).toEqual([
      "test/foo.test.ts",
      "test/src.test.ts",
    ]);
  });

  it("picks importers of the parent directory when an index file appears or goes", () => {
    // "./bar" in src/ may now resolve to src/bar/index.ts.
    expect(paths(closuresToReresolve([add("src/bar/index.ts")], build(), none))).toEqual([
      "test/src.test.ts",
    ]);
  });

  it("handles files at the worktree root", () => {
    expect(paths(closuresToReresolve([add("setup.js")], build(), none))).toEqual([
      "test/root.test.ts",
    ]);
  });

  it("picks every test file when a declared input is added or deleted", () => {
    const inputs = createInputMatcher(["fixtures/**"]);
    expect(closuresToReresolve([add("fixtures/new.json")], build(), inputs)).toHaveLength(5);
    expect(closuresToReresolve([del("fixtures/old.json")], build(), inputs)).toHaveLength(5);
    expect(closuresToReresolve([edit("fixtures/old.json")], build(), inputs)).toEqual([]);
  });

  it("returns nothing for an add in a directory no closure imports from", () => {
    expect(closuresToReresolve([add("docs/readme.md")], build(), none)).toEqual([]);
  });

  it("returns each test file once, sorted by project and path", () => {
    const result = closuresToReresolve(
      [add("src/x.ts"), del("src/y.ts"), add("lib/z.ts")],
      build(),
      none,
    );
    expect(paths(result)).toEqual(["test/lib.test.ts", "test/src.test.ts"]);
  });
});
