import { describe, expect, it } from "vitest";
import type { SyncState } from "../../../src/cli/status-sync.js";
import { type FileClasses, unsynced } from "../../../src/cli/verdict.js";
import { passReached, selectionReady } from "../../../src/cli/wait/synced.js";

/*
 * Row 011-331: the one rule "has the daemon's pass reached this read", as
 * pure rows. Each copy it replaced is a row: the edit wait's `isSynced` and
 * window, the named wait's `readiness`, the snapshot's `ready`, and
 * `unsynced` at a timeout.
 */

const SYNCED: SyncState = { state: "synced", revision: 5, incarnation: "i" };
const PENDING: SyncState = { state: "pending" };
const UNSUPPORTED: SyncState = { state: "unsupported" };

const classes = (revision: number, unlisted = false): FileClasses => ({
  revision,
  testFiles: 1,
  byClass: { current: 1, pending: 0, stale: 0, unknown: 0 },
  unlisted,
});

describe("passReached: the daemon's pass reached this read (row 011-331)", () => {
  it.each([
    ["synced, the read at the pass's revision", SYNCED, 5, false, true],
    ["synced, the read past it", SYNCED, 6, false, true],
    ["synced, the read before it: the edit may be missing", SYNCED, 4, true, false],
    ["unsupported, the settle time passed (edit and named)", UNSUPPORTED, 4, true, true],
    ["unsupported, before the settle time", UNSUPPORTED, 4, false, false],
    ["unsupported, the snapshot: never", UNSUPPORTED, 9, false, false],
    ["pending: never, even at the deadline", PENDING, 9, true, false],
  ] as const)("%s", (_name, sync, revision, fallback, reached) => {
    expect(passReached(sync, revision, fallback)).toBe(reached);
  });

  it("is the negation of `unsynced`, the snapshot's fallback never, a wait's at its timeout", () => {
    for (const sync of [SYNCED, PENDING, UNSUPPORTED]) {
      for (const revision of [4, 5, 6]) {
        for (const snapshot of [false, true]) {
          expect(unsynced(sync, revision, snapshot)).toBe(!passReached(sync, revision, !snapshot));
        }
      }
    }
  });
});

describe("selectionReady: a named selection may be decided (row 011-331)", () => {
  it.each([
    ["synced and listed at the pass's revision", SYNCED, classes(5), false, true],
    ["synced, the revision not listed", SYNCED, classes(5, true), true, false],
    ["synced, before the pass's revision", SYNCED, classes(4), true, false],
    [
      "unsupported after the settle time, unlisted or not (named)",
      UNSUPPORTED,
      classes(4, true),
      true,
      true,
    ],
    ["unsupported, the snapshot: never", UNSUPPORTED, classes(4), false, false],
    ["pending: never", PENDING, classes(9), true, false],
  ] as const)("%s", (_name, sync, all, fallback, ready) => {
    expect(selectionReady(sync, all, fallback)).toBe(ready);
  });
});
