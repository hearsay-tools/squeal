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

const build = () => {
  const index = new ReverseIndex();
  index.set(importsSrc, ["src/a.ts", "test/src.test.ts"]);
  index.set(importsFoo, ["src/foo/index.ts", "src/foo/impl.ts", "test/foo.test.ts"]);
  index.set(importsLib, ["lib/c.ts", "test/lib.test.ts"]);
  index.set(rootSetup, ["setup.ts", "test/root.test.ts"]);
  return index;
};
const none = createInputMatcher([]);
const paths = (refs: readonly TestFileRef[]) => refs.map((r) => r.path);

describe("closuresToReresolve", () => {
  it("ignores content changes, which keep resolution as it was", () => {
    expect(closuresToReresolve([edit("src/a.ts"), edit("src/new.ts")], build(), none)).toEqual([]);
  });

  it("picks test files importing from the directory a file was added to", () => {
    // src/a.js beside src/a.ts can change what "./a" resolves to.
    expect(paths(closuresToReresolve([add("src/a.js")], build(), none))).toEqual([
      "test/src.test.ts",
    ]);
  });

  it("picks test files importing from the directory a file was deleted from", () => {
    expect(paths(closuresToReresolve([del("lib/other.ts")], build(), none))).toEqual([
      "test/lib.test.ts",
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
    expect(closuresToReresolve([add("fixtures/new.json")], build(), inputs)).toHaveLength(4);
    expect(closuresToReresolve([del("fixtures/old.json")], build(), inputs)).toHaveLength(4);
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
