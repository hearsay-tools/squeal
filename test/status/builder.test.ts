import { describe, expect, it } from "vitest";
import { createDelivery } from "../../src/core/delivery/index.js";
import { createStatusBuilder, readStatus } from "../../src/core/status/index.js";
import { check, fakeRepo, seedStore, state } from "./helpers.js";

const NOW = Date.UTC(2026, 9, 4, 12, 0, 0);

describe("createStatusBuilder", () => {
  it("builds HarnessDelivery.status from the store, resolving the root by worktree id", async () => {
    const repo = fakeRepo();
    const b = repo.addWorktree("b");
    const store = seedStore(repo);
    store.worktrees.upsert({
      id: b.id,
      root: b.root,
      commonDir: repo.commonDir,
      isMain: false,
      registeredAt: 1,
      daemon: null,
    });
    store.knownStates.upsertMany([state(b.id, check("src/a.test.ts", "adds"))]);
    const delivery = createDelivery(store, {
      status: createStatusBuilder(store, { now: () => NOW }),
    });

    const status = await delivery.status(b.id);
    const unregistered = await delivery.status("0123456789abcdef");
    store.close();

    expect(status).toEqual(readStatus(b.root, { now: () => NOW }));
    expect(status).toMatchObject({ available: true, worktreeId: b.id, worktreeRoot: b.root });
    expect(unregistered).toEqual({
      schemaVersion: 1,
      available: false,
      reason: "not-registered",
      message: "status unavailable, worktree 0123456789abcdef is not registered in the store",
    });
  });
});
