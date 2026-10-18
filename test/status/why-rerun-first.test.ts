import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkIdentity, RERUN_FIRST_META_KEY } from "../../src/core/state/index.js";
import { formatWhy, readWhy } from "../../src/core/status/index.js";
import type { RerunFirstFailure } from "../../src/core/types/index.js";
import { fakeRepo, seedStore } from "./helpers.js";
import { LOGIN, reportOf, seedLogin } from "./why-seed.js";

const AUTH = { project: "", path: "src/auth.test.ts" };

/*
 * Review wave-2b B2 (gh-20): `why` shows a re-run's kept first error only
 * at the worktree's current key, with the log of the run that stored it.
 * `b` is put at key `k1` here; `run-b1` stored its first failure.
 */
function seeded(record: Omit<RerunFirstFailure, "worktreeId" | "at">) {
  const repo = fakeRepo();
  const store = seedStore(repo);
  const b = seedLogin(repo, store);
  store.testFileKeys.upsertMany([
    { worktreeId: b.id, testFile: AUTH, key: "k1", revision: 2, pending: null },
  ]);
  const kept = { ...record, worktreeId: b.id, at: 1 };
  store.meta.set(RERUN_FIRST_META_KEY, JSON.stringify({ [checkIdentity(LOGIN)]: kept }));
  return { repo, b, why: reportOf(readWhy(b.root, "src/auth.test.ts > auth > login")) };
}

describe("squeal why with a re-run's first error", () => {
  it("names it, its run and its log at the current key", () => {
    const { repo, why } = seeded({ key: "k1", runId: "run-b1", failure: "FIRST_ERROR" });

    const logDir = join(repo.commonDir, "squeal", "runs", "run-b1");
    expect(why.rerunFirstFailure).toMatchObject({ key: "k1", runId: "run-b1", logDir });
    expect(formatWhy(why)).toContain(
      `  First error, before its re-run (run run-b1, key k1): FIRST_ERROR\n    Its log: ${logDir}\n`,
    );
  });

  it("says nothing of one kept at another key", () => {
    const { why } = seeded({ key: "k0", runId: "run-b1", failure: "FIRST_ERROR" });

    expect(why.rerunFirstFailure).toBeUndefined();
    expect(formatWhy(why)).not.toContain("First error");
  });

  it("says a pruned run record", () => {
    const { why } = seeded({ key: "k1", runId: "run-gone", failure: "FIRST_ERROR" });

    expect(formatWhy(why)).toContain("    Its log: run record pruned\n");
  });
});
