import { describe, expect, it } from "vitest";
import { formatRegistration, readHeader } from "../../src/core/delivery/index.js";
import { isPending } from "../../src/core/state/index.js";
import { formatStatus, readStatus } from "../../src/core/status/index.js";
import {
  MAIN_AGENT,
  refinedMetaKey,
  type StatusSnapshot,
  type Store,
} from "../../src/core/types/index.js";
import { appendRevisions, check, fakeRepo, seedStore, state } from "./helpers.js";

/*
 * Review wave 4.5, S1. Spec 001 D2 as amended: "The last revision whose
 * refinement was applied is recorded, and headers, status and every wait
 * treat a revision ahead of it as pending, so a test file added during a tier
 * is never reported as nothing pending."
 */

const NOW = Date.UTC(2026, 9, 6, 12, 0, 0);

function worktreeAt(revision: number, refined: number | null) {
  const repo = fakeRepo();
  const store = seedStore(repo);
  appendRevisions(store, repo.mainId, revision, { head: null, dirty: false });
  store.knownStates.upsertMany([state(repo.mainId, check("src/a.test.ts", "adds"))]);
  store.testFileKeys.upsertMany([
    {
      worktreeId: repo.mainId,
      testFile: { project: "", path: "src/a.test.ts" },
      key: "k1",
      revision,
      pending: null,
    },
  ]);
  if (refined !== null) store.meta.set(refinedMetaKey(repo.mainId), String(refined));
  return { repo, store };
}

function header(store: Store, id: string) {
  return readHeader(store, id);
}

describe("refined-revision marker (review wave 4.5, S1)", () => {
  it("counts a revision ahead of the marker as pending", () => {
    const { repo, store } = worktreeAt(3, 2);

    const h = header(store, repo.mainId);

    expect(h).toMatchObject({ revision: 3, refinedRevision: 2, runnerPartPending: true });
    expect(h.counts.pending).toBe(0);
    expect(isPending(h)).toBe(true);
  });

  it("is not pending once the marker reaches the current revision", () => {
    const { repo, store } = worktreeAt(3, 3);

    const h = header(store, repo.mainId);

    expect(h).toMatchObject({ refinedRevision: 3, runnerPartPending: false });
    expect(isPending(h)).toBe(false);
  });

  it("reads a store without a marker as nothing pending: no daemon of this version wrote one", () => {
    const { repo, store } = worktreeAt(3, null);

    expect(header(store, repo.mainId)).toMatchObject({
      refinedRevision: null,
      runnerPartPending: false,
    });
  });

  it("says so in the delivered header", () => {
    const { repo, store } = worktreeAt(3, 2);

    const text = formatRegistration({
      schemaVersion: 1,
      consumer: { worktreeId: repo.mainId, sessionId: "s", agentId: MAIN_AGENT },
      header: header(store, repo.mainId),
      knownFailures: [],
    });

    expect(text).toContain(
      "The runner part of revision 3 is pending; test files it adds are not counted yet.",
    );
  });

  it("says so in squeal status, in the payload and the human rendering", () => {
    const { repo, store } = worktreeAt(3, 2);
    store.close();

    const status = readStatus(repo.main, { now: () => NOW }) as StatusSnapshot;

    expect(status).toMatchObject({ refinedRevision: 2, runnerPartPending: true });
    expect(formatStatus(status, NOW)).toContain(
      "Affected checks: 1 passed, 0 running, 0 queued; the runner part of revision 3 is pending, " +
        "so test files it adds are not counted yet\n",
    );
  });
});
