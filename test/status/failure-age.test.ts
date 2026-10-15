import { describe, expect, it } from "vitest";
import { recordRunLoad } from "../../src/core/retry/index.js";
import { formatStatus, readStatus } from "../../src/core/status/index.js";
import { result } from "../store/helpers.js";
import { appendRevisions, check, fakeRepo, seedStore, state } from "./helpers.js";

/*
 * Task 001-404: a known failure in `squeal status` says how old the run that
 * recorded it is and the host's load per CPU at that run, joined from the
 * result's provenance and `failed-run-loads`; the verdict stays the stored one.
 */

const AUTH = check("src/auth.test.ts", "auth > login");
const NOW = Date.UTC(2026, 9, 15, 12, 0);

function seeded(recordedAt: number) {
  const repo = fakeRepo();
  const store = seedStore(repo);
  store.worktrees.upsert({
    id: repo.mainId,
    root: repo.main,
    commonDir: repo.commonDir,
    isMain: true,
    registeredAt: 1,
    daemon: null,
  });
  appendRevisions(store, repo.mainId, 2, { head: null, dirty: false });
  store.testFileKeys.upsertMany([
    {
      worktreeId: repo.mainId,
      testFile: { project: "", path: "src/auth.test.ts" },
      key: "k1",
      revision: 2,
      pending: null,
    },
  ]);
  store.results.putMany([
    result(AUTH, "k1", { outcome: "fail", worktreeId: repo.mainId, runId: "run-1", recordedAt }),
  ]);
  store.knownStates.upsertMany([
    state(repo.mainId, AUTH, { outcome: "fail", observedAt: 2, summary: "expected 1 to be 2" }),
  ]);
  return { repo, store };
}

describe("status: a known failure's age and load (001-404)", () => {
  it("dates an old failure and names the load its run ran under", () => {
    const { repo, store } = seeded(NOW - 3 * 3_600_000 - 10 * 60_000);
    recordRunLoad(store, "run-1", 3.33);

    const status = readStatus(repo.main, { now: () => NOW });
    const text = formatStatus(status, NOW);

    expect(status.available && status.knownFailures[0]?.recorded).toMatchObject({
      recordedAt: NOW - 3 * 3_600_000 - 10 * 60_000,
      loadPerCpu: 3.33,
    });
    expect(text).toContain(
      "        recorded 3 h ago in this worktree at revision 4, load 3.33 per CPU when it ran; no retry asked at these inputs\n",
    );
  });

  it("reads a fresh failure as just now, and a load not kept as not recorded", () => {
    const { repo } = seeded(NOW - 20_000);

    const text = formatStatus(readStatus(repo.main, { now: () => NOW }), NOW);

    expect(text).toContain(
      "recorded just now in this worktree at revision 4, load per CPU then not recorded;",
    );
  });
});
