import { describe, expect, it } from "vitest";
import { entryNames } from "../../src/core/commit/at-keys-diff.js";
import {
  type CommitSide,
  changedInput,
  committedLockfile,
  type Difference,
  type HereSide,
} from "../../src/core/commit/at-keys-fast.js";

/*
 * Row 023-16: the fast path's nine conditions (`research/keys-by-walk.md`
 * 4), one at a time, on a commit and a worktree given as data. The real
 * runner cases are in `at-keys.test.ts`.
 */

const FILES = {
  "test/a.test.ts": "t1",
  "src/a.ts": "a1",
  "src/b.ts": "b1",
  "pnpm-lock.yaml": "l1",
  "package.json": "p1",
};
const INPUTS = {
  path: "test/a.test.ts",
  paths: ["test/a.test.ts", "src/a.ts", "src/a.json", "src/", "node_modules/.pnpm/lock.yaml"],
  closure: ["test/a.test.ts", "src/a.ts", "src/a.json", "src/"],
};

function commitOf(files: Record<string, string>): CommitSide {
  const blobs = new Map(Object.entries(files));
  return { blobs, names: entryNames(blobs.keys()) };
}

function hereOf(files: Record<string, string>, untracked: string[] = []): HereSide {
  const hashes = new Map(Object.entries(files));
  return {
    hashOf: (path) => hashes.get(path) ?? null,
    names: entryNames(hashes.keys()),
    untracked: new Set(untracked),
  };
}

function diffOf(changed: string[], options: Partial<Difference> = {}): Difference {
  return {
    changed: new Set(changed),
    addedOrDeleted: new Set(),
    manifests: new Set(),
    declared: () => [],
    ...options,
  };
}

const check = (
  commit: Record<string, string>,
  here: Record<string, string> = FILES,
  diff = diffOf([]),
  untracked: string[] = [],
  inputs = INPUTS,
) => changedInput(inputs, commitOf(commit), hereOf(here, untracked), diff);

describe("the fast path (row 023-16)", () => {
  it("keeps the key when every input is unchanged, an edit outside them included", () => {
    expect(check({ ...FILES, "src/b.ts": "b2" }, FILES, diffOf(["src/b.ts"]))).toBeNull();
  });

  it("1: refuses a changed blob, the test file's own included", () => {
    expect(check({ ...FILES, "src/a.ts": "a2" })).toBe("src/a.ts differs at the commit");
    expect(check({ ...FILES, "test/a.test.ts": "t2" })).toBe(
      "test/a.test.ts differs at the commit",
    );
  });

  it("2: refuses a resolution candidate absent here that exists at the commit, as a file or a folder", () => {
    expect(check({ ...FILES, "src/a.json": "j" })).toBe("src/a.json exists at the commit");
    expect(check({ ...FILES, "src/a.json/x.ts": "j" })).toBe("src/a.json exists at the commit");
  });

  it("3: refuses a listing whose names differ, and an empty one", () => {
    expect(check({ ...FILES, "src/c.ts": "c" })).toBe("src/ lists other names at the commit");
    const inputs = { ...INPUTS, paths: [...INPUTS.paths, "gen/"] };
    expect(check(FILES, FILES, diffOf([]), [], inputs)).toBe(
      "gen/ lists other names at the commit",
    );
  });

  it("4: refuses a changed path a pattern input names, and a declared input at the commit that is no input here", () => {
    const inputs = { ...INPUTS, paths: [...INPUTS.paths, "fixtures/**/*.json"] };
    const diff = diffOf(["fixtures/deep/x.json"]);
    expect(check(FILES, FILES, diff, [], inputs)).toBe(
      "fixtures/deep/x.json matches the input pattern fixtures/**/*.json",
    );
    // The test's declared inputs at the commit: one added since is an input here, checked by its blob.
    const declared = (paths: string[]) => diffOf([], { declared: () => paths });
    expect(check(FILES, FILES, declared(["data/x"]))).toBe(
      "data/x is a declared input at the commit, not here",
    );
    expect(check(FILES, FILES, declared(["src/a.ts"]))).toBeNull();
  });

  it("5: reads an installed lockfile as its committed lockfile", () => {
    expect(committedLockfile("node_modules/.pnpm/lock.yaml")).toBe("pnpm-lock.yaml");
    expect(committedLockfile("web/node_modules/.package-lock.json")).toBe("web/package-lock.json");
    expect(committedLockfile("src/a.ts")).toBeNull();
    expect(check({ ...FILES, "pnpm-lock.yaml": "l2" })).toBe(
      "pnpm-lock.yaml differs at the commit",
    );
  });

  it("6: refuses a file of any name added or deleted where the closure's imports resolve (review wave-5 B1, re-review B1)", () => {
    // `../../src/lib/a` resolves to a folder index under a configured extension.
    const deep = {
      "test/x/a.test.ts": "t1",
      "src/lib/a/index.custom": "i1",
      "src/lib/b.ts": "b1",
      "src/other/c.ts": "c1",
      "docs/a.md": "d1",
    };
    const closure = ["test/x/a.test.ts", "src/lib/a/index.custom"];
    const inputs = { path: "test/x/a.test.ts", paths: closure, closure };
    const moved = (path: string, commit: Record<string, string>, here: Record<string, string>) =>
      check(commit, here, diffOf([path], { addedOrDeleted: new Set([path]) }), [], inputs);
    const reason = (path: string, folder: string) =>
      `${path} was added or deleted in ${folder}, where the closure's imports resolve`;
    // The re-review's case: a same-named sibling of the folder, any extension, deleted since.
    const sibling = { ...deep, "src/lib/a.custom": "a1" };
    expect(moved("src/lib/a.custom", sibling, deep)).toBe(reason("src/lib/a.custom", "src/lib"));
    // Any name, in the folder of a closure file.
    expect(moved("src/lib/a/notes.md", deep, { ...deep, "src/lib/a/notes.md": "n" })).toBe(
      reason("src/lib/a/notes.md", "src/lib/a"),
    );
    // A new folder is a new entry in its parent.
    expect(moved("src/lib/new/x.ts", deep, { ...deep, "src/lib/new/x.ts": "x" })).toBe(
      reason("src/lib/new/x.ts", "src/lib"),
    );
    // Elsewhere, the key holds: another folder, and a new folder under an unguarded one.
    expect(moved("docs/b.md", deep, { ...deep, "docs/b.md": "b" })).toBeNull();
    expect(moved("src/other/d.ts", deep, { ...deep, "src/other/d.ts": "d" })).toBeNull();
    expect(moved("src/new/x.ts", deep, { ...deep, "src/new/x.ts": "x" })).toBeNull();
    // The root is guarded when a closure file lies in a top-level folder.
    const root = diffOf(["b.md"], { addedOrDeleted: new Set(["b.md"]) });
    expect(check(FILES, { ...FILES, "b.md": "b" }, root)).toBe(reason("b.md", "the root"));
  });

  it("7, 8: refuses a manifest's resolution change or a tsconfig change on the inputs' path, not elsewhere", () => {
    const manifest = diffOf(["package.json"], { manifests: new Set(["package.json"]) });
    expect(check(FILES, FILES, manifest)).toBe(
      "package.json changed on the resolution path of the inputs",
    );
    // A version bump: the manifest changed, its resolution fields did not.
    expect(check(FILES, FILES, diffOf(["package.json"]))).toBeNull();
    expect(check(FILES, FILES, diffOf(["src/tsconfig.json"]))).toBe(
      "src/tsconfig.json changed on the resolution path of the inputs",
    );
    const elsewhere = diffOf(["docs/package.json", "docs/tsconfig.json"], {
      manifests: new Set(["docs/package.json"]),
    });
    expect(check(FILES, FILES, elsewhere)).toBeNull();
  });

  it("refuses every file when the policy file changed", () => {
    expect(check(FILES, FILES, diffOf(["squeal.config.json"]))).toBe("squeal.config.json changed");
  });

  it("9: refuses an input git does not hold here", () => {
    expect(check(FILES, FILES, diffOf([]), ["src/a.ts"])).toBe("src/a.ts is not held by git here");
  });

  it("refuses a test file the commit lacks, and an input with no hash here", () => {
    const { "test/a.test.ts": _, ...without } = FILES;
    expect(check(without)).toBe("test/a.test.ts is absent at the commit");
    const unknown: HereSide = { ...hereOf(FILES), hashOf: () => undefined };
    expect(changedInput(INPUTS, commitOf(FILES), unknown, diffOf([]))).toBe(
      "test/a.test.ts has no hash here",
    );
  });
});
