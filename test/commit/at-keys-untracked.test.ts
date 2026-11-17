import { describe, expect, it } from "vitest";
import { untrackedBy } from "../../src/core/commit/at-keys-untracked.js";

/*
 * Row 023-16, fast-path condition 9: an input whose content here comes from
 * a file git does not hold, by `git status` entries.
 */

const entries = [
  { path: "gen/", ignored: true },
  { path: "src/new.ts", ignored: false },
  { path: "src/out.js", ignored: true },
  { path: "src/deep/", ignored: false },
];

describe("untrackedBy", () => {
  it("names a file that is an entry, or lies under a folder entry", () => {
    expect(untrackedBy("src/new.ts", entries)).toBe(true);
    expect(untrackedBy("gen/types.ts", entries)).toBe(true);
    expect(untrackedBy("src/a.ts", entries)).toBe(false);
  });

  it("names a listing with an untracked entry directly in it, not an ignored one", () => {
    expect(untrackedBy("src/", entries)).toBe(true);
    expect(untrackedBy("lib/", [{ path: "lib/out.js", ignored: true }])).toBe(false);
    expect(untrackedBy("lib/", [{ path: "lib/a/b.ts", ignored: false }])).toBe(false);
  });

  it("names a listing under an untracked or ignored folder", () => {
    expect(untrackedBy("gen/sub/", entries)).toBe(true);
    expect(untrackedBy("./", [{ path: "top.ts", ignored: false }])).toBe(true);
  });
});
