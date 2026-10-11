import { describe, expect, it } from "vitest";
import { testFileId } from "../../src/core/keys/index.js";
import {
  adoptsAtFirstCommit,
  answerMoves,
  MOVES_GRACE_MS,
  MOVES_RETENTION_MS,
  movesSeq,
  movesTrusted,
  recordMoves,
} from "../../src/core/scheduler/rekeyed-moves.js";
import type { RekeyedMark } from "../../src/core/scheduler/rekeyed-record.js";
import {
  type CheckKey,
  daemonIncarnation,
  predecessorIncarnation,
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
const VERSION = "0.0.0-test";
/** The registered daemon's incarnation, which answered the wait's sync. */
const LIVE = daemonIncarnation({ squealVersion: VERSION, startedAt: 1 });

/** Registers the daemon started at `startedAt`. */
function register(s: Store, startedAt: number) {
  s.worktrees.setDaemon(WT, {
    socketPath: "/run/squeal.sock" as never,
    startedAt,
    heartbeatAt: T0,
    heartbeatIntervalMs: 60_000,
    squealVersion: VERSION,
  });
}

function store(): Store {
  const s = freshStore();
  s.worktrees.upsert({
    id: WT,
    root: "/repo" as never,
    commonDir: "/repo/.git" as never,
    isMain: true,
    registeredAt: 1,
    daemon: null,
  });
  register(s, 1);
  s.testFileKeys.upsertMany([
    { worktreeId: WT, testFile: FILE, key: "k" as CheckKey, revision: 1, pending: null },
  ]);
  return s;
}

/** A commit of the registered daemon's ledger, or of `writer`'s. */
const commit = (
  s: Store,
  marks: RekeyedMark[],
  revision: number,
  at = T0,
  removed: string[] = [],
  writer: string | null = LIVE,
) =>
  s.transaction(() =>
    recordMoves(s, WT, marks, removed, revision as RevisionNumber, at, { writer }),
  );
const open = (revision: number): RekeyedMark => ({ id: ID, open: revision, moved: revision });
const resolved = (moved: number | null = null): RekeyedMark => ({ id: ID, open: null, moved });
const answer = (s: Store, upTo: number, sinceSeq: number, incarnation: string | null = LIVE) =>
  answerMoves(s, WT, upTo as RevisionNumber, sinceSeq, incarnation);

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

  // Reviews wave 13ac and 13ad, B1 (tasks 001-265, 001-268): who wrote the record, and who runs now.
  describe("the writer's incarnation", () => {
    it("is trusted only while it wrote the record last and is the registered daemon", () => {
      const s = store();
      commit(s, [open(1)], 1);
      const start = movesSeq(s, WT) ?? 0;
      expect(movesTrusted(s, WT, start, LIVE)).toBe(true);
      // A sync from a daemon that names none, or from another one.
      expect(movesTrusted(s, WT, start, null)).toBe(false);
      expect(answer(s, 1, start, "0.0.0-test@2")).toEqual({ state: "incomplete" });
      // Another daemon registers: the rows may be as they were, the record is not its.
      register(s, 2);
      expect(movesTrusted(s, WT, start, LIVE)).toBe(false);
      expect(answer(s, 1, start)).toEqual({ state: "incomplete" });
      // Gone, and back: a registration is an incarnation, never a name.
      s.worktrees.setDaemon(WT, null);
      expect(movesTrusted(s, WT, start, LIVE)).toBe(false);
      register(s, 1);
      expect(movesTrusted(s, WT, start, LIVE)).toBe(true);
    });

    it("is not trusted once another writer, or one that names none, wrote the record", () => {
      const s = store();
      commit(s, [open(1)], 1);
      const start = movesSeq(s, WT) ?? 0;
      commit(s, [], 1, T0, [], "0.0.0-test@2");
      expect(answer(s, 1, start)).toEqual({ state: "incomplete" });
      commit(s, [], 1);
      expect(answer(s, 1, start)).toMatchObject({ state: "answered" });
      commit(s, [], 1, T0, [], null);
      expect(answer(s, 1, start)).toEqual({ state: "incomplete" });
      // A daemon of task 001-258 or 001-265 rewrites the record without the writer.
      commit(s, [], 1);
      const row = JSON.parse(s.meta.get(`rekeyed-moves.${WT}`) ?? "{}");
      delete row.writer;
      s.meta.set(`rekeyed-moves.${WT}`, JSON.stringify(row));
      expect(answer(s, 1, start)).toEqual({ state: "incomplete" });
    });

    it("takes in every pending row at a ledger's first commit, its moves lost before", () => {
      const s = store();
      commit(s, [], 1);
      const before = movesSeq(s, WT) ?? 0;
      // An older daemon moved the key away and back, and left the file queued: rows as recorded.
      s.testFileKeys.upsertMany([
        { worktreeId: WT, testFile: FILE, key: "k" as CheckKey, revision: 1, pending: "queued" },
      ]);
      const rows = s.testFileKeys.list(WT);
      s.transaction(() =>
        recordMoves(s, WT, [], [], 1 as RevisionNumber, T0, { writer: LIVE, before: rows }),
      );
      // A wait from before falls back; a later one holds for the file.
      expect(answer(s, 1, before)).toEqual({ state: "incomplete" });
      expect(answer(s, 1, movesSeq(s, WT) ?? 0)).toEqual({
        state: "answered",
        rekeyed: [{ testFile: FILE, revision: 1 }],
      });
    });

    it("takes in no move for a row that is not pending, and still drops the history", () => {
      const s = store();
      commit(s, [], 1);
      const before = movesSeq(s, WT) ?? 0;
      const rows = s.testFileKeys.list(WT);
      s.transaction(() =>
        recordMoves(s, WT, [], [], 1 as RevisionNumber, T0, { writer: LIVE, before: rows }),
      );
      expect(answer(s, 1, before)).toEqual({ state: "incomplete" });
      expect(answer(s, 1, movesSeq(s, WT) ?? 0)).toEqual({ state: "answered", rekeyed: [] });
    });
  });

  // Decided by the human (2026-10-11): what a ledger's first commit takes in.
  describe("the first commit's predecessor", () => {
    it("is the registration before, none without a row, unknown without its identity", () => {
      expect(predecessorIncarnation(false, null)).toBeNull();
      expect(predecessorIncarnation(true, null)).toBeUndefined();
      expect(predecessorIncarnation(true, { startedAt: 5, squealVersion: null })).toBeUndefined();
      expect(predecessorIncarnation(true, { startedAt: 5, squealVersion: VERSION })).toBe(
        `${VERSION}@5`,
      );
    });

    it("takes things in unless it wrote the moves last, or there was none", () => {
      const s = store();
      // No record yet: only a fresh worktree takes nothing in.
      expect(adoptsAtFirstCommit(s, WT, null)).toBe(false);
      expect(adoptsAtFirstCommit(s, WT, LIVE)).toBe(true);
      expect(adoptsAtFirstCommit(s, WT, undefined)).toBe(true);
      commit(s, [], 1);
      expect(adoptsAtFirstCommit(s, WT, LIVE)).toBe(false);
      expect(adoptsAtFirstCommit(s, WT, "0.1.112@2")).toBe(true);
      expect(adoptsAtFirstCommit(s, WT, undefined)).toBe(true);
      commit(s, [], 1, T0, [], null);
      expect(adoptsAtFirstCommit(s, WT, LIVE)).toBe(true);
    });
  });
});
