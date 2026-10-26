import { describe, expect, it } from "vitest";
import {
  askNamedRun,
  askNoResultRun,
  askRetry,
  cancelRetries,
  claimRetries,
  endRetries,
  loadAllows,
  pendingRetriesOf,
  RETRIES_KEPT,
  RETRIES_META_KEY,
  readRetries,
  readRunLoads,
  recordRunLoad,
  releaseRetries,
  retryFactOf,
} from "../../src/core/retry/index.js";
import { FILE, freshStore, OTHER, WT } from "../state/helpers.js";

/*
 * Spec 001 D6 as amended (001-368): a retry is asked once per test file per
 * key per session; the request is kept in the shared store, claimed by one
 * daemon at its key and ended by its run.
 */

const ask = (session: string, key = "k1", reason: "load" | "environment" = "load") => ({
  testFile: FILE,
  key,
  session,
  reason,
  at: 1,
  worktreeId: WT,
});

/** A named wait's check of its file that still holds. */
const YES = () => true;

describe("askRetry", () => {
  it("queues once per session at a key; another session or another key has its own", () => {
    const store = freshStore();
    expect(askRetry(store, ask("s1")).kind).toBe("queued");
    const again = askRetry(store, ask("s1"));
    expect(again).toMatchObject({ kind: "spent", record: { session: "s1", end: null } });
    expect(askRetry(store, ask("s2")).kind).toBe("queued");
    expect(askRetry(store, ask("s1", "k2")).kind).toBe("queued");
    expect(readRetries(store)).toHaveLength(3);
  });

  it("stays spent after a run gave a result, and is free again after a cancel or a run with none", () => {
    const store = freshStore();
    askRetry(store, ask("s1"));
    endRetries(store, FILE, "k1", { outcome: "failed", at: 2, worktreeId: WT });
    expect(askRetry(store, ask("s1"))).toMatchObject({
      kind: "spent",
      record: { end: { outcome: "failed" } },
    });

    askRetry(store, ask("s2"));
    expect(cancelRetries(store, FILE, "k1", WT, 3)).toHaveLength(1);
    expect(askRetry(store, ask("s2")).kind).toBe("queued");
    endRetries(store, FILE, "k1", { outcome: "unknown", at: 4, worktreeId: WT });
    expect(askRetry(store, ask("s2")).kind).toBe("queued");
  });

  it("a run asked for a file with no result is one per pending run and spends no retry (011 C5, gh-36)", () => {
    const store = freshStore();
    expect(askNoResultRun(store, ask("s1")).kind).toBe("queued");
    expect(askNoResultRun(store, ask("s2"))).toMatchObject({
      kind: "joined",
      record: { session: "s1", noResult: true, end: null },
    });
    expect(readRetries(store)).toHaveLength(1);
    endRetries(store, FILE, "k1", { outcome: "failed", at: 2, worktreeId: WT });
    // Its run stored a failure: the session's one retry of it is still to take.
    expect(askRetry(store, ask("s1")).kind).toBe("queued");
    expect(askRetry(store, ask("s1")).kind).toBe("spent");
  });

  it("a named wait asks one run at a key with no request, pending or ended (row 011-207)", () => {
    const store = freshStore();
    expect(askNamedRun(store, ask("s1"), YES)).toMatchObject({
      kind: "queued",
      record: { noResult: true, end: null },
    });
    // A second wait at the key, while that run is pending or after it ended, asks none.
    expect(askNamedRun(store, ask("s2"), YES)).toMatchObject({
      kind: "joined",
      record: { end: null },
    });
    endRetries(store, FILE, "k1", { outcome: "unknown", at: 2, worktreeId: WT });
    expect(askNamedRun(store, ask("s2"), YES)).toEqual({ kind: "asked" });
    // A withdrawn request at the key counts as asked too; another key has none.
    askRetry(store, ask("s1", "k2"));
    cancelRetries(store, FILE, "k2", WT, 3);
    expect(askNamedRun(store, ask("s1", "k2"), YES).kind).toBe("asked");
    expect(askNamedRun(store, ask("s1", "k3"), YES).kind).toBe("queued");
    expect(readRetries(store)).toHaveLength(3);
  });

  it("a named wait's request stores nothing once its file no longer qualifies (review 0.1.322 B1)", () => {
    const store = freshStore();
    let checked = 0;
    const answer = askNamedRun(store, ask("s1"), () => {
      checked++;
      return false;
    });
    expect(answer).toEqual({ kind: "changed" });
    expect(checked).toBe(1);
    expect(readRetries(store)).toEqual([]);
    // The record guards come first: a pending request at the key is joined, no check made.
    askNoResultRun(store, ask("s2"));
    expect(askNamedRun(store, ask("s1"), () => false).kind).toBe("joined");
    expect(askNamedRun(store, ask("s1", "k2"), () => true).kind).toBe("queued");
  });

  it("a run asked for a file with no result runs at once in status and is no retry fact", () => {
    const store = freshStore();
    askNoResultRun(store, ask("s1"));
    const keys = [{ worktreeId: WT, testFile: FILE, key: "k1", revision: 1, pending: null }];
    const load = () => ({ oneMinute: 30, cpus: 8 });
    expect(pendingRetriesOf(store, keys as never, load).pendingRetries?.retries).toMatchObject([
      // The reason stays the one asked (review 011 wave 2, S1); `noResult` says it runs at once.
      { testFile: FILE, reason: ask("s1").reason, noResult: true, requests: 1 },
    ]);
    expect(retryFactOf(readRetries(store))).toBeUndefined();
  });

  it("past the limit drops the oldest pending request at a key no worktree holds", () => {
    const store = freshStore();
    for (let i = 0; i <= RETRIES_KEPT; i++) askRetry(store, ask(`s${i}`));
    const kept = readRetries(store);
    expect(kept).toHaveLength(RETRIES_KEPT);
    expect(kept[0]?.session).toBe("s1");
  });

  it("reads nothing from a row that does not parse", () => {
    const store = freshStore();
    store.meta.set(RETRIES_META_KEY, "{");
    expect(readRetries(store)).toEqual([]);
  });
});

describe("claimRetries", () => {
  it("lets one live daemon take a request; its own worktree or a dead claimant's successor takes it again", () => {
    const store = freshStore();
    askRetry(store, ask("s1"));
    const live = new Set([WT, OTHER]);
    const isLive = (id: string) => live.has(id);
    expect(claimRetries(store, FILE, "k1", WT, 5, isLive)).toBe(true);
    expect(claimRetries(store, FILE, "k1", OTHER, 6, isLive)).toBe(false);
    expect(claimRetries(store, FILE, "k1", WT, 7, isLive)).toBe(true);
    live.delete(WT);
    expect(claimRetries(store, FILE, "k1", OTHER, 8, isLive)).toBe(true);
    expect(readRetries(store)[0]?.claim).toEqual({ worktreeId: OTHER, at: 8 });
  });

  it("gives a request joining a live claimant's key to that claimant, until it dies (review 001-398, B1)", () => {
    const store = freshStore();
    const live = new Set([WT, OTHER]);
    const isLive = (id: string) => live.has(id);
    askRetry(store, ask("s1"));
    expect(claimRetries(store, FILE, "k1", WT, 5, isLive)).toBe(true);
    askRetry(store, ask("s2"));
    expect(claimRetries(store, FILE, "k1", OTHER, 6, isLive)).toBe(false);
    expect(readRetries(store).map((r) => r.claim)).toEqual([
      { worktreeId: WT, at: 5 },
      { worktreeId: WT, at: 5 },
    ]);
    live.delete(WT);
    expect(claimRetries(store, FILE, "k1", OTHER, 7, isLive)).toBe(true);
    expect(readRetries(store).map((r) => r.claim?.worktreeId)).toEqual([OTHER, OTHER]);
  });

  it("frees a claim its worktree gives back, and never takes an ended request", () => {
    const store = freshStore();
    askRetry(store, ask("s1"));
    const isLive = () => true;
    claimRetries(store, FILE, "k1", WT, 5, isLive);
    releaseRetries(store, FILE, WT);
    expect(claimRetries(store, FILE, "k1", OTHER, 6, isLive)).toBe(true);
    endRetries(store, FILE, "k1", { outcome: "passed", at: 7, worktreeId: OTHER });
    expect(claimRetries(store, FILE, "k1", OTHER, 8, isLive)).toBe(false);
  });
});

describe("loads", () => {
  it("allows a load retry below the CPU count or with no load known", () => {
    expect(loadAllows({ oneMinute: 7.9, cpus: 8 })).toBe(true);
    expect(loadAllows({ oneMinute: 8, cpus: 8 })).toBe(false);
    expect(loadAllows({ oneMinute: null, cpus: 8 })).toBe(true);
  });

  it("keeps a run's load per CPU", () => {
    const store = freshStore();
    recordRunLoad(store, "run-1", 0.5);
    recordRunLoad(store, "run-2", 1.25);
    expect(readRunLoads(store)).toEqual(
      new Map([
        ["run-1", 0.5],
        ["run-2", 1.25],
      ]),
    );
  });
});
