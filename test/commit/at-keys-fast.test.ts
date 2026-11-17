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
    declared: () => false,
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

  it("4: refuses a changed path a pattern input or a declared input names", () => {
    const inputs = { ...INPUTS, paths: [...INPUTS.paths, "fixtures/**/*.json"] };
    const diff = diffOf(["fixtures/deep/x.json"]);
    expect(check(FILES, FILES, diff, [], inputs)).toBe(
      "fixtures/deep/x.json matches the input pattern fixtures/**/*.json",
    );
    expect(check(FILES, FILES, diffOf(["data/x"], { declared: (p) => p === "data/x" }))).toBe(
      "data/x is a declared input and changed",
    );
  });

  it("5: reads an installed lockfile as its committed lockfile", () => {
    expect(committedLockfile("node_modules/.pnpm/lock.yaml")).toBe("pnpm-lock.yaml");
    expect(committedLockfile("web/node_modules/.package-lock.json")).toBe("web/package-lock.json");
    expect(committedLockfile("src/a.ts")).toBeNull();
    expect(check({ ...FILES, "pnpm-lock.yaml": "l2" })).toBe(
      "pnpm-lock.yaml differs at the commit",
    );
  });

  it("6: refuses an added or deleted twin of an input module", () => {
    const diff = diffOf(["src/a.tsx"], { addedOrDeleted: new Set(["src/a.tsx"]) });
    expect(check(FILES, FILES, diff)).toBe(
      "src/a.tsx was added or deleted beside an input module of the same name",
    );
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
