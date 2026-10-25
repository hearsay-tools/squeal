import { describe, expect, it } from "vitest";
import {
  askRetry,
  claimRetries,
  endRetries,
  gateClosedSince,
  markGateClosed,
  RETRIES_META_KEY,
  readRetries,
  releaseRetries,
} from "../../src/core/retry/index.js";
import { FILE, freshStore, WT } from "../state/helpers.js";

/*
 * Spec 011 C5 as amended (row 011-213): the time a daemon first met the load
 * gate closed on a `load` request, kept on each pending request at the key;
 * the earliest governs, since one run ends them all.
 */

const ask = (session: string, key = "k1") => ({
  testFile: FILE,
  key,
  session,
  reason: "load" as const,
  at: 1,
  worktreeId: WT,
});

describe("markGateClosed", () => {
  it("stamps each pending request at the key once; the earliest time governs", () => {
    const store = freshStore();
    askRetry(store, ask("s1"));
    askRetry(store, ask("s1", "k2"));
    expect(markGateClosed(store, readRetries(store), FILE, "k1", 100)).toBe(100);
    // A later session joining the key gets its own time; the first one still governs.
    askRetry(store, ask("s2"));
    expect(markGateClosed(store, readRetries(store), FILE, "k1", 200)).toBe(100);
    expect(markGateClosed(store, readRetries(store), FILE, "k1", 300)).toBe(100);
    expect(readRetries(store).map((r) => [r.key, r.session, r.gateClosedAt])).toEqual([
      ["k1", "s1", 100],
      ["k2", "s1", undefined],
      ["k1", "s2", 200],
    ]);
  });

  it("writes nothing when every pending request at the key has a time", () => {
    const store = freshStore();
    askRetry(store, ask("s1"));
    markGateClosed(store, readRetries(store), FILE, "k1", 100);
    const row = store.meta.get(RETRIES_META_KEY);
    store.meta.set(RETRIES_META_KEY, "changed behind the caller's read");
    expect(markGateClosed(store, readRetries(freshStoreOf(row)), FILE, "k1", 200)).toBe(100);
    expect(store.meta.get(RETRIES_META_KEY)).toBe("changed behind the caller's read");
  });

  it("leaves an ended request unstamped", () => {
    const store = freshStore();
    askRetry(store, ask("s1"));
    endRetries(store, FILE, "k1", { outcome: "failed", at: 5, worktreeId: WT });
    askRetry(store, ask("s2"));
    expect(markGateClosed(store, readRetries(store), FILE, "k1", 100)).toBe(100);
    expect(readRetries(store).map((r) => r.gateClosedAt)).toEqual([undefined, 100]);
  });

  it("is kept by every writer of the row: a claim, a release and an end", () => {
    const store = freshStore();
    askRetry(store, ask("s1"));
    markGateClosed(store, readRetries(store), FILE, "k1", 100);
    claimRetries(store, FILE, "k1", WT, 150, () => true);
    expect(readRetries(store)[0]).toMatchObject({ gateClosedAt: 100, claim: { worktreeId: WT } });
    releaseRetries(store, FILE, WT);
    expect(readRetries(store)[0]).toMatchObject({ gateClosedAt: 100, claim: null });
    askRetry(store, ask("s2", "k2"));
    endRetries(store, FILE, "k1", { outcome: "passed", at: 200, worktreeId: WT });
    expect(readRetries(store)[0]).toMatchObject({ gateClosedAt: 100, end: { outcome: "passed" } });
  });
});

describe("gateClosedSince", () => {
  it("is the earliest time among the requests, null when none has one", () => {
    const store = freshStore();
    askRetry(store, ask("s1"));
    expect(gateClosedSince(readRetries(store))).toBeNull();
    markGateClosed(store, readRetries(store), FILE, "k1", 100);
    expect(gateClosedSince(readRetries(store))).toBe(100);
  });
});

/** A store whose retries row is `row`, as another process read it before a change. */
function freshStoreOf(row: string | null) {
  const store = freshStore();
  if (row !== null) store.meta.set(RETRIES_META_KEY, row);
  return store;
}
