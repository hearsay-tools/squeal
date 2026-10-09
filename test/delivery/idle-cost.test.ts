import { beforeEach, describe, expect, it } from "vitest";
import { createDelivery } from "../../src/core/delivery/index.js";
import { createStateSink } from "../../src/core/state/index.js";
import type { Consumer, HarnessDelivery, Store } from "../../src/core/types/index.js";
import { check, result, setKey, WT } from "../state/helpers.js";
import { fakeCommonDir, open } from "../store/helpers.js";
import { fixedStatus } from "./fakes.js";

const C1: Consumer = { worktreeId: WT, sessionId: "s1", agentId: "main" };
const STATES = 15_000;
/** A minute of the waiter's polls at the default 250 ms. */
const POLLS_PER_MINUTE = 240;
const NONE = { checkpointId: null };

/** `store` with every repository call counted under `repo.method`. */
function counted(store: Store): { store: Store; reads: Map<string, number> } {
  const reads = new Map<string, number>();
  const wrap = (name: string, repo: object) =>
    new Proxy(repo, {
      get(target, method, receiver) {
        const value = Reflect.get(target, method, receiver);
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => {
          const at = `${name}.${String(method)}`;
          reads.set(at, (reads.get(at) ?? 0) + 1);
          return value.apply(target, args);
        };
      },
    });
  const proxy = new Proxy(store, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      return typeof value === "object" && value !== null && typeof property === "string"
        ? wrap(property, value)
        : value;
    },
  });
  return { store: proxy, reads };
}

const total = (reads: Map<string, number>) => [...reads.values()].reduce((a, b) => a + b, 0);

/** One poll of the waiter: `waitForDelta` with no time left polls exactly once. */
const poll = (delivery: HarnessDelivery) => delivery.waitForDelta(C1, { timeoutMs: 0 });

let commonDir: string;
let store: Store;
let revision: number;

beforeEach(async () => {
  commonDir = fakeCommonDir();
  store = open(commonDir);
  revision = 1;
  setKey(store, "k1");
  const results = Array.from({ length: STATES }, (_, i) => result(check(`t${i}`), "pass"));
  createStateSink(store, { now: () => 1 }).applyResults(WT, revision, results, NONE);
  const setup = createDelivery(store, { status: fixedStatus(), now: () => 1 });
  await setup.register(C1);
  setKey(store, "k1", { pending: "queued" });
  await setup.endTurn(C1);
});

describe("an idle waiter (task 001-178)", () => {
  it("reads a handful of rows in a minute when nothing changes, not every known state per poll", async () => {
    const { store: watched, reads } = counted(store);
    const delivery = createDelivery(watched, { status: fixedStatus(), now: () => 2 });
    for (let i = 0; i < POLLS_PER_MINUTE; i++) expect(await poll(delivery)).toBeNull();
    expect(reads.get("knownStates.list") ?? 0).toBeLessThanOrEqual(1);
    expect(total(reads)).toBeLessThanOrEqual(10);
  });

  it("notices another connection's commit within one poll", async () => {
    const delivery = createDelivery(store, { status: fixedStatus(), now: () => 2 });
    expect(await poll(delivery)).toBeNull();
    expect(await poll(delivery)).toBeNull();
    const daemon = open(commonDir);
    createStateSink(daemon, { now: () => 3 }).applyResults(
      WT,
      ++revision,
      [result(check("t0"), "fail", { revision })],
      NONE,
    );
    expect((await poll(delivery))?.entries.map((e) => e.kind)).toEqual(["pass-to-fail"]);
  });

  it("notices its own connection's write within one poll", async () => {
    const delivery = createDelivery(store, { status: fixedStatus(), now: () => 2 });
    expect(await poll(delivery)).toBeNull();
    expect(await poll(delivery)).toBeNull();
    createStateSink(store, { now: () => 3 }).applyResults(
      WT,
      ++revision,
      [result(check("t0"), "fail", { revision })],
      NONE,
    );
    expect((await poll(delivery))?.entries.map((e) => e.kind)).toEqual(["pass-to-fail"]);
  });
});
