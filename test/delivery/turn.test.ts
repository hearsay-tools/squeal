import { beforeEach, describe, expect, it } from "vitest";
import { createDelivery } from "../../src/core/delivery/index.js";
import { readTurn, START_IDLE, turnMetaKey, waitedFor } from "../../src/core/delivery/turn.js";
import { createStateSink } from "../../src/core/state/index.js";
import {
  type Consumer,
  type HarnessDelivery,
  refinedMetaKey,
  type Store,
  type TransitionEntry,
} from "../../src/core/types/index.js";
import { check, freshStore, result, setKey, WT } from "../state/helpers.js";
import { fixedStatus } from "./fakes.js";

/* Task 001-85: each consumer's turn state, kept in `meta` beside its told liveness. */

const C1: Consumer = { worktreeId: WT, sessionId: "s1", agentId: "main" };
const C2: Consumer = { worktreeId: WT, sessionId: "s2", agentId: "main" };

let store: Store;
let delivery: HarnessDelivery;

beforeEach(() => {
  store = freshStore();
  delivery = createDelivery(store, { status: fixedStatus() });
  setKey(store, "k1");
});

const entry = (overrides: Partial<TransitionEntry> = {}): TransitionEntry => ({
  check: check("new", { project: "", path: "src/new.test.ts" }),
  kind: "first-seen-fail",
  from: null,
  to: "fail",
  validity: "current",
  observedAt: 2,
  origin: { kind: "own" },
  summary: null,
  location: null,
  ...overrides,
});

describe("turn state", () => {
  it("starts idle and waiting for nothing, and registration forgets an earlier one", async () => {
    await delivery.register(C1);
    expect(readTurn(store, C1)).toEqual(START_IDLE);
    await delivery.startTurn(C1);
    await delivery.register(C1);
    expect(readTurn(store, C1)).toEqual(START_IDLE);
  });

  it("waits for checks first observed when the runner part of the revision was pending", async () => {
    await delivery.register(C1);
    store.revisions.append({
      worktreeId: WT,
      createdAt: 1,
      head: null,
      dirty: true,
      trigger: "watch",
      changes: [{ path: "src/new.test.ts", oldHash: null, newHash: "h" }],
    });
    store.meta.set(refinedMetaKey(WT), "0");
    await delivery.endTurn(C1);

    const turn = readTurn(store, C1);
    expect(turn).toEqual({ turn: "idle", testFiles: [], newTestFiles: true });
    expect(waitedFor(turn, entry())).toBe(true);
    expect(waitedFor(turn, entry({ kind: "pass-to-fail", from: "pass" }))).toBe(false);
    expect(waitedFor({ ...turn, newTestFiles: false }, entry())).toBe(false);
  });

  it("keeps one row per worktree and drops consumers no longer registered", async () => {
    await delivery.register(C1);
    await delivery.register(C2);
    await delivery.startTurn(C1);
    await delivery.startTurn(C2);
    await delivery.unregister(C2);

    expect(JSON.parse(store.meta.get(turnMetaKey(WT)) ?? "{}")).toEqual({
      "s1\nmain": { turn: "in-turn" },
    });
  });

  it("reads an unreadable row as a consumer that starts idle", async () => {
    await delivery.register(C1);
    store.meta.set(turnMetaKey(WT), "not json");
    expect(readTurn(store, C1)).toEqual(START_IDLE);
    store.meta.set(turnMetaKey(WT), JSON.stringify({ "s1\nmain": { turn: "idle", testFiles: 3 } }));
    expect(readTurn(store, C1)).toEqual(START_IDLE);
  });

  it("does nothing for a consumer that is not registered", async () => {
    setKey(store, "k1", { pending: "queued" });
    createStateSink(store).applyResults(WT, 1, [result(check("a"), "fail")], {
      checkpointId: null,
    });
    await delivery.endTurn(C1);
    expect(await delivery.startTurn(C1)).toBeNull();
    expect(store.meta.get(turnMetaKey(WT))).toBeNull();
  });
});
