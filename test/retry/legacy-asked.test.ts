import { describe, expect, it, vi } from "vitest";
import {
  ASKED_KEYS_META_KEY,
  askNamedRun,
  askRetry,
  endRetries,
  RETRIES_KEPT,
  RETRIES_META_KEY,
  type RetryRecord,
  readAskedKeys,
  readRetries,
} from "../../src/core/retry/index.js";
import { writeRetries } from "../../src/core/retry/records.js";
import type { CheckKey, EpochMs, RevisionNumber, Store } from "../../src/core/types/index.js";
import { FILE, freshStore, WT } from "../state/helpers.js";
import * as released from "./released-0.1.323.js";

/*
 * Row 011-224 (review 0.1.322-r2, B2): a request an older Squeal stored has
 * no `retries-asked` fact. `writeRetries` writes the fact of every request
 * in the row, dropped and kept, before its trim, and a named wait writes
 * the facts it finds at its key; so once a new Squeal has written the row,
 * no trim, its own or an older Squeal's, lets a named wait ask again there.
 * One that an older Squeal stores and drops before any new write has no
 * fact: a named wait asks one run there, then none.
 */

const T1 = Date.UTC(2026, 9, 26) as EpochMs;
const K = "k1" as CheckKey;
const YES = () => true;

const ask = (key: string, session = "s1") => ({
  testFile: FILE,
  key: key as CheckKey,
  session,
  reason: "environment" as const,
  at: T1,
  worktreeId: WT,
});

/** Worktree WT's row holds FILE at K, unqueued. */
function holdsK(store: Store) {
  store.testFileKeys.upsertMany([
    { worktreeId: WT, testFile: FILE, key: K, revision: 1 as RevisionNumber, pending: null },
  ]);
}

/** The released writer stores a request at K and ends it so. */
const legacy = {
  ended(store: Store) {
    released.askNoResultRun(store, ask(K));
    released.endRetries(store, FILE, K, { outcome: "unknown", at: T1, worktreeId: WT });
  },
  cancelled(store: Store) {
    released.askRetry(store, ask(K));
    released.cancelRetries(store, FILE, K, WT, T1);
  },
};

/** `count` ended requests at other keys, as a released writer stores them. */
function others(prefix: string, count: number) {
  const end = { outcome: "passed" as const, at: T1, worktreeId: WT };
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}-${i}`,
    testFile: FILE,
    key: `${prefix}-${i}`,
    session: `s${i}`,
    reason: "environment",
    askedAt: T1,
    askedIn: WT,
    claim: null,
    end,
  }));
}

/** Fills the row to its limit with ended requests at other keys. */
function fill(store: Store) {
  const records = readRetries(store);
  const more = others("other", RETRIES_KEPT - records.length);
  store.meta.set(RETRIES_META_KEY, JSON.stringify([...records, ...more]));
}

let asks = 0;

/** One more request at a new key, by the candidate or by the released writer: the oldest is trimmed. */
const trims = {
  candidate: (store: Store) => askRetry(store, ask(`last-${asks++}`)),
  released: (store: Store) => released.askRetry(store, ask(`last-${asks++}`)),
};

const atK = (store: Store) => readRetries(store).filter((r) => r.key === K);

describe("a request an older Squeal stored keeps its one-run fact (row 011-224)", () => {
  it.each(["ended", "cancelled"] as const)(
    "%s by the released writer, then dropped by the candidate's trim: a named wait asks nothing",
    (end) => {
      const store = freshStore();
      legacy[end](store);
      fill(store);
      expect(readAskedKeys(store)).toEqual([]);

      trims.candidate(store);
      expect(atK(store)).toEqual([]);

      expect(askNamedRun(store, ask(K), YES).kind).toBe("asked");
      expect(atK(store)).toEqual([]);
    },
  );

  it.each(["ended", "cancelled"] as const)(
    "%s by the released writer, then dropped by the released trim after one candidate write: a named wait asks nothing",
    (end) => {
      const store = freshStore();
      legacy[end](store);
      askRetry(store, ask("other-first"));
      fill(store);

      trims.released(store);
      expect(atK(store)).toEqual([]);

      expect(askNamedRun(store, ask(K), YES).kind).toBe("asked");
      expect(atK(store)).toEqual([]);
    },
  );

  it.each(["candidate", "released"] as const)(
    "the re-review's order, with the %s trim: a wait's answer at a request it finds keeps the fact",
    (trim) => {
      const store = freshStore();
      holdsK(store);
      legacy.ended(store);
      expect(askNamedRun(store, ask(K), YES).kind).toBe("asked");
      fill(store);

      trims[trim](store);
      expect(atK(store)).toEqual([]);

      expect(askNamedRun(store, ask(K), YES).kind).toBe("asked");
      expect(atK(store)).toEqual([]);
    },
  );

  it("stored and dropped by older Squeals before any new write: one named wait asks one run, the next none", () => {
    const store = freshStore();
    legacy.ended(store);
    fill(store);
    trims.released(store);
    expect(atK(store)).toEqual([]);

    expect(askNamedRun(store, ask(K), YES).kind).toBe("queued");
    endRetries(store, FILE, K, { outcome: "unknown", at: T1, worktreeId: WT });
    // The row as 1,024 later requests by an older Squeal leave it.
    store.meta.set(RETRIES_META_KEY, JSON.stringify(others("newer", RETRIES_KEPT)));

    expect(askNamedRun(store, ask(K, "s2"), YES).kind).toBe("asked");
    expect(atK(store)).toEqual([]);
  });

  it("writes the facts of a full row once, and not again when none is new", () => {
    const store = freshStore();
    legacy.ended(store);
    fill(store);
    const set = vi.spyOn(store.meta, "set");
    const ledgerWrites = () => set.mock.calls.filter(([key]) => key === ASKED_KEYS_META_KEY).length;

    writeRetries(store, readRetries(store));
    expect(ledgerWrites()).toBe(1);
    expect(readAskedKeys(store)).toHaveLength(RETRIES_KEPT);

    writeRetries(
      store,
      readRetries(store).map((r): RetryRecord => ({ ...r, claim: { worktreeId: WT, at: T1 } })),
    );
    expect(ledgerWrites()).toBe(1);
  });
});
