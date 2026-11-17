import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type KeyAt, keysAtCommit, mixedBlobs, sideKeys } from "../../src/core/commit/at-keys.js";
import { untrackedBy } from "../../src/core/commit/at-keys-untracked.js";
import { testFileId } from "../../src/core/keys/reverse-index.js";
import type { Store } from "../../src/core/types/store.js";
import { git } from "../hash/git-repo.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import {
  type CatchUpFile,
  type CatchUpSide,
  catchUpRepo,
  catchUpSide,
} from "../scheduler/catch-up-fixture.js";

/*
 * Spec 023 D2 (row 023-03): keys at a commit, computed from this worktree's
 * closure lists over the commit's blobs, equal the keys a daemon at that
 * commit computes. One repository, two worktrees on one store: `other`
 * stays at the first commit, `main` moves to a second that changes one
 * source file and stops tracking another, which stays on disk. Both run a
 * daemon (a real scheduler over a fake runner); `main` then asks for the
 * keys at each commit, and for D5.1's mixed sides.
 */

const A = "test/a.test.ts";
const B = "test/b.test.ts";
const C = "test/c.test.ts";
const FILES: CatchUpFile[] = [
  { path: A, ms: 10, imports: ["src/a.ts"] },
  { path: B, ms: 10, imports: ["src/b.ts"] },
  { path: C, ms: 10, imports: ["src/c.ts"] },
];

const id = (path: string) => testFileId({ project: "", path });

async function started(side: CatchUpSide): Promise<void> {
  await side.scheduler.start();
  await side.quiet();
}

/** Each listed file's current key in `worktreeId`, by `testFileId`. */
function keysIn(store: Store, worktreeId: string): Map<string, string | null> {
  return new Map(store.testFileKeys.list(worktreeId).map((r) => [testFileId(r.testFile), r.key]));
}

const keyOf = (at: KeyAt | undefined) => (at !== undefined && "key" in at ? at.key : at);

describe("keys at a commit (spec 023 D2)", () => {
  it("equal the keys of a daemon at that commit, and name an untracked input", {
    timeout: 120_000,
  }, async () => {
    const repo = catchUpRepo(FILES);
    const first = git(repo.main, ["rev-parse", "HEAD"]).trim();
    appendFileSync(join(repo.main, "src/a.ts"), "// second\n");
    git(repo.main, ["rm", "-q", "--cached", "src/c.ts"]);
    git(repo.main, ["add", "src/a.ts"]);
    git(repo.main, ["commit", "-qm", "second"]);
    const second = git(repo.main, ["rev-parse", "HEAD"]).trim();

    const policy = RUN_MISSING;
    const main = catchUpSide(repo, repo.main, { files: FILES, hostSlots: 4, policy });
    await started(main);
    const other = catchUpSide(repo, repo.other, { files: FILES, hostSlots: 4, policy });
    await started(other);
    const daemonAtFirst = keysIn(other.store, other.worktreeId);
    const daemonAtSecond = keysIn(main.store, main.worktreeId);
    expect(daemonAtFirst.get(id(A))).not.toBe(daemonAtSecond.get(id(A)));
    expect(daemonAtFirst.get(id(B))).toBe(daemonAtSecond.get(id(B)));

    const asked = { root: repo.main, store: main.store, worktreeId: main.worktreeId, inputs: [] };
    const atFirst = await keysAtCommit({ ...asked, commit: first });
    expect(keyOf(atFirst.get(id(A)))).toBe(daemonAtFirst.get(id(A)));
    expect(keyOf(atFirst.get(id(B)))).toBe(daemonAtFirst.get(id(B)));
    expect(atFirst.get(id(A))).toMatchObject({ step: 1 });
    // `src/c.ts` is on disk in `main`, and git no longer holds it there.
    expect(atFirst.get(id(C))).toEqual({
      notDetermined: { reason: "untracked input", path: "src/c.ts" },
    });

    const atSecond = await keysAtCommit({
      ...asked,
      commit: second,
      files: [{ project: "", path: A }],
    });
    expect([...atSecond.keys()]).toEqual([id(A)]);
    expect(keyOf(atSecond.get(id(A)))).toBe(daemonAtSecond.get(id(A)));

    // D5.1: the test files at one commit over the code at the other. `a.test.ts`
    // is equal at both, so each side's key is its code commit's.
    const testPaths = [A];
    const oldCode = await sideKeys({ ...asked, code: first, tests: second, testPaths });
    expect(keyOf(oldCode.get(id(A)))).toBe(daemonAtFirst.get(id(A)));
    const newCode = await sideKeys({ ...asked, code: second, tests: first, testPaths });
    expect(keyOf(newCode.get(id(A)))).toBe(daemonAtSecond.get(id(A)));
  });

  it("is not determined (closure) for a file this worktree's list does not key", {
    timeout: 120_000,
  }, async () => {
    const repo = catchUpRepo(FILES.slice(0, 1));
    const main = catchUpSide(repo, repo.main, {
      files: FILES.slice(0, 1),
      hostSlots: 4,
      policy: RUN_MISSING,
    });
    await started(main);
    const commit = git(repo.main, ["rev-parse", "HEAD"]).trim();
    const asked = {
      root: repo.main,
      store: main.store,
      worktreeId: main.worktreeId,
      commit,
      inputs: [],
    };
    const unknown = await keysAtCommit({ ...asked, files: [{ project: "", path: B }] });
    expect(unknown.get(id(B))).toEqual({
      notDetermined: { reason: "closure", detail: "no stored closure list" },
    });
    // Parts that are not the ones the worktree keyed with fail D11's proof.
    const parts = () => ({ dependencies: "other", runtime: "" });
    const wrong = await keysAtCommit({ ...asked, parts });
    expect(wrong.get(id(A))).toEqual({
      notDetermined: {
        reason: "closure",
        detail: "the stored list does not give this worktree's key",
      },
    });
  });
});

describe("a closure that shrank since the commit (review of wave 1 B1)", () => {
  it("is not determined (closure): the test at the commit imports a file the list lacks", {
    timeout: 120_000,
  }, async () => {
    const atA: CatchUpFile[] = [
      { path: A, ms: 10, imports: ["src/a.ts", "src/old.ts"] },
      { path: B, ms: 10, imports: ["src/b.ts"] },
    ];
    const atB: CatchUpFile[] = [
      { path: A, ms: 10, imports: ["src/a.ts"] },
      { path: B, ms: 10, imports: ["src/b.ts"] },
    ];
    const repo = catchUpRepo(atA);
    const write = (text: string) => writeFileSync(join(repo.main, A), text);
    write('import "../src/a.ts";\nimport "../src/old.ts";\n');
    git(repo.main, ["commit", "-qam", "A"]);
    const commitA = git(repo.main, ["rev-parse", "HEAD"]).trim();
    git(repo.other, ["checkout", "-q", "--detach", commitA]);
    write('import "../src/a.ts";\n');
    appendFileSync(join(repo.main, "src/a.ts"), "// B\n");
    git(repo.main, ["commit", "-qam", "B"]);
    const commitB = git(repo.main, ["rev-parse", "HEAD"]).trim();

    // The daemon at A first; B's starts last, so the stored list is B's, without `src/old.ts`.
    const other = catchUpSide(repo, repo.other, { files: atA, hostSlots: 4, policy: RUN_MISSING });
    await started(other);
    const main = catchUpSide(repo, repo.main, { files: atB, hostSlots: 4, policy: RUN_MISSING });
    await started(main);
    const daemonAtA = keysIn(other.store, other.worktreeId);
    expect(main.store.testFiles.get({ project: "", path: A })?.closure.paths).toEqual([
      "src/a.ts",
      A,
    ]);

    const asked = { root: repo.main, store: main.store, worktreeId: main.worktreeId, inputs: [] };
    const keys = await keysAtCommit({ ...asked, commit: commitA });
    expect(keys.get(id(A))).toEqual({
      notDetermined: {
        reason: "closure",
        detail: `${A} imports src/old.ts at the commit, not in the list`,
      },
    });
    // An unchanged file whose list covers the commit keeps its exact key.
    expect(keyOf(keys.get(id(B)))).toBe(daemonAtA.get(id(B)));
    // D5.1: the old test over the new code reads `src/old.ts` too.
    const side = await sideKeys({ ...asked, code: commitB, tests: commitA, testPaths: [A] });
    expect(side.get(id(A))).toMatchObject({ notDetermined: { reason: "closure" } });
    // The new test over the old code needs only the list.
    const back = await sideKeys({ ...asked, code: commitA, tests: commitB, testPaths: [A] });
    expect(back.get(id(A))).toMatchObject({ step: 1 });
  });
});

describe("mixedBlobs (spec 023 D5.1)", () => {
  it("takes the test-side paths from the tests' commit, absent when it lacks them", () => {
    const code = new Map([
      ["src/a.ts", "a1"],
      ["test/a.test.ts", "t1"],
      ["test/helper.ts", "h1"],
    ]);
    const tests = new Map([
      ["src/a.ts", "a2"],
      ["test/a.test.ts", "t2"],
    ]);
    const mixed = mixedBlobs(code, tests, ["test/a.test.ts", "test/helper.ts"]);
    expect(Object.fromEntries(mixed)).toEqual({ "src/a.ts": "a1", "test/a.test.ts": "t2" });
  });
});

describe("untrackedBy (spec 023 D2.4)", () => {
  const entries = [
    { path: "dist/", ignored: true },
    { path: "src/new.ts", ignored: false },
    { path: "src/deep/", ignored: false },
    { path: "src/lib/x/", ignored: false },
    { path: "src/cache/", ignored: true },
  ];
  it("names a file at or under an untracked or ignored entry", () => {
    expect(untrackedBy("dist/a.js", entries)).toBe(true);
    expect(untrackedBy("src/new.ts", entries)).toBe(true);
    expect(untrackedBy("src/a.ts", entries)).toBe(false);
  });
  it("names a listing by its untracked direct entries, or a whole ignored folder", () => {
    expect(untrackedBy("src/", entries)).toBe(true);
    expect(untrackedBy("src/lib/", entries)).toBe(true);
    expect(untrackedBy("dist/", entries)).toBe(true);
    expect(untrackedBy("dist/sub/", entries)).toBe(true);
    expect(untrackedBy("test/", entries)).toBe(false);
    // An ignored folder inside a listed one is not one of its names.
    expect(untrackedBy("src/", [{ path: "src/cache/", ignored: true }])).toBe(false);
    expect(untrackedBy("./", [{ path: "node_modules/", ignored: true }])).toBe(false);
  });
});
