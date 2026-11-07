import { beforeEach, describe, expect, it } from "vitest";
import { createDelivery } from "../../src/core/delivery/delivery.js";
import {
  countStopHold,
  promptTurn,
  readStopHolds,
  readTurn,
  startTurn,
  turnMetaKey,
} from "../../src/core/delivery/turn.js";
import type { Consumer, HarnessDelivery } from "../../src/core/types/delivery.js";
import type { Store } from "../../src/core/types/store.js";
import { freshStore, setKey, WT } from "../state/helpers.js";
import { fixedStatus } from "./fakes.js";

/*
 * Spec 019 D4 step 3 (row 019-14): Stop's holds per consumer and turn. A
 * turn starts at a user prompt; the count lasts across the idle and in-turn
 * states a turn passes through, and goes with the consumer's registration.
 */

const C1: Consumer = { worktreeId: WT, sessionId: "s1", agentId: "main" };
const C2: Consumer = { worktreeId: WT, sessionId: "s2", agentId: "main" };

let store: Store;
let delivery: HarnessDelivery;

beforeEach(() => {
  store = freshStore();
  delivery = createDelivery(store, { status: fixedStatus() });
  setKey(store, "k1");
});

const hold = (consumer: Consumer) => store.transaction(() => countStopHold(store, consumer));

describe("Stop holds per consumer and turn", () => {
  it("counts per consumer, and keeps the count across the turn's states", async () => {
    await delivery.register(C1, { inTurn: true });
    await delivery.register(C2, { inTurn: true });
    hold(C1);
    hold(C1);
    hold(C2);
    expect(readStopHolds(store, C1)).toBe(2);
    expect(readStopHolds(store, C2)).toBe(1);

    // The turn ends silently, a tool call resumes it, a hold takes it again: still one turn.
    await delivery.endTurn(C1, { handoff: true });
    expect(readTurn(store, C1)).toMatchObject({ turn: "idle", handoff: expect.any(Object) });
    expect(readStopHolds(store, C1)).toBe(2);
    await delivery.onToolBoundary(C1);
    expect(readTurn(store, C1).turn).toBe("in-turn");
    store.transaction(() => startTurn(store, C1));
    expect(readStopHolds(store, C1)).toBe(2);
  });

  it("a prompt starts a turn with none, and leaves another consumer's count", async () => {
    await delivery.register(C1, { inTurn: true });
    await delivery.register(C2, { inTurn: true });
    hold(C1);
    hold(C2);
    await delivery.endTurn(C1);
    await delivery.startTurn(C1);
    expect(readStopHolds(store, C1)).toBe(0);
    expect(readTurn(store, C1).turn).toBe("in-turn");
    expect(readStopHolds(store, C2)).toBe(1);
  });

  it("goes with the registration", async () => {
    await delivery.register(C1, { inTurn: true });
    hold(C1);
    await delivery.unregister(C1);
    expect(readStopHolds(store, C1)).toBe(0);
    await delivery.register(C1, { inTurn: true });
    expect(readStopHolds(store, C1)).toBe(0);
  });

  it("counts nothing for a consumer not registered, and a prompt with none writes nothing", async () => {
    hold(C1);
    expect(readStopHolds(store, C1)).toBe(0);
    await delivery.register(C1);
    const before = store.meta.get(turnMetaKey(WT));
    promptTurn(store, C1);
    expect(store.meta.get(turnMetaKey(WT))).toBe(before);
  });

  it("leaves the turn row as before while no hold is counted, and reads a bad count as none", async () => {
    await delivery.register(C1, { inTurn: true });
    expect(JSON.parse(store.meta.get(turnMetaKey(WT)) ?? "{}")).toEqual({
      "s1\nmain": { turn: "in-turn" },
    });
    store.meta.set(
      turnMetaKey(WT),
      JSON.stringify({ "s1\nmain": { turn: "in-turn", stopHolds: -1 } }),
    );
    expect(readStopHolds(store, C1)).toBe(0);
    store.meta.set(
      turnMetaKey(WT),
      JSON.stringify({ "s1\nmain": { turn: "in-turn", stopHolds: "2" } }),
    );
    expect(readStopHolds(store, C1)).toBe(0);
  });
});
