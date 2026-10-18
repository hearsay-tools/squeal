import { describe, expect, it } from "vitest";
import { formatWhy, readWhy } from "../../src/core/status/index.js";
import type { TestFileKeyRecord } from "../../src/core/types/index.js";
import { fakeRepo, seedStore } from "./helpers.js";
import { seedLogin } from "./why-seed.js";

/*
 * Issue 31 (011 C4 as amended 2026-10-18, task 011-17): a test that has
 * never run has no check row, so `why` with no match counts the test files
 * of this worktree queued or running without a result at their current key
 * and says the test may be in one of them, never that it does not exist.
 */
describe("readWhy with no match (gh-31)", () => {
  const row = (
    worktreeId: string,
    path: string,
    key: string | null,
    pending: TestFileKeyRecord["pending"],
  ): TestFileKeyRecord => ({
    worktreeId,
    testFile: { project: "", path },
    key,
    revision: 2,
    pending,
  });

  it("counts queued and running files without a result at their key", () => {
    const repo = fakeRepo();
    const store = seedStore(repo);
    const b = seedLogin(repo, store);
    store.testFileKeys.upsertMany([
      row(b.id, "src/new.test.ts", "k-new", "queued"),
      row(b.id, "src/edited.test.ts", "k-edited", "running"),
      // A result at its key already: a forced re-run, not where an unrun test hides.
      row(b.id, "src/auth.test.ts", "k1", "queued"),
      row(b.id, "src/settled.test.ts", "k-settled", null),
      row(b.id, "src/unkeyed.test.ts", null, null),
      row(repo.mainId, "src/other.test.ts", "k-other", "queued"),
    ]);

    const none = readWhy(b.root, "a test not run yet");

    expect(none).toMatchObject({ found: false, candidates: [], queuedWithoutResult: 2 });
    expect(formatWhy(none)).toBe(
      'No check matches "a test not run yet" in this worktree. 2 test files are queued or running without a result at their current keys; a test that has not run yet has no name here, so it may be in one of them.\n',
    );
  });

  it("names one queued file in the singular", () => {
    const repo = fakeRepo();
    const store = seedStore(repo);
    const b = seedLogin(repo, store);
    store.testFileKeys.upsertMany([row(b.id, "src/new.test.ts", "k-new", "queued")]);

    expect(formatWhy(readWhy(b.root, "nope"))).toBe(
      'No check matches "nope" in this worktree. 1 test file is queued or running without a result at its current key; a test that has not run yet has no name here, so it may be in it.\n',
    );
  });

  it("keeps the short text when nothing is queued, and reads an older payload without the count", () => {
    const repo = fakeRepo();
    const store = seedStore(repo);
    const b = seedLogin(repo, store);

    const none = readWhy(b.root, "nope");

    expect(none).toMatchObject({ found: false, queuedWithoutResult: 0 });
    expect(formatWhy(none)).toBe('No check matches "nope" in this worktree.\n');
    expect(
      formatWhy({
        schemaVersion: 1,
        available: true,
        found: false,
        query: "nope",
        candidates: [],
        candidateDurations: [],
      }),
    ).toBe('No check matches "nope" in this worktree.\n');
  });
});
