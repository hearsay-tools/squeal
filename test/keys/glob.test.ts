import { describe, expect, it } from "vitest";
import { createInputMatcher, globToRegExp } from "../../src/core/keys/index.js";

const matches = (glob: string, path: string): boolean => globToRegExp(glob).test(path);

describe("globToRegExp", () => {
  it("matches literal paths exactly", () => {
    expect(matches("test/data.json", "test/data.json")).toBe(true);
    expect(matches("test/data.json", "test/data.jsonx")).toBe(false);
    expect(matches("test/data.json", "other/test/data.json")).toBe(false);
  });

  it("keeps * and ? inside one path segment", () => {
    expect(matches("test/*.json", "test/a.json")).toBe(true);
    expect(matches("test/*.json", "test/sub/a.json")).toBe(false);
    expect(matches("test/?.json", "test/a.json")).toBe(true);
    expect(matches("test/?.json", "test/ab.json")).toBe(false);
  });

  it("lets ** cross zero or more segments", () => {
    expect(matches("test/**/*.json", "test/a.json")).toBe(true);
    expect(matches("test/**/*.json", "test/x/y/a.json")).toBe(true);
    expect(matches("**/fixtures/**", "a/fixtures/b/c.txt")).toBe(true);
    expect(matches("**/fixtures/**", "fixtures/c.txt")).toBe(true);
    expect(matches("test/**", "test")).toBe(false);
    expect(matches("test/**", "testing/a")).toBe(false);
  });

  it("supports braces, nested braces and character classes", () => {
    expect(matches("data/*.{json,yaml}", "data/a.yaml")).toBe(true);
    expect(matches("data/*.{json,yaml}", "data/a.txt")).toBe(false);
    expect(matches("{a,b/{c,d}}/x", "b/d/x")).toBe(true);
    expect(matches("file[0-9].txt", "file7.txt")).toBe(true);
    expect(matches("file[!0-9].txt", "file7.txt")).toBe(false);
    expect(matches("file[!0-9].txt", "filex.txt")).toBe(true);
  });

  it("escapes regular expression characters and matches dotfiles", () => {
    expect(matches("a+b(1).txt", "a+b(1).txt")).toBe(true);
    expect(matches("a.txt", "aXtxt")).toBe(false);
    expect(matches("fixtures/*", "fixtures/.env")).toBe(true);
  });

  it("ignores a leading ./", () => {
    expect(matches("./test/*.json", "test/a.json")).toBe(true);
  });

  it("rejects absolute and negated globs", () => {
    expect(() => globToRegExp("/etc/*")).toThrow("/etc/*");
    expect(() => globToRegExp("!test/*")).toThrow("!test/*");
  });
});

describe("createInputMatcher", () => {
  it("matches a path against any of several globs", () => {
    const match = createInputMatcher(["test/data/**", "*.config.json"]);
    expect(match("test/data/a/b.json")).toBe(true);
    expect(match("app.config.json")).toBe(true);
    expect(match("src/a.ts")).toBe(false);
  });

  it("matches nothing without globs", () => {
    expect(createInputMatcher([])("anything")).toBe(false);
  });
});
