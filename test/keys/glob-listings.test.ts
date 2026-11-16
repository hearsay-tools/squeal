import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GlobListings, globListingsMetaKey } from "../../src/core/keys/glob-listings.js";
import { isStoreOpenFailure, openStore } from "../../src/core/store/open.js";
import type { Store } from "../../src/core/types/store.js";

/*
 * Row 023-13 (fix A): the shared per-module glob listings. A walk's report
 * joins the view, a recursive folder as every listing below it; a closure
 * takes the listings of the modules it holds; a write merges into what
 * another worktree stored and never drops a path.
 */

let dir: string;
let store: Store;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sq-023-13-"));
  const opened = openStore(dir, { busyTimeoutMs: 10_000 });
  if (isStoreOpenFailure(opened)) throw new Error(`store: ${JSON.stringify(opened)}`);
  store = opened;
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

const below = (directory: string) => [`${directory}/`, `${directory}/deep/`];

describe("shared glob listings (row 023-13)", () => {
  it("gives a closure the listings of the modules it holds, a recursive folder with those below", () => {
    const globs = new GlobListings(store);
    globs.see(
      "",
      [
        { path: "src/registry.ts", directories: ["src/plugins"], recursive: [] },
        { path: "src/pages.ts", directories: ["", "src/pages"], recursive: ["src/pages"] },
      ],
      below,
    );
    expect(globs.of("", ["src/registry.ts", "test/a.test.ts"])).toEqual(["src/plugins/"]);
    expect(globs.of("", ["src/pages.ts"])).toEqual(["./", "src/pages/", "src/pages/deep/"]);
    expect(globs.of("other", ["src/registry.ts"])).toEqual([]);
  });

  it("stores on write, merges with another worktree's entries, and a new view reads them", () => {
    const mine = new GlobListings(store);
    const theirs = new GlobListings(store);
    mine.see("", [{ path: "src/a.ts", directories: ["src/x"], recursive: [] }], below);
    theirs.see("", [{ path: "src/a.ts", directories: ["src/y"], recursive: [] }], below);
    theirs.see("", [{ path: "src/b.ts", directories: ["src/z"], recursive: [] }], below);
    expect(store.meta.get(globListingsMetaKey(""))).toBeNull();
    mine.write();
    theirs.write();
    expect(JSON.parse(store.meta.get(globListingsMetaKey("")) ?? "")).toEqual({
      "src/a.ts": ["src/x/", "src/y/"],
      "src/b.ts": ["src/z/"],
    });
    expect(new GlobListings(store).of("", ["src/a.ts", "src/b.ts"])).toEqual([
      "src/x/",
      "src/y/",
      "src/z/",
    ]);
  });
});
