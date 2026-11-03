import { describe, expect, it } from "vitest";
import {
  type CommitView,
  deletedTestFiles,
  differingPaths,
  testCounts,
} from "../../src/core/commit/index.js";
import type { KnownState, TestFileKeyRecord, TestFileRef } from "../../src/core/types/index.js";
import { check, fileCheck, state } from "../status/helpers.js";

/*
 * Row 019-13 (spec 019 D5 step 2): the paths a commit and the working tree
 * hold apart, and each test file counted once from them.
 */

const W = "w1";
const A: TestFileRef = { project: "", path: "test/a.test.ts" };
const B: TestFileRef = { project: "", path: "test/b.test.ts" };
const C: TestFileRef = { project: "", path: "test/c.test.ts" };

interface Fake {
  readonly hashes?: Record<string, string | null>;
  readonly closures?: Record<string, readonly string[]>;
  readonly environment?: readonly string[];
  readonly ignored?: readonly string[];
  readonly files?: readonly TestFileKeyRecord[];
  readonly states?: readonly KnownState[];
  /** The test files `test_files` holds. */
  readonly known?: readonly TestFileRef[];
  /** The paths on disk beside those `hashes` holds a blob for. */
  readonly disk?: readonly string[];
}

function view(fake: Fake): CommitView & { asked: string[][]; looked: string[] } {
  const hashes = fake.hashes ?? {};
  const asked: string[][] = [];
  const looked: string[] = [];
  return {
    asked,
    looked,
    hashOf: (path) => (path in hashes ? hashes[path] : undefined),
    paths: () => Object.keys(hashes),
    closure: (ref) => fake.closures?.[ref.path],
    isEnvironmentInput: (path) => fake.environment?.includes(path) ?? false,
    ignoredAmong: async (paths) => {
      asked.push([...paths]);
      return new Set(paths.filter((p) => fake.ignored?.includes(p)));
    },
    testFiles: () => fake.files ?? [],
    states: () => fake.states ?? [],
    knownTestFile: (ref) =>
      fake.known?.some((k) => k.project === ref.project && k.path === ref.path) ?? false,
    onDisk: async (path) => {
      looked.push(path);
      return fake.disk?.includes(path) ?? false;
    },
  };
}

const row = (
  testFile: TestFileRef,
  key: string | null,
  pending: "queued" | "running" | null = null,
): TestFileKeyRecord => ({ worktreeId: W, testFile, key, revision: 1, pending });

describe("differingPaths: the working tree against the commit (019-13)", () => {
  it("names a changed blob, a deleted file and an untracked file; not an ignored one", async () => {
    const v = view({
      hashes: {
        "src/same.ts": "s1",
        "src/edited.ts": "e2",
        "src/gone.ts": null,
        "src/new.ts": "n1",
        "dist/built.js": "d1",
      },
      ignored: ["dist/built.js"],
    });
    const committed = new Map([
      ["src/same.ts", "s1"],
      ["src/edited.ts", "e1"],
      ["src/gone.ts", "g1"],
    ]);
    const differing = await differingPaths(v, committed);
    expect([...differing].sort()).toEqual(["src/edited.ts", "src/gone.ts", "src/new.ts"]);
    expect(v.asked).toEqual([["src/new.ts", "dist/built.js"]]);
  });

  it("leaves out a path the hash source does not track, and asks git nothing when no file is new", async () => {
    const v = view({ hashes: { "src/a.ts": "a1" } });
    const committed = new Map([
      ["src/a.ts", "a1"],
      ["src/untracked-by-cache.ts", "u1"],
    ]);
    const differing = await differingPaths(v, committed);
    expect([...differing]).toEqual([]);
    expect(v.asked).toEqual([]);
  });
});

describe("testCounts: each test file once (019-13)", () => {
  const closures = {
    [A.path]: [A.path, "src/a.ts"],
    [B.path]: [B.path, "src/b.ts"],
    [C.path]: [C.path, "src/c.ts"],
  };

  it("counts current failing checks of a file at the committed key", () => {
    const v = view({
      closures,
      files: [row(A, "ka"), row(B, "kb")],
      states: [
        state(W, check(A.path, "a fails"), { outcome: "fail" }),
        state(W, check(A.path, "a passes")),
        state(W, check(B.path, "b fails"), { outcome: "fail" }),
        state(W, check(B.path, "b fails too"), { outcome: "fail" }),
      ],
    });
    expect(testCounts(v, new Set())).toEqual({
      files: 2,
      failures: 3,
      notDetermined: 0,
      running: 0,
      unknown: 0,
    });
  });

  it("a file whose closure differs is not determined, whatever its states say", () => {
    const v = view({
      closures,
      files: [row(A, "ka"), row(B, "kb")],
      states: [state(W, fileCheck(A.path), { outcome: "fail" }), state(W, check(B.path, "b"))],
    });
    expect(testCounts(v, new Set(["src/a.ts"]))).toMatchObject({
      failures: 0,
      notDetermined: 1,
    });
  });

  it("a differing environment input makes every keyed file not determined", () => {
    const v = view({
      closures,
      environment: ["vitest.config.ts"],
      files: [row(A, "ka"), row(B, "kb"), row(C, null)],
      states: [state(W, check(A.path, "a"))],
    });
    expect(testCounts(v, new Set(["vitest.config.ts"]))).toEqual({
      files: 3,
      failures: 0,
      notDetermined: 2,
      running: 0,
      unknown: 1,
    });
  });

  it("no current result: queued or running is running, else unknown; no key or no closure is unknown", () => {
    const v = view({
      closures: { [A.path]: [A.path, "src/a.ts"], [B.path]: [B.path, "src/b.ts"] },
      files: [row(A, "ka", "queued"), row(B, "kb"), row(C, "kc")],
      states: [
        state(W, check(A.path, "a"), { validity: "pending", pendingPhase: "queued" }),
        state(W, check(B.path, "b"), { outcome: "fail", validity: "stale" }),
      ],
    });
    expect(testCounts(v, new Set())).toEqual({
      files: 3,
      failures: 0,
      notDetermined: 0,
      running: 1,
      unknown: 2,
    });
  });

  it("matches states to files by project too", () => {
    const P: TestFileRef = { project: "p", path: A.path };
    const v = view({
      closures,
      files: [row(P, "kp")],
      states: [state(W, check(A.path, "root project's"), { outcome: "fail" })],
    });
    expect(testCounts(v, new Set())).toMatchObject({ failures: 0, unknown: 1 });
  });
});

describe("deletedTestFiles: the commit's test files the working tree deleted (review 0.1.396 S3)", () => {
  const listed = [row(A, "ka")];

  it("a known test file the commit holds and no listing names, with no file, is not determined", async () => {
    const v = view({
      closures: { [A.path]: [A.path, "src/a.ts"] },
      files: listed,
      hashes: { [B.path]: null },
      known: [A, B, C],
    });
    const committed = new Map([
      [A.path, "a1"],
      [B.path, "b1"],
      [C.path, "c1"],
      ["src/a.ts", "s1"],
    ]);
    const deleted = await deletedTestFiles(v, committed);
    // B is known absent; C is not tracked, so its disk is looked at; `src/a.ts` is no test file.
    expect(deleted).toEqual([B, C]);
    expect(v.looked).toEqual([C.path]);
    expect(testCounts(v, new Set(), deleted)).toEqual({
      files: 3,
      failures: 0,
      notDetermined: 2,
      running: 0,
      unknown: 1,
    });
  });

  it("not a deletion: a file still on disk, one at another blob, a listed one, an unknown path", async () => {
    const v = view({
      files: listed,
      hashes: { [C.path]: "c2" },
      known: [A, B, C],
      disk: [B.path],
    });
    const committed = new Map([
      [A.path, "a1"],
      [B.path, "b1"],
      [C.path, "c1"],
      ["test/never-listed.test.ts", "n1"],
    ]);
    expect(await deletedTestFiles(v, committed)).toEqual([]);
    expect(v.looked).toEqual([B.path]);
  });

  it("names the listed project that knew the file", async () => {
    const P: TestFileRef = { project: "p", path: A.path };
    const gone: TestFileRef = { project: "p", path: B.path };
    const v = view({ files: [row(P, "kp")], known: [gone] });
    expect(await deletedTestFiles(v, new Map([[B.path, "b1"]]))).toEqual([gone]);
  });
});
