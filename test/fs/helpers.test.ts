import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  compare,
  isMissing,
  isRecord,
  sameList,
  toAbsolute,
  toRelative,
} from "../../src/core/fs/index.js";

const ROOT = "/repo";
const errno = (code: string) => Object.assign(new Error(code), { code });

describe("isMissing", () => {
  // Only the hash copy treated EISDIR as missing; lstat and readdir callers never see it.
  it("treats ENOENT, ENOTDIR and EISDIR as missing", () => {
    expect(isMissing(errno("ENOENT"))).toBe(true);
    expect(isMissing(errno("ENOTDIR"))).toBe(true);
    expect(isMissing(errno("EISDIR"))).toBe(true);
  });

  it("treats every other error as real", () => {
    expect(isMissing(errno("EACCES"))).toBe(false);
    expect(isMissing(new Error("plain"))).toBe(false);
    expect(isMissing(null)).toBe(false);
  });
});

describe("toRelative", () => {
  it("relativizes paths inside the root with / separators", () => {
    expect(toRelative(ROOT, join(ROOT, "src", "a.ts"))).toBe("src/a.ts");
  });

  it("returns null for the root itself and for paths outside it", () => {
    expect(toRelative(ROOT, ROOT)).toBeNull();
    expect(toRelative(ROOT, "/")).toBeNull();
    expect(toRelative(ROOT, "/other/a.ts")).toBeNull();
    expect(toRelative(ROOT, "/repo-sibling/a.ts")).toBeNull();
  });

  // The watcher copy (`rel.startsWith("..")`) rejected these; the adapter copy did not.
  it("keeps root-level entries whose name starts with ..", () => {
    expect(toRelative(ROOT, join(ROOT, "..foo"))).toBe("..foo");
    expect(toRelative(ROOT, join(ROOT, "..foo", "a.ts"))).toBe("..foo/a.ts");
  });
});

describe("toAbsolute", () => {
  it("joins a relative path onto the root", () => {
    expect(toAbsolute(ROOT, "src/a.ts")).toBe(join(ROOT, "src", "a.ts"));
    expect(toRelative(ROOT, toAbsolute(ROOT, "..foo/a.ts"))).toBe("..foo/a.ts");
  });
});

describe("compare", () => {
  it("orders by UTF-16 code unit, not locale", () => {
    expect(["b", "a", "B", "ä", "Z"].sort(compare)).toEqual(["B", "Z", "a", "b", "ä"]);
    expect(compare("a", "a")).toBe(0);
  });
});

describe("sameList", () => {
  it("is true only for the same strings in the same order", () => {
    expect(sameList(["a", "b"], ["a", "b"])).toBe(true);
    expect(sameList([], [])).toBe(true);
    expect(sameList(["a", "b"], ["b", "a"])).toBe(false);
    expect(sameList(["a"], ["a", "b"])).toBe(false);
  });
});

describe("isRecord", () => {
  it("is true only for a JSON object", () => {
    expect(isRecord({ a: 1 })).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(isRecord("text")).toBe(false);
  });
});
