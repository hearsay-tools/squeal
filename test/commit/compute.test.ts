import { describe, expect, it } from "vitest";
import {
  type CommitView,
  deletedTestFiles,
  differingPaths,
  testCounts,
  testTally,
} from "../../src/core/commit/index.js";
import type { KnownState, TestFileKeyRecord, TestFileRef } from "../../src/core/types/index.js";
import { check, fileCheck, state } from "../status/helpers.js";

/*
 * Row 019-13 (spec 019 D5 step 2): the paths a commit and the working tree
 * hold apart, and each test file counted once from them. Row 019-28: only
 * the files a commit asked for run for it; files apart only through
 * untracked files are told apart from unstaged changes.
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
    expect(testCounts(v, { differing: new Set() })).toEqual({
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
    expect(testCounts(v, { differing: new Set(["src/a.ts"]) })).toMatchObject({
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
    expect(testCounts(v, { differing: new Set(["vitest.config.ts"]) })).toEqual({
      files: 3,
      failures: 0,
      notDetermined: 2,
      running: 0,
      unknown: 1,
    });
  });

  it("no current result: asked and queued or running is running; held or not queued is unknown; no key or no closure is unknown", () => {
    const D: TestFileRef = { project: "", path: "test/d.test.ts" };
    const v = view({
      closures: {
        [A.path]: [A.path, "src/a.ts"],
        [B.path]: [B.path, "src/b.ts"],
        [D.path]: [D.path, "src/d.ts"],
      },
      files: [row(A, "ka", "queued"), row(B, "kb"), row(C, "kc"), row(D, "kd", "running")],
      states: [
        state(W, check(A.path, "a"), { validity: "pending", pendingPhase: "queued" }),
        state(W, check(B.path, "b"), { outcome: "fail", validity: "stale" }),
      ],
    });
    const asked = (r: TestFileKeyRecord) => r.testFile.path === A.path;
    const held = (r: TestFileKeyRecord) => r.testFile.path === D.path;
    const tally = testTally(v, { differing: new Set(), asked, held });
    expect(tally.counts).toEqual({
      files: 4,
      failures: 0,
      notDetermined: 0,
      running: 1,
      unknown: 3,
    });
    expect(tally.running.map((r) => r.testFile)).toEqual([A]);
  });

  it("a queued or running file no commit asked for is left out: it runs at its own moment (019-28, P1)", () => {
    const v = view({
      closures,
      files: [row(A, "ka", "queued"), row(B, "kb", "running"), row(C, "kc")],
      states: [state(W, check(C.path, "c"), { outcome: "fail" })],
    });
    const tally = testTally(v, { differing: new Set() });
    expect(tally.counts).toEqual({
      files: 3,
      failures: 1,
      notDetermined: 0,
      running: 0,
      unknown: 0,
    });
    expect(tally.running).toEqual([]);
  });

  it("a file apart only through untracked files is counted apart from unstaged changes (019-28, P4)", () => {
    const v = view({
      closures: {
        [A.path]: [A.path, "src/a.ts", "src/new.ts"],
        [B.path]: [B.path, "src/b.ts", "src/new.ts"],
        [C.path]: [C.path, "src/c.ts"],
      },
      files: [row(A, "ka"), row(B, "kb"), row(C, "kc")],
    });
    const untracked = new Set(["src/new.ts", "notes.md"]);
    // A reads the untracked file only; B also reads a file staged differently; C reads neither.
    expect(testCounts(v, { differing: new Set([...untracked, "src/b.ts"]), untracked })).toEqual({
      files: 3,
      failures: 0,
      notDetermined: 2,
      untracked: 1,
      running: 0,
      unknown: 1,
    });
    // An untracked file no closure reads makes nothing not determined.
    const beside = new Set(["notes.md"]);
    expect(testCounts(v, { differing: beside, untracked: beside })).toEqual(
      testCounts(v, { differing: new Set() }),
    );
  });

  it("an untracked environment input makes every keyed file not determined through untracked files", () => {
    const v = view({
      closures,
      environment: ["vitest.setup.ts", "vitest.config.ts"],
      files: [row(A, "ka"), row(B, "kb")],
    });
    const untracked = new Set(["vitest.setup.ts"]);
    expect(testCounts(v, { differing: untracked, untracked })).toMatchObject({
      notDetermined: 2,
      untracked: 2,
    });
    const both = new Set(["vitest.setup.ts", "vitest.config.ts"]);
    expect(testCounts(v, { differing: both, untracked })).not.toHaveProperty("untracked");
  });

  it("matches states to files by project too", () => {
    const P: TestFileRef = { project: "p", path: A.path };
    const v = view({
      closures,
      files: [row(P, "kp")],
      states: [state(W, check(A.path, "root project's"), { outcome: "fail" })],
    });
    expect(testCounts(v, { differing: new Set() })).toMatchObject({ failures: 0, unknown: 1 });
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
    expect(testCounts(v, { differing: new Set(), deleted })).toEqual({
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
