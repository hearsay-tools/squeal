import { beforeEach, describe, expect, it } from "vitest";
import { createDelivery } from "../../src/core/delivery/index.js";
import { writeTurn } from "../../src/core/delivery/turn.js";
import { createStateSink } from "../../src/core/state/index.js";
import type { Consumer, HarnessDelivery, Store, TestFileRef } from "../../src/core/types/index.js";
import { check, result, setKey, WT } from "../state/helpers.js";
import { fakeCommonDir, open } from "../store/helpers.js";
import { fixedStatus } from "./fakes.js";

/*
 * Task 001-414: on a shared store other daemons commit every few seconds, so
 * the change marker (task 001-178) moves on most polls. A waiter whose turn
 * owes test files then reads those files' states and view entries, not the
 * worktree's, and gives the same answer.
 */

const C1: Consumer = { worktreeId: WT, sessionId: "s1", agentId: "main" };
const FILES = 400;
const PER_FILE = 15;
const POLLS = 240;
const NONE = { checkpointId: null };

const fileRef = (i: number): TestFileRef => ({ project: "", path: `src/f${i}.test.ts` });
const OWED = fileRef(7);

/** Rows each repository read returned, by `repo.method`, and the unscoped listings. */
interface Reads {
  readonly rows: Map<string, number>;
  readonly unscoped: Map<string, number>;
}

function counted(store: Store): { store: Store; reads: Reads } {
  const reads: Reads = { rows: new Map(), unscoped: new Map() };
  const add = (map: Map<string, number>, at: string, n: number) =>
    map.set(at, (map.get(at) ?? 0) + n);
  const wrap = (name: string, repo: object) =>
    new Proxy(repo, {
      get(target, method, receiver) {
        const value = Reflect.get(target, method, receiver);
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => {
          const at = `${name}.${String(method)}`;
          const out = value.apply(target, args);
          if (Array.isArray(out)) add(reads.rows, at, out.length);
          if (method === "list" && args.length === 1) add(reads.unscoped, at, 1);
          return out;
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

const poll = (delivery: HarnessDelivery) => delivery.waitForDelta(C1, { timeoutMs: 0 });

let commonDir: string;
let store: Store;
let other: Store;
let revision: number;

function land(file: TestFileRef, outcome: "pass" | "fail", at: Store = other): void {
  createStateSink(at, { now: () => 3 }).applyResults(
    WT,
    ++revision,
    [result(check(`${file.path} t0`, file), outcome, { revision })],
    NONE,
  );
}

beforeEach(async () => {
  commonDir = fakeCommonDir();
  store = open(commonDir);
  other = open(commonDir);
  revision = 1;
  const files = Array.from({ length: FILES }, (_, f) => fileRef(f));
  store.testFileKeys.upsertMany(
    files.map((testFile) => ({ worktreeId: WT, testFile, key: "k1", revision, pending: null })),
  );
  const results = files.flatMap((file) =>
    Array.from({ length: PER_FILE }, (_, t) => result(check(`${file.path} t${t}`, file), "pass")),
  );
  createStateSink(store, { now: () => 1 }).applyResults(WT, revision, results, NONE);
  const setup = createDelivery(store, { status: fixedStatus(), now: () => 1 });
  await setup.register(C1);
  setKey(store, "k1", { file: OWED, pending: "queued" });
  await setup.endTurn(C1);
});

describe("a waiter whose turn owes test files, on a store other connections commit to (task 001-414)", () => {
  it("reads only the owed files' states and view entries per poll", async () => {
    const { store: watched, reads } = counted(store);
    const delivery = createDelivery(watched, { status: fixedStatus(), now: () => 2 });
    for (let i = 0; i < POLLS; i++) {
      other.meta.set("heartbeat", String(i));
      expect(await poll(delivery)).toBeNull();
    }
    expect(reads.unscoped.get("knownStates.list") ?? 0).toBe(0);
    expect(reads.unscoped.get("views.list") ?? 0).toBe(0);
    expect(reads.rows.get("knownStates.list") ?? 0).toBeLessThanOrEqual(POLLS * PER_FILE);
    expect(reads.rows.get("views.list") ?? 0).toBeLessThanOrEqual(POLLS * PER_FILE);
  });

  it("still wakes for the owed file's result within one poll", async () => {
    const delivery = createDelivery(store, { status: fixedStatus(), now: () => 2 });
    expect(await poll(delivery)).toBeNull();
    land(OWED, "fail");
    const delta = await poll(delivery);
    expect(delta?.entries.map((e) => [e.kind, e.check.testPath])).toEqual([
      ["pass-to-fail", OWED.path],
    ]);
  });

  it("stays silent for another file's result, as before", async () => {
    const delivery = createDelivery(store, { status: fixedStatus(), now: () => 2 });
    land(fileRef(8), "fail");
    expect(await poll(delivery)).toBeNull();
    land(fileRef(9), "fail", store);
    expect(await poll(delivery)).toBeNull();
  });

  it("stops owing a file whose result landed quiet, then reads no state", async () => {
    const { store: watched, reads } = counted(store);
    const delivery = createDelivery(watched, { status: fixedStatus(), now: () => 2 });
    setKey(other, "k1", { file: OWED });
    land(OWED, "pass");
    expect(await poll(delivery)).toBeNull();
    reads.rows.clear();
    for (let i = 0; i < 10; i++) {
      other.meta.set("heartbeat", String(i));
      expect(await poll(delivery)).toBeNull();
    }
    expect(reads.rows.get("knownStates.list") ?? 0).toBe(0);
  });
});

describe("a waiter that awaits new test files (task 001-414)", () => {
  beforeEach(() => {
    store.transaction(() =>
      writeTurn(store, C1, { turn: "idle", testFiles: [], newTestFiles: true, revision: 50 }),
    );
  });

  it("reads only the states its consumer was never told", async () => {
    const { store: watched, reads } = counted(store);
    const delivery = createDelivery(watched, { status: fixedStatus(), now: () => 2 });
    for (let i = 0; i < POLLS; i++) {
      other.meta.set("heartbeat", String(i));
      expect(await poll(delivery)).toBeNull();
    }
    expect(reads.unscoped.get("knownStates.list") ?? 0).toBe(0);
    expect(reads.rows.get("knownStates.list") ?? 0).toBe(0);
  });

  it("wakes for a new file's first failure", async () => {
    const delivery = createDelivery(store, { status: fixedStatus(), now: () => 2 });
    expect(await poll(delivery)).toBeNull();
    const fresh = fileRef(FILES + 1);
    setKey(other, "k1", { file: fresh });
    land(fresh, "fail");
    const delta = await poll(delivery);
    expect(delta?.entries.map((e) => [e.kind, e.check.testPath])).toEqual([
      ["first-seen-fail", fresh.path],
    ]);
  });
});
