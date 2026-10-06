import { describe, expect, it } from "vitest";
import {
  assembleClosure,
  createDeclaredInputs,
  inputGlobs,
  normalizeRelativePath,
  sameInputs,
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

  it("applies a list to every test file", () => {
    const files = ["fixtures/x.txt", "src/a.ts"];
    expect(selectDeclaredInputs(["fixtures/**"], files, "test/a.test.ts")).toEqual([
      "fixtures/x.txt",
    ]);
    expect(selectDeclaredInputs(["fixtures/**"], files, "test/b.test.ts")).toEqual([
      "fixtures/x.txt",
    ]);
  });

  describe("with a map from test-file glob to input globs (D3, D11 as amended)", () => {
    const files = ["dist/a.mjs", "dist/b.mjs", "fixtures/x.txt", "fixtures/y.json", "src/a.ts"];
    const inputs = {
      "test/harness/plugin.test.ts": ["dist/**"],
      "test/**/*.json.test.ts": ["fixtures/*.json"],
      "test/{a,b}.test.ts": ["fixtures/x.txt", "fixtures/*.json"],
    };

    it("applies only the input globs whose test-file glob matches the test file", () => {
      expect(selectDeclaredInputs(inputs, files, "test/harness/plugin.test.ts")).toEqual([
        "dist/a.mjs",
        "dist/b.mjs",
      ]);
      expect(selectDeclaredInputs(inputs, files, "test/deep/y.json.test.ts")).toEqual([
        "fixtures/y.json",
      ]);
      expect(selectDeclaredInputs(inputs, files, "test/a.test.ts")).toEqual([
        "fixtures/x.txt",
        "fixtures/y.json",
      ]);
      expect(selectDeclaredInputs(inputs, files, "test/other.test.ts")).toEqual([]);
    });

    it("selects every rule's inputs when no test file is named", () => {
      expect(selectDeclaredInputs(inputs, files)).toEqual([
        "dist/a.mjs",
        "dist/b.mjs",
        "fixtures/x.txt",
        "fixtures/y.json",
      ]);
    });

    it("answers per test file from one pass over the files", () => {
      const declared = createDeclaredInputs(inputs, files);
      expect(declared.for("test/harness/plugin.test.ts")).toEqual(["dist/a.mjs", "dist/b.mjs"]);
      expect(declared.for("test/b.test.ts")).toEqual(["fixtures/x.txt", "fixtures/y.json"]);
      expect(declared.for("src/a.ts")).toEqual([]);
      expect(declared.all).toEqual([
        "dist/a.mjs",
        "dist/b.mjs",
        "fixtures/x.txt",
        "fixtures/y.json",
      ]);
    });
  });
});

describe("inputGlobs", () => {
  it("lists every input glob of either shape, for telling whether a path is a declared input", () => {
    expect(inputGlobs(["a/**", "b/*"])).toEqual(["a/**", "b/*"]);
    expect(inputGlobs({ "test/a.test.ts": ["a/**"], "test/b.test.ts": ["b/*", "a/**"] })).toEqual([
      "a/**",
      "b/*",
    ]);
  });
});

describe("sameInputs", () => {
  it("compares lists in order and maps by their entries in any key order", () => {
    expect(sameInputs(["a"], ["a"])).toBe(true);
    expect(sameInputs(["a", "b"], ["b", "a"])).toBe(false);
    expect(sameInputs({ x: ["a"], y: ["b"] }, { y: ["b"], x: ["a"] })).toBe(true);
    expect(sameInputs({ x: ["a"] }, { x: ["b"] })).toBe(false);
    expect(sameInputs({ x: ["a"] }, ["a"])).toBe(false);
    expect(sameInputs([], {})).toBe(false);
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
