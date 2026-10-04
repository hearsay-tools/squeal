import { describe, expect, it } from "vitest";
import {
  assembleClosure,
  normalizeRelativePath,
  selectDeclaredInputs,
} from "../../src/core/keys/index.js";
import type { RunnerClosure } from "../../src/core/types/index.js";

const testFile = { project: "unit", path: "test/a.test.ts" };

describe("normalizeRelativePath", () => {
  it("uses / separators and drops ./ and empty segments", () => {
    expect(normalizeRelativePath("./src//a.ts")).toBe("src/a.ts");
    expect(normalizeRelativePath("src\\util\\b.ts")).toBe("src/util/b.ts");
    expect(normalizeRelativePath("src/x/../a.ts")).toBe("src/a.ts");
  });

  it("rejects absolute paths and paths leaving the worktree", () => {
    expect(() => normalizeRelativePath("/abs/a.ts")).toThrow("/abs/a.ts");
    expect(() => normalizeRelativePath("C:\\abs\\a.ts")).toThrow("C:\\abs\\a.ts");
    expect(() => normalizeRelativePath("../outside.ts")).toThrow("../outside.ts");
    expect(() => normalizeRelativePath("")).toThrow();
  });
});

describe("selectDeclaredInputs", () => {
  it("returns the files matching any policy input glob, sorted", () => {
    const files = ["test/data/b.json", "src/a.ts", "test/data/a.json", "fixtures/x.txt"];
    expect(selectDeclaredInputs(["test/data/*.json", "fixtures/**"], files)).toEqual([
      "fixtures/x.txt",
      "test/data/a.json",
      "test/data/b.json",
    ]);
    expect(selectDeclaredInputs([], files)).toEqual([]);
  });
});

describe("assembleClosure", () => {
  const runner: RunnerClosure = {
    testFile,
    paths: ["src/b.ts", "./src/a.ts", "test/__snapshots__/a.test.ts.snap", "src/b.ts"],
  };

  it("adds the test file and declared inputs, sorts and de-duplicates", () => {
    const closure = assembleClosure(runner, ["test/data/x.json", "src/a.ts"]);
    expect(closure).toEqual({
      testFile,
      paths: [
        "src/a.ts",
        "src/b.ts",
        "test/__snapshots__/a.test.ts.snap",
        "test/a.test.ts",
        "test/data/x.json",
      ],
      complete: false,
      method: "static imports plus declared inputs",
    });
  });

  it("excludes node_modules at any depth", () => {
    const closure = assembleClosure(
      { testFile, paths: ["node_modules/x/index.js", "packages/a/node_modules/y.js", "src/a.ts"] },
      [],
    );
    expect(closure.paths).toEqual(["src/a.ts", "test/a.test.ts"]);
  });

  it("names the test file when a runner path is invalid", () => {
    expect(() => assembleClosure({ testFile, paths: ["/abs/x.ts"] }, [])).toThrow("test/a.test.ts");
  });
});
