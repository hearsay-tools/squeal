import { beforeEach, describe, expect, it } from "vitest";
import { createDelivery } from "../../src/core/delivery/delivery.js";
import { untoldStates, viewMarkOf } from "../../src/core/delivery/view-mark.js";
import { createStateSink } from "../../src/core/state/sink.js";
import { currentBirthMark, ensureBirthMarks } from "../../src/core/store/state-born.js";
import { connectionOf } from "../../src/core/store/store.js";
import type { CheckId } from "../../src/core/types/check.js";
import type { Consumer, HarnessDelivery } from "../../src/core/types/delivery.js";
import type { Store } from "../../src/core/types/store.js";
import { check, freshStore, releasedStore, result, setKey, WT } from "../state/helpers.js";
import { fixedStatus } from "./fakes.js";

/*
 * Row 005-106: a registration seeds the view with the states that are not `pass` and keeps the
 * store's high birth mark; a state with no entry born at or before it reads as the pass it was.
 * The rules of 005 `research/consumer-view-design.md` section 1 run through this reading in the
 * delivery tests too, since `freshStore` keeps birth marks as a daemon of 0.1.545 does.
 */

const C1: Consumer = { worktreeId: WT, sessionId: "s1", agentId: "main" };
const C2: Consumer = { worktreeId: WT, sessionId: "s2", agentId: "main" };
const A = check("a");
const B = check("b");
const N = check("n");

let store: Store;
let delivery: HarnessDelivery;
let revision: number;

function use(next: Store): void {
  store = next;
  revision = 0;
  delivery = createDelivery(store, { status: fixedStatus(), now: () => 10_000 });
  setKey(store, "k1");
}

function land(c: CheckId, outcome: "pass" | "fail", message?: string): void {
  revision++;
  createStateSink(store, { now: () => 10_000 }).applyResults(
    WT,
    revision,
    [result(c, outcome, message === undefined ? {} : { message })],
    { checkpointId: null },
  );
}

/** Rewrites `c`'s state as unknown, as an edit that invalidates it does. */
function unknown(c: CheckId): void {
  const state = store.knownStates.get(WT, c);
  if (state === null) throw new Error("no state");
  store.knownStates.upsertMany([{ ...state, outcome: "unknown", fingerprint: null }]);
}

const names = (checks: readonly { check: CheckId }[]) =>
  checks.map((v) => (v.check as { fullName: string }).fullName).sort();

const told = async (consumer: Consumer = C1) =>
  (await delivery.onToolBoundary(consumer))?.entries.map((e) => [
    (e.check as { fullName: string }).fullName,
    e.kind,
  ]) ?? null;

describe("a registration on a store that keeps birth marks (row 005-106)", () => {
  beforeEach(() => {
    use(freshStore());
    land(A, "pass");
    land(B, "fail");
  });

  it("seeds the states that are not pass and keeps the high mark", async () => {
    await delivery.register(C1);
    expect(names(store.views.list(C1))).toEqual(["b"]);
    expect(viewMarkOf(store, C1)?.mark).toBe(currentBirthMark(store));
  });

  it("reads a pass it did not seed as the told pass it was: PASS -> FAIL, PASS -> UNKNOWN", async () => {
    await delivery.register(C1);
    land(A, "fail");
    expect(await told()).toEqual([["a", "pass-to-fail"]]);
    land(A, "pass");
    expect(await told()).toEqual([["a", "fail-to-pass"]]);
    await delivery.register(C2);
    unknown(A);
    expect(await told(C2)).toEqual([["a", "to-unknown"]]);
  });

  it("tells nothing of a pass that stays a pass, and writes no entry for it", async () => {
    await delivery.register(C1);
    land(A, "pass");
    expect(await told()).toBeNull();
    expect(names(store.views.list(C1))).toEqual(["b"]);
  });

  it("reads a check born after it as never told: a first pass silently, a first failure as such", async () => {
    await delivery.register(C1);
    land(N, "fail");
    expect(await told()).toEqual([["n", "first-seen-fail"]]);
    const later = check("later");
    land(later, "pass");
    expect(await told()).toBeNull();
    expect(names(store.views.list(C1))).toEqual(["b", "later", "n"]);
  });

  it("counts as never told only the states born after it (the waiter's untold)", async () => {
    await delivery.register(C1);
    land(N, "pass");
    expect(names(untoldStates(store, C1))).toEqual(["n"]);
    expect(names(store.knownStates.untold(C1))).toEqual(["a", "n"]);
  });

  it("reads a retired and re-added check as new", async () => {
    await delivery.register(C1);
    createStateSink(store, { now: () => 10_000 }).retire(WT, [A]);
    land(A, "fail");
    expect(await told()).toEqual([["a", "first-seen-fail"]]);
  });

  it("drops the earlier view and mark at a registration again, and seeds anew (R9)", async () => {
    await delivery.register(C1);
    const first = viewMarkOf(store, C1)?.mark;
    land(N, "fail");
    await delivery.register(C1);
    expect(names(store.views.list(C1))).toEqual(["b", "n"]);
    expect(viewMarkOf(store, C1)?.mark).toBeGreaterThan(first ?? Infinity);
  });

  it("forgets a consumer's mark once it is gone, at the next registration", async () => {
    await delivery.register(C1);
    await delivery.unregister(C1);
    await delivery.register(C2);
    expect(viewMarkOf(store, C1)).toBeNull();
    expect(viewMarkOf(store, C2)).not.toBeNull();
  });
});

describe("the upgrade (row 005-106, 005 consumer-view-design section 4)", () => {
  beforeEach(() => {
    use(releasedStore());
    land(A, "pass");
    land(B, "fail");
  });

  it("registers with the full copy and no mark on a store that keeps no birth marks", async () => {
    await delivery.register(C1);
    expect(names(store.views.list(C1))).toEqual(["a", "b"]);
    expect(viewMarkOf(store, C1)).toBeNull();
  });

  it("delivers to a session registered before the upgrade as before, with its full copy", async () => {
    await delivery.register(C1);
    ensureBirthMarks(store); // a daemon of this release starts
    land(A, "fail");
    land(N, "fail");
    expect(await told()).toEqual([
      ["a", "pass-to-fail"],
      ["n", "first-seen-fail"],
    ]);
    expect(names(store.views.list(C1))).toEqual(["a", "b", "n"]);
    expect(viewMarkOf(store, C1)).toBeNull();
    // Its next registration seeds as this release does.
    await delivery.register(C1);
    expect(names(store.views.list(C1))).toEqual(["a", "b", "n"]); // all failing now
    expect(viewMarkOf(store, C1)).not.toBeNull();
  });

  it("on record: a store that lost a trigger reads every mark as absent, as an earlier release", async () => {
    ensureBirthMarks(store);
    await delivery.register(C1);
    connectionOf(store).db.exec("DROP TRIGGER squeal_born_known_states_insert");
    unknown(A);
    expect(await told()).toBeNull(); // the PASS -> UNKNOWN of section 4's mixed case
    ensureBirthMarks(store);
    await delivery.register(C1);
    expect(viewMarkOf(store, C1)).not.toBeNull();
  });

  it("seeds the full copy and clears an earlier mark when the marks are not kept", async () => {
    ensureBirthMarks(store);
    await delivery.register(C1);
    connectionOf(store).db.exec("DROP TRIGGER squeal_born_known_states_delete");
    await delivery.register(C1);
    expect(names(store.views.list(C1))).toEqual(["a", "b"]);
    expect(viewMarkOf(store, C1)).toBeNull();
  });
});
