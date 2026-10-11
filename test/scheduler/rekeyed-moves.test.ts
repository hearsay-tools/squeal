import { describe, expect, it } from "vitest";
import { testFileId } from "../../src/core/keys/index.js";
import {
  answerMoves,
  MOVES_GRACE_MS,
  MOVES_RETENTION_MS,
  movesSeq,
  movesVouch,
  recordMoves,
  unrecordedRows,
} from "../../src/core/scheduler/rekeyed-moves.js";
import type { RekeyedMark } from "../../src/core/scheduler/rekeyed-record.js";
import {
  type CheckKey,
  type RevisionNumber,
  refinedMetaKey,
  type Store,
} from "../../src/core/types/index.js";
import { FILE, freshStore, WT } from "../state/helpers.js";

/*
 * Task 001-258 (research/wait-from-store.md F2, F3): the store's re-key
 * moves, one entry per test file and revision, open or resolved at a commit.
 * Each rule below is one the research found by a failing control.
 */

const ID = testFileId(FILE);
const T0 = 1_000_000;

function store(): Store {
  const s = freshStore();
  s.testFileKeys.upsertMany([
    { worktreeId: WT, testFile: FILE, key: "k" as CheckKey, revision: 1, pending: null },
  ]);
  return s;
}

/** A commit of the ledger that wrote the worktree's rows as they are. */
const commit = (
  s: Store,
  marks: RekeyedMark[],
  revision: number,
  at = T0,
  removed: string[] = [],
) =>
  s.transaction(() =>
    recordMoves(s, WT, marks, removed, revision as RevisionNumber, at, {
      written: s.testFileKeys.list(WT),
      unrecorded: [],
    }),
  );
const open = (revision: number): RekeyedMark => ({ id: ID, open: revision, moved: revision });
const resolved = (moved: number | null = null): RekeyedMark => ({ id: ID, open: null, moved });
const answer = (s: Store, upTo: number, sinceSeq: number) =>
  answerMoves(s, WT, upTo as RevisionNumber, sinceSeq);

describe("the store's re-key moves (task 001-258)", () => {
  it("is written at the first commit, and its sequence moves only when it changes", () => {
    const s = store();
    expect(movesSeq(s, WT)).toBeNull();
    expect(answer(s, 1, 0)).toEqual({ state: "incomplete" });
    commit(s, [], 0);
    expect(movesSeq(s, WT)).toBe(1);
    commit(s, [resolved()], 0);
    expect(movesSeq(s, WT)).toBe(1);
    commit(s, [open(1)], 1);
    expect(movesSeq(s, WT)).toBe(2);
  });

  it("names an open move, and a resolved one only to a wait that started before it", () => {
    const s = store();
    commit(s, [open(1)], 1);
    const start = movesSeq(s, WT) ?? 0;
    expect(answer(s, 1, start)).toEqual({
      state: "answered",
      rekeyed: [{ testFile: FILE, revision: 1 }],
    });
    commit(s, [resolved()], 1);
    expect(answer(s, 1, start)).toEqual({
      state: "answered",
      rekeyed: [{ testFile: FILE, revision: 1, resolved: true }],
    });
    expect(answer(s, 1, movesSeq(s, WT) ?? 0)).toEqual({ state: "answered", rekeyed: [] });
    // Not past the captured revision.
    expect(answer(s, 0, start)).toEqual({ state: "answered", rekeyed: [] });
  });

  // Control `noReopen` (review wave 13k, B1).
  it("opens a resolved revision again when a move goes back to it", () => {
    const s = store();
    commit(s, [open(2)], 2);
    commit(s, [resolved()], 2);
    commit(s, [open(2)], 2);
    expect(answer(s, 2, movesSeq(s, WT) ?? 0)).toEqual({
      state: "answered",
      rekeyed: [{ testFile: FILE, revision: 2 }],
    });
  });

  // Control `perFile` (review wave 13l, S1): a later move resolved first keeps the earlier one.
  it("keeps each revision's resolved move beside a later one", () => {
    const s = store();
    commit(s, [open(3)], 3);
    const start = movesSeq(s, WT) ?? 0;
    commit(s, [resolved()], 4);
    // A cached result at revision 5: moved and resolved in one commit.
    commit(s, [resolved(5)], 5);
    const named = answer(s, 5, start);
    expect(named).toEqual({
      state: "answered",
      rekeyed: [
        { testFile: FILE, revision: 3, resolved: true },
        { testFile: FILE, revision: 5, resolved: true },
      ],
    });
    expect(answer(s, 4, start)).toEqual({
      state: "answered",
      rekeyed: [{ testFile: FILE, revision: 3, resolved: true }],
    });
  });

  it("keeps the earliest and the latest open revision", () => {
    const s = store();
    commit(s, [open(2)], 2);
    commit(s, [{ id: ID, open: 2, moved: 4 }], 4);
    expect(answer(s, 4, 0)).toEqual({
      state: "answered",
      rekeyed: [
        { testFile: FILE, revision: 2 },
        { testFile: FILE, revision: 4 },
      ],
    });
  });

  it("forgets a removed file, and names no file the worktree no longer lists", () => {
    const s = store();
    commit(s, [open(1), { id: "gone", open: 1, moved: 1 }], 1);
    expect(answer(s, 1, 0)).toMatchObject({ rekeyed: [{ testFile: FILE }] });
    commit(s, [], 1, T0, [ID]);
    expect(answer(s, 1, 0)).toEqual({ state: "answered", rekeyed: [] });
  });

  it("answers nothing until the refined revision reaches the capture", () => {
    const s = store();
    commit(s, [open(2)], 2);
    s.meta.set(refinedMetaKey(WT), "1");
    expect(answer(s, 2, 0)).toEqual({ state: "refining" });
    s.meta.set(refinedMetaKey(WT), "2");
    expect(answer(s, 2, 0)).toMatchObject({ state: "answered" });
  });

  // Control `ageOnly` (reviews 13q S1, 13s B2, 13t S1).
  it("prunes an old resolved move only once refinement has been caught up for the grace", () => {
    const s = store();
    s.meta.set(refinedMetaKey(WT), "1");
    commit(s, [open(1)], 1);
    const start = movesSeq(s, WT) ?? 0;
    commit(s, [resolved()], 1);
    // Revision 2 waits for its runner part: past the hour, no commit prunes.
    commit(s, [], 2, T0 + 2 * MOVES_RETENTION_MS);
    commit(s, [], 2, T0 + 3 * MOVES_RETENTION_MS);
    expect(answer(s, 1, start)).toMatchObject({ rekeyed: [{ resolved: true }] });
    // Refined; caught up from the next commit, which does not prune within the grace.
    s.meta.set(refinedMetaKey(WT), "2");
    const caughtUp = T0 + 3 * MOVES_RETENTION_MS;
    commit(s, [], 2, caughtUp);
    commit(s, [], 2, caughtUp + MOVES_GRACE_MS - 1);
    expect(answer(s, 1, start)).toMatchObject({ rekeyed: [{ resolved: true }] });
    // Past the grace: dropped, so a wait from before it falls back; a later one reads nothing.
    commit(s, [], 2, caughtUp + MOVES_GRACE_MS);
    expect(answer(s, 2, start)).toEqual({ state: "incomplete" });
    expect(answer(s, 2, movesSeq(s, WT) ?? 0)).toEqual({ state: "answered", rekeyed: [] });
    // A new revision resets the catch-up.
    commit(s, [open(3)], 3, caughtUp + MOVES_GRACE_MS + 1);
    expect(JSON.parse(s.meta.get(`rekeyed-moves.${WT}`) ?? "{}").caughtUpAt).toBeNull();
  });

  it("keeps a resolved move younger than the retention", () => {
    const s = store();
    commit(s, [open(1)], 1);
    commit(s, [resolved()], 1, T0);
    commit(s, [], 1, T0 + MOVES_GRACE_MS);
    commit(s, [], 1, T0 + MOVES_RETENTION_MS - 1);
    expect(answer(s, 1, 0)).toMatchObject({ rekeyed: [{ resolved: true }] });
  });

  it("reads an unreadable row as none", () => {
    const s = store();
    s.meta.set(`rekeyed-moves.${WT}`, "not json");
    expect(movesSeq(s, WT)).toBeNull();
    expect(answer(s, 1, 0)).toEqual({ state: "incomplete" });
    commit(s, [open(1)], 1);
    expect(movesSeq(s, WT)).toBe(1);
  });

  // Review wave 13ac, B1 (task 001-265): a daemon before 001-258 moves a key and writes no move.
  describe("a row the record's writer did not write", () => {
    const moveUnrecorded = (s: Store, key: string, revision: number) =>
      s.testFileKeys.upsertMany([
        { worktreeId: WT, testFile: FILE, key: key as CheckKey, revision, pending: "queued" },
      ]);

    it("leaves a wait nothing to trust, whatever the record says", () => {
      const s = store();
      commit(s, [], 1);
      const start = movesSeq(s, WT) ?? 0;
      expect(movesVouch(s, WT, start, s.testFileKeys.list(WT))).toBe(true);
      moveUnrecorded(s, "k2", 2);
      s.meta.set(refinedMetaKey(WT), "2");
      expect(movesVouch(s, WT, start, s.testFileKeys.list(WT))).toBe(false);
      expect(answer(s, 2, start)).toEqual({ state: "incomplete" });
      // A move back to the recorded key at a later revision is a move too.
      moveUnrecorded(s, "k", 3);
      expect(movesVouch(s, WT, start, s.testFileKeys.list(WT))).toBe(false);
    });

    it("is not vouched for by a record from before the task", () => {
      const s = store();
      commit(s, [], 1);
      const row = JSON.parse(s.meta.get(`rekeyed-moves.${WT}`) ?? "{}");
      delete row.keys;
      s.meta.set(`rekeyed-moves.${WT}`, JSON.stringify(row));
      expect(answer(s, 1, movesSeq(s, WT) ?? 0)).toEqual({ state: "incomplete" });
      expect(unrecordedRows(s, WT)).toHaveLength(1);
    });

    it("is taken in by a ledger's first commit: a pending one as open, and as lost history", () => {
      const s = store();
      commit(s, [], 1);
      const before = movesSeq(s, WT) ?? 0;
      moveUnrecorded(s, "k2", 2);
      const unrecorded = unrecordedRows(s, WT);
      expect(unrecorded).toHaveLength(1);
      s.transaction(() =>
        recordMoves(s, WT, [], [], 2 as RevisionNumber, T0, { written: [], unrecorded }),
      );
      expect(unrecordedRows(s, WT)).toEqual([]);
      // A wait from before falls back; a later one holds for the file.
      expect(answer(s, 2, before)).toEqual({ state: "incomplete" });
      expect(answer(s, 2, movesSeq(s, WT) ?? 0)).toEqual({
        state: "answered",
        rekeyed: [{ testFile: FILE, revision: 2 }],
      });
    });

    it("is taken in with no move when it is not pending", () => {
      const s = store();
      const unrecorded = unrecordedRows(s, WT);
      s.transaction(() =>
        recordMoves(s, WT, [], [], 1 as RevisionNumber, T0, { written: [], unrecorded }),
      );
      expect(answer(s, 1, movesSeq(s, WT) ?? 0)).toEqual({ state: "answered", rekeyed: [] });
    });
  });
});
