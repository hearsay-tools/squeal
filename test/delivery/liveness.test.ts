import { beforeEach, describe, expect, it } from "vitest";
import { createDelivery, daemonLiveness, livenessMetaKey } from "../../src/core/delivery/index.js";
import { createStateSink } from "../../src/core/state/index.js";
import {
  type Consumer,
  type HarnessDelivery,
  REGRESSION_KINDS,
  type StateSink,
  type Store,
} from "../../src/core/types/index.js";
import { check, freshStore, result, setKey, WT } from "../state/helpers.js";
import { fixedStatus } from "./fakes.js";

/*
 * Review wave 3, S2 and spec 001 D9: liveness in headers from the heartbeat
 * in `worktrees.daemon`, delivered once per consumer when it changes.
 */

const C1: Consumer = { worktreeId: WT, sessionId: "s1", agentId: "main" };
const C2: Consumer = { worktreeId: WT, sessionId: "s2", agentId: "main" };
const A = check("a");
const INTERVAL = 5_000;

let store: Store;
let sink: StateSink;
let delivery: HarnessDelivery;
let clock: number;
let revision: number;

beforeEach(() => {
  store = freshStore();
  clock = 1_000_000;
  revision = 0;
  sink = createStateSink(store, { now: () => clock });
  delivery = createDelivery(store, { status: fixedStatus(), now: () => clock, pollIntervalMs: 5 });
  setKey(store, "k1");
  store.worktrees.upsert({
    id: WT,
    root: "/repo",
    commonDir: "/repo/.git",
    isMain: true,
    registeredAt: 1,
    daemon: null,
  });
  heartbeat();
});

/** The daemon records a heartbeat now. */
function heartbeat(at = clock): void {
  store.worktrees.setDaemon(WT, {
    socketPath: "/run/squeal.sock",
    startedAt: 1,
    heartbeatAt: at,
    heartbeatIntervalMs: INTERVAL,
    squealVersion: "0.0.0-test",
  });
}

function apply(outcome: "pass" | "fail") {
  revision++;
  sink.applyResults(WT, revision, [result(A, outcome)], { checkpointId: null });
}

describe("daemonLiveness", () => {
  it("is alive up to two heartbeat intervals, as status judges it", () => {
    const record = {
      socketPath: "/s",
      startedAt: 1,
      heartbeatAt: 100,
      heartbeatIntervalMs: 10,
      squealVersion: "x",
    };
    expect(daemonLiveness(record, 120)).toEqual({ state: "alive", lastHeartbeatAt: 100 });
    expect(daemonLiveness(record, 121)).toEqual({ state: "down", since: 100 });
    expect(daemonLiveness(null, 121)).toEqual({ state: "down", since: null });
  });
});

describe("liveness in headers", () => {
  it("is in every registration and delta header", async () => {
    apply("pass");
    const registration = await delivery.register(C1);
    expect(registration.header.daemon).toEqual({ state: "alive", lastHeartbeatAt: clock });
    apply("fail");
    clock += 3 * INTERVAL;
    const delta = await delivery.onToolBoundary(C1);
    expect(delta?.header.daemon).toEqual({ state: "down", since: clock - 3 * INTERVAL });
    expect(delta?.entries).toHaveLength(1);
    expect(delta?.liveness).toEqual({ state: "down", since: clock - 3 * INTERVAL });
  });

  it("is down since nothing when no daemon recorded a heartbeat", async () => {
    store.worktrees.setDaemon(WT, null);
    const { header } = await delivery.register(C1);
    expect(header.daemon).toEqual({ state: "down", since: null });
  });
});

describe("a liveness change", () => {
  it("is delivered once per consumer, alone if nothing else changed", async () => {
    apply("pass");
    await delivery.register(C1);
    await delivery.register(C2);
    clock += 3 * INTERVAL;

    const first = await delivery.onToolBoundary(C1);
    expect(first).toMatchObject({ entries: [], liveness: { state: "down" } });
    expect(await delivery.onToolBoundary(C1)).toBeNull();
    expect(await delivery.onToolBoundary(C2)).toMatchObject({ liveness: { state: "down" } });

    heartbeat();
    expect(await delivery.onToolBoundary(C1)).toMatchObject({
      entries: [],
      label: "transitions",
      liveness: { state: "alive" },
    });
    expect(await delivery.onToolBoundary(C1)).toBeNull();
  });

  it("is not delivered to a consumer registered while the daemon was already down", async () => {
    clock += 3 * INTERVAL;
    await delivery.register(C1);
    expect(await delivery.onToolBoundary(C1)).toBeNull();
  });

  it("is left for the next tool boundary by a PreToolUse peek and the idle waiter", async () => {
    apply("pass");
    await delivery.register(C1);
    clock += 3 * INTERVAL;

    expect(await delivery.peek(C1, { kinds: REGRESSION_KINDS })).toBeNull();
    expect(await delivery.waitForDelta(C1, { timeoutMs: 20 })).toBeNull();
    expect(await delivery.onToolBoundary(C1)).toMatchObject({ liveness: { state: "down" } });
  });

  it("is forgotten with the consumer", async () => {
    await delivery.register(C1);
    await delivery.register(C2);
    expect(store.meta.get(livenessMetaKey(WT))).toContain("s1");
    await delivery.unregister(C1);
    expect(store.meta.get(livenessMetaKey(WT))).not.toContain("s1");
    expect(store.meta.get(livenessMetaKey(WT))).toContain("s2");
  });

  it("is not delivered to an unregistered consumer", async () => {
    clock += 3 * INTERVAL;
    expect(await delivery.onToolBoundary(C1)).toBeNull();
  });
});
