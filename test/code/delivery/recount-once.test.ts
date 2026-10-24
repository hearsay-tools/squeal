import { beforeEach, describe, expect, it } from "vitest";
import { createDelivery } from "../../../src/core/delivery/index.js";
import type { Consumer, Store } from "../../../src/core/types/index.js";
import { fixedStatus } from "../../delivery/fakes.js";
import { freshStore, setKey, WT } from "../../state/helpers.js";
import {
  type CodeRepo,
  codeRepo,
  codeState,
  fn,
  fnCheck,
  putCursor,
  putFile,
  putRecount,
  TIERS,
} from "./helpers.js";

/*
 * Row 015-37 (lessons.md "Round 1 (015-10)" B4): a recount summary was
 * told twice at one revision. A hook reads its clock before it opens the
 * code store, so a recount the pass commits in between is newer than the
 * hook's clock. The seed was set to that clock, and the next hook found
 * the recount newer than the seed again. The transaction that tells the
 * summary sets the seed to the recount's time at least.
 */

const C1: Consumer = { worktreeId: WT, sessionId: "s1", agentId: "main" };
const RECOUNT_AT = 15_000;

let main: Store;
let repo: CodeRepo;

beforeEach(() => {
  main = freshStore();
  setKey(main, "k1");
  repo = codeRepo();
  putFile(repo.store, WT, TIERS, [fn("selectTier", 23, 120)]);
  repo.store.states.upsertMany([codeState(WT, fnCheck("selectTier"), 23)]);
  putCursor(repo.store, WT);
});

/** A hook whose clock reads `at`. */
const hook = (at: number) =>
  createDelivery(main, { status: fixedStatus(), now: () => at, code: repo.source });

describe("a recount summary (015-37)", () => {
  it("is told to one of two hooks whose clocks were read before the recount", async () => {
    await hook(10_000).register(C1);
    putRecount(repo.store, WT, { revision: 2, at: RECOUNT_AT, reason: "counter", threshold: 20 });
    const deltas = await Promise.all([hook(11_000), hook(12_000)].map((h) => h.onToolBoundary(C1)));
    expect(deltas.filter((d) => d?.code?.recount !== undefined)).toHaveLength(1);
    expect(await hook(20_000).onToolBoundary(C1)).toBeNull();
  });

  it("is told again for the next recount", async () => {
    await hook(10_000).register(C1);
    putRecount(repo.store, WT, { revision: 2, at: RECOUNT_AT, reason: "counter", threshold: 20 });
    expect((await hook(11_000).onToolBoundary(C1))?.code?.recount).toBeDefined();
    putRecount(repo.store, WT, { revision: 3, at: 25_000, reason: "include", threshold: 20 });
    expect((await hook(26_000).onToolBoundary(C1))?.code?.recount).toMatchObject({
      reason: "include",
    });
  });

  it("is not told after a registration whose clock was read before it", async () => {
    putRecount(repo.store, WT, { revision: 2, at: RECOUNT_AT, reason: "counter", threshold: 20 });
    await hook(11_000).register(C1);
    expect(await hook(20_000).onToolBoundary(C1)).toBeNull();
  });
});
