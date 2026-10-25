import { describe, expect, it } from "vitest";
import {
  ASKED_KEYS_META_KEY,
  type AskedKey,
  askNamedRun,
  askNoResultRun,
  askRetry,
  cancelRetries,
  endRetries,
  keptAskedKeys,
  keptRetries,
  RETRIES_KEPT,
  RETRIES_META_KEY,
  type RetryRecord,
  readAskedKeys,
  readRetries,
} from "../../src/core/retry/index.js";
import type { CheckKey, EpochMs, RevisionNumber, Store } from "../../src/core/types/index.js";
import { FILE, freshStore, WT } from "../state/helpers.js";

/*
 * Review 0.1.322 B2 (011 C15's 011-207 amendment: "no request ever stored
 * at its key"): the fact that a request was stored at a test file's key is
 * kept apart from the 1,024 requests the `retries` row keeps, in the
 * `retries-asked` meta row, written in the ask's own transaction. It stays
 * while a worktree's row holds the key, or for 7 days after its ask, up to
 * 4,096 keys. A pending request at a key a worktree holds is never trimmed.
 */

const DAY = 24 * 60 * 60 * 1_000;
const T1 = Date.UTC(2026, 9, 25) as EpochMs;
const YES = () => true;

const ask = (key: string, at = T1, session = "s1") => ({
  testFile: FILE,
  key: key as CheckKey,
  session,
  reason: "environment" as const,
  at,
  worktreeId: WT,
});

/** Worktree WT's row holds FILE at `key`. */
function holds(store: Store, key: string) {
  store.testFileKeys.upsertMany([
    {
      worktreeId: WT,
      testFile: FILE,
      key: key as CheckKey,
      revision: 1 as RevisionNumber,
      pending: null,
    },
  ]);
}

/**
 * `RETRIES_KEPT` later requests at other keys, each ended: the row at its
 * limit with the first, then the last asked and ended as a session does.
 */
function later(store: Store) {
  const end = { outcome: "passed" as const, at: T1, worktreeId: WT };
  const ended = Array.from({ length: RETRIES_KEPT - readRetries(store).length }, (_, i) => ({
    id: `other-${i}`,
    testFile: FILE,
    key: `other-${i}`,
    session: `s${i}`,
    reason: "environment",
    askedAt: T1,
    askedIn: WT,
    claim: null,
    end,
  }));
  store.meta.set(RETRIES_META_KEY, JSON.stringify([...readRetries(store), ...ended]));
  askRetry(store, ask("other-last"));
  endRetries(store, FILE, "other-last" as CheckKey, end);
}

describe("a named wait's one run at a key outlives the request log (review 0.1.322 B2)", () => {
  it("an ended request at the same key, past the log's limit, still stops a second ask", () => {
    const store = freshStore();
    expect(askNamedRun(store, ask("k1"), YES).kind).toBe("queued");
    endRetries(store, FILE, "k1" as CheckKey, { outcome: "unknown", at: T1, worktreeId: WT });
    later(store);
    expect(readRetries(store).some((r) => r.key === "k1")).toBe(false);

    expect(askNamedRun(store, ask("k1"), YES).kind).toBe("asked");
    expect(readRetries(store).filter((r) => r.key === "k1")).toEqual([]);
  });

  it("a cancelled request at the same key, past the log's limit, still stops a second ask", () => {
    const store = freshStore();
    askNoResultRun(store, ask("k1"));
    cancelRetries(store, FILE, "k1" as CheckKey, WT, T1);
    later(store);

    expect(askNamedRun(store, ask("k1"), YES).kind).toBe("asked");
  });

  it("a pending request at a key a worktree holds survives 1,024 later ended requests", () => {
    const store = freshStore();
    holds(store, "k1");
    askNoResultRun(store, ask("k1"));
    later(store);

    expect(readRetries(store).filter((r) => r.key === "k1")).toMatchObject([{ end: null }]);
    expect(readRetries(store)).toHaveLength(RETRIES_KEPT);
  });

  it("past the log's limit the ended go first, then pending ones at keys no worktree holds", () => {
    const record = (key: string, ended: boolean) =>
      ({ key, testFile: FILE, end: ended ? { outcome: "passed" } : null }) as RetryRecord;
    const records = [
      record("held", false),
      record("lapsed-1", false),
      record("ended-1", true),
      record("lapsed-2", false),
      record("ended-2", true),
    ];
    const held = (_: unknown, key: string) => key === "held";
    const kept = (cap: number) => keptRetries(records, held, cap).map((r) => r.key);

    expect(kept(5)).toEqual(["held", "lapsed-1", "ended-1", "lapsed-2", "ended-2"]);
    expect(kept(4)).toEqual(["held", "lapsed-1", "lapsed-2", "ended-2"]);
    expect(kept(3)).toEqual(["held", "lapsed-1", "lapsed-2"]);
    expect(kept(2)).toEqual(["held", "lapsed-2"]);
    expect(kept(0)).toEqual(["held"]);
  });

  it("past the asked keys' limit the lapsed go first, any age, then the oldest", () => {
    const entry = (key: string, askedAt: number) => ({ ...FILE, key, askedAt }) as AskedKey;
    const entries = [entry("held-1", T1), entry("lapsed", T1 + 1), entry("held-2", T1 + 2)];
    const held = (_: unknown, key: string) => key.startsWith("held");
    const kept = (cap: number) => keptAskedKeys(entries, held, T1, cap).map((e) => e.key);

    expect(kept(3)).toEqual(["held-1", "lapsed", "held-2"]);
    expect(kept(2)).toEqual(["held-1", "held-2"]);
    expect(kept(1)).toEqual(["held-2"]);
  });

  it("past 7 days a key no worktree holds is dropped and a held one is kept", () => {
    const store = freshStore();
    holds(store, "held");
    const old = (T1 - 8 * DAY) as EpochMs;
    askNamedRun(store, ask("held", old), YES);
    askNamedRun(store, ask("gone", old), YES);
    askNamedRun(store, ask("recent", (T1 - DAY) as EpochMs), YES);
    expect(readAskedKeys(store).map((e) => e.key)).toEqual(["held", "gone", "recent"]);

    // The next ask's write drops what aged out.
    askNamedRun(store, ask("now"), YES);

    expect(readAskedKeys(store).map((e) => e.key)).toEqual(["held", "recent", "now"]);
  });

  it("retry's own requests keep the fact too, and its answers stay as they were", () => {
    const store = freshStore();
    expect(askRetry(store, ask("k1")).kind).toBe("queued");
    expect(askRetry(store, ask("k1")).kind).toBe("spent");
    expect(askNoResultRun(store, ask("k2")).kind).toBe("queued");
    expect(askNoResultRun(store, ask("k2", T1, "s2")).kind).toBe("joined");
    expect(readAskedKeys(store)).toMatchObject([
      { project: "", path: FILE.path, key: "k1", askedAt: T1 },
      { project: "", path: FILE.path, key: "k2", askedAt: T1 },
    ]);
    expect(store.meta.get(ASKED_KEYS_META_KEY)).not.toBeNull();
  });
});
