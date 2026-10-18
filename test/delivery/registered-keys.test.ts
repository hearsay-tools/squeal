import { beforeEach, describe, expect, it } from "vitest";
import { createDelivery, formatDelta } from "../../src/core/delivery/index.js";
import { createStateSink, registeredKeysMetaKey } from "../../src/core/state/index.js";
import {
  CONSUMER_EXPIRY_MS,
  type Consumer,
  type Delta,
  type HarnessDelivery,
  type StateSink,
  type Store,
  type TransitionEntry,
} from "../../src/core/types/index.js";
import { check, FILE, freshStore, OTHER, result, setKey, WT } from "../state/helpers.js";
import { fixedStatus, liveDaemon } from "./fakes.js";

/*
 * Review wave 2b B1 and S1 (repair 011-18r): each registration names the
 * snapshot of the keys it saw, not the first one taken at its revision, so a
 * key that grows without a revision gives a later consumer its own baseline.
 * A resumed consumer keeps its snapshot; an expired parked one does not keep
 * its snapshot alive.
 */

const S1: Consumer = { worktreeId: WT, sessionId: "s1", agentId: "main" };
const LATER: Consumer = { ...S1, sessionId: "later" };
const A = check("a");
const BASE = "0123456789abcdef0123456789abcdef01234567";
const NONE = { checkpointId: null };

let store: Store;
let sink: StateSink;
let delivery: HarnessDelivery;
let clock: number;

beforeEach(() => {
  clock = 1_000;
  store = freshStore();
  sink = createStateSink(store);
  delivery = createDelivery(store, { status: fixedStatus(), now: () => clock });
  liveDaemon(store, WT);
  store.testFiles.put({
    testFile: FILE,
    closure: {
      testFile: FILE,
      paths: ["src/a.test.ts", "src/x.ts"],
      complete: false,
      method: "static imports plus declared inputs",
    },
    updatedAt: 1,
    updatedBy: WT,
  });
  revision(["README.md"]);
  setKey(store, "k-old");
});

function revision(paths: readonly string[]): number {
  return store.revisions.append({
    worktreeId: WT,
    createdAt: 1,
    head: BASE,
    dirty: true,
    trigger: "watch",
    changes: paths.map((path) => ({ path, oldHash: null, newHash: `h-${path}` })),
  }).number;
}

/** An edit to `src/x.ts` moves the key to `k-edit`, where the check fails. */
function failAfterEdit(): void {
  const at = revision(["src/x.ts"]);
  setKey(store, "k-edit");
  const failed = result(A, "fail", { key: "k-edit" });
  const stored = { ...failed, provenance: { ...failed.provenance, revision: at } };
  store.results.putMany([stored]);
  sink.applyResults(WT, at, [stored], NONE);
}

async function delivered(consumer: Consumer) {
  const delta = await delivery.onToolBoundary(consumer);
  const entry = delta?.entries.find((e) => e.to === "fail");
  if (entry === undefined || entry.kind === "fail-retired") throw new Error("no failure delivered");
  return { entry: entry as TransitionEntry, text: formatDelta(delta as Delta) };
}

function row(): { snapshots: Record<string, string>[]; slots: Record<string, number> } {
  return JSON.parse(store.meta.get(registeredKeysMetaKey(WT)) ?? "null");
}

/** The key each consumer's snapshot holds for `FILE`. */
function keysBySession(): Record<string, string | undefined> {
  const { snapshots, slots } = row();
  return Object.fromEntries(
    Object.entries(slots).map(([slot, at]) => [
      slot.split("\n")[0],
      Object.values(snapshots[at] ?? {})[0],
    ]),
  );
}

describe("two consumers registered at one revision across a key change (B1)", () => {
  it("looks each one's baseline up at the key it saw", async () => {
    store.results.putMany([result(A, "pass", { key: "k-old", worktreeId: OTHER })]);
    await delivery.register(S1, { atStart: true });
    setKey(store, "k-grown"); // the key grows without a revision
    store.results.putMany([result(A, "fail", { key: "k-grown", worktreeId: OTHER, commit: BASE })]);
    await delivery.register(LATER, { atStart: true });
    expect(store.revisions.latest(WT)?.number).toBe(1);
    expect(keysBySession()).toEqual({ s1: "k-old", later: "k-grown" });

    failAfterEdit();
    const later = await delivered(LATER);
    expect(later.entry.beforeEdits).toMatchObject({ outcome: "fail", commit: BASE });
    expect(later.text).toContain("first observed: FAIL; it also failed before your edits (");
    expect(later.text).not.toContain("PASS -> FAIL");
    const first = await delivered(S1);
    expect(first.entry.beforeEdits).toEqual({ outcome: "pass" });
    expect(first.text).toContain("PASS -> FAIL, seen by Squeal's run at revision 2");
  });

  it("shares one snapshot between consumers that saw the same keys", async () => {
    await delivery.register(S1, { atStart: true });
    await delivery.register(LATER, { atStart: true });
    const { snapshots, slots } = row();
    expect(snapshots).toHaveLength(1);
    expect(Object.values(slots)).toEqual([0, 0]);
  });
});

describe("a parked consumer's snapshot (S1)", () => {
  it("is dropped when a fresh session registers after its expiry", async () => {
    await delivery.register(S1, { atStart: true });
    await delivery.unregister(S1);
    clock += CONSUMER_EXPIRY_MS + 1;
    revision(["README.md"]);
    setKey(store, "k-new");
    await delivery.register(LATER, { atStart: true });
    expect(keysBySession()).toEqual({ later: "k-new" });
    expect(row().snapshots).toHaveLength(1);
  });

  it("is kept through a fresh session's registration before its expiry", async () => {
    await delivery.register(S1, { atStart: true });
    await delivery.unregister(S1);
    setKey(store, "k-new");
    await delivery.register(LATER, { atStart: true });
    expect(keysBySession()).toEqual({ s1: "k-old", later: "k-new" });
  });

  it("is the one a resumed session keeps, not the keys at its return", async () => {
    store.results.putMany([result(A, "pass", { key: "k-old", worktreeId: OTHER })]);
    await delivery.register(S1, { atStart: true });
    await delivery.unregister(S1);
    setKey(store, "k-away");
    store.results.putMany([result(A, "fail", { key: "k-away", worktreeId: OTHER })]);
    await delivery.register(S1, { atStart: true });
    expect(keysBySession()).toEqual({ s1: "k-old" });
    failAfterEdit();
    expect((await delivered(S1)).entry.beforeEdits).toEqual({ outcome: "pass" });
  });

  it("is replaced when the session returns after its expiry", async () => {
    await delivery.register(S1, { atStart: true });
    await delivery.unregister(S1);
    clock += CONSUMER_EXPIRY_MS + 1;
    setKey(store, "k-new");
    await delivery.register(S1, { atStart: true });
    expect(keysBySession()).toEqual({ s1: "k-new" });
    expect(row().snapshots).toHaveLength(1);
  });
});

describe("a consumer with no snapshot", () => {
  it("reads none for a row in 0.1.217's by-revision form", async () => {
    store.results.putMany([result(A, "pass", { key: "k-old", worktreeId: OTHER })]);
    await delivery.register(S1, { atStart: true });
    store.meta.set(registeredKeysMetaKey(WT), JSON.stringify({ 1: { [FILE.path]: "k-old" } }));
    failAfterEdit();
    expect((await delivered(S1)).entry.beforeEdits).toEqual({ outcome: "none", commit: BASE });
  });
});
