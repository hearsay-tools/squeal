import { describe, expect, it } from "vitest";
import { createDelivery } from "../../src/core/delivery/index.js";
import { readStatus } from "../../src/core/status/index.js";
import type { Consumer, StatusSnapshot } from "../../src/core/types/index.js";
import { fixedStatus } from "../delivery/fakes.js";
import { check, fakeRepo, seedStore, state } from "./helpers.js";

const NOW = Date.UTC(2026, 9, 4, 12, 0, 0);

describe("delivery header and status", () => {
  it("agree on a worktree with no revision whose baseline completed", async () => {
    const repo = fakeRepo();
    const b = repo.addWorktree("b");
    const store = seedStore(repo);
    store.knownStates.upsertMany([
      state(b.id, check("src/a.test.ts", "adds"), {
        origin: { kind: "inherited", worktreeId: repo.mainId, commit: null },
      }),
      state(b.id, check("src/a.test.ts", "subtracts"), {
        outcome: "fail",
        observedAt: null,
        summary: "expected 1 to be 2",
        fingerprint: "AssertionError: expected 1 to be 2 @ src/a.ts:1:1",
      }),
    ]);
    store.checkpoints.start({
      id: "cp-base",
      worktreeId: b.id,
      revision: 0,
      kind: "baseline",
      testFiles: [],
      startedAt: 1,
    });
    store.checkpoints.finish("cp-base", "completed", 2);
    const consumer: Consumer = { worktreeId: b.id, sessionId: "s", agentId: "main" };
    const registration = await createDelivery(store, { status: fixedStatus() }).register(consumer);
    store.close();

    const status = readStatus(b.root, { now: () => NOW }) as StatusSnapshot;

    expect(status.available).toBe(true);
    expect(registration.header.fullSuite).toEqual({
      atCurrentRevision: true,
      lastCompletedRevision: 0,
    });
    const { revision, counts, fullSuite } = status;
    expect({ revision, counts, fullSuite }).toEqual(
      expect.objectContaining({
        revision: registration.header.revision,
        counts: registration.header.counts,
        fullSuite: registration.header.fullSuite,
      }),
    );
    expect(status.knownFailures).toEqual(registration.knownFailures);
  });
});
