import { describe, expect, it } from "vitest";
import { testFileId } from "../../src/core/keys/index.js";
import {
  answerMoves,
  movesSeq,
  rekeyedMovesMetaKey,
} from "../../src/core/scheduler/rekeyed-moves.js";
import type { CheckKey, RevisionNumber, WorktreeId } from "../../src/core/types/index.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import { createRepo, openHarness, openRepoStore, SLOW } from "./helpers.js";
import { HARNESS_INCARNATION, liveDaemon } from "./store-wait.js";

/*
 * Reviews wave 13ac and 13ad, B1 (tasks 001-265, 001-268): a daemon before
 * task 001-258 writes no re-key moves, and its key moved away and back at
 * one revision leaves the rows as the record last named them. So the first
 * commit of a newer daemon's ledger after one that did not write the moves
 * last takes in every pending row, whatever wrote it: as a move open at its
 * row's revision, so a later wait holds for it until its result, and the
 * history before as lost, so a wait from before falls back. After a newer
 * daemon that did, or on a fresh worktree, it takes nothing in (decided by
 * the human, 2026-10-11).
 */

const OLDER = "0.1.112@2";
const NEXT = "0.0.0-test@3";

const MATH = "test/math.test.ts";

describe("a newer daemon after one that wrote no moves", () => {
  it(
    "takes in the row it left queued, its key moved away and back at one revision",
    SLOW,
    async () => {
      const repo = createRepo();
      const store = openRepoStore(repo.commonDir);
      const first = await openHarness(repo.main, store, repo.commonDir, {
        predecessor: null,
        policy: RUN_MISSING,
      });
      await first.scheduler.start();
      await first.scheduler.idle();
      await first.scheduler.close();
      liveDaemon(store, first.worktreeId, repo.main, repo.commonDir);
      const id = first.worktreeId as WorktreeId;
      const revision = first.scheduler.status().revision as RevisionNumber;
      const before = movesSeq(store, id) ?? 0;

      // The older daemon: math's key moves away and back at its revision, math left queued.
      const math = store.testFileKeys.list(id).find((row) => row.testFile.path === MATH);
      if (math === undefined) throw new Error("math has no row");
      store.testFileKeys.upsertMany([{ ...math, key: "elsewhere" as CheckKey, pending: "queued" }]);
      store.testFileKeys.upsertMany([{ ...math, pending: "queued" }]);

      // An older daemon registered in between.
      const second = await openHarness(repo.main, store, repo.commonDir, { predecessor: OLDER });
      await second.scheduler.start();
      await second.scheduler.idle();

      const after = JSON.parse(store.meta.get(rekeyedMovesMetaKey(id)) ?? "{}");
      // Taken in by the commit that dropped the history before it: a wait from before falls back.
      expect(after.dropped).toBeGreaterThan(before);
      expect(answerMoves(store, id, revision, before, HARNESS_INCARNATION)).toEqual({
        state: "incomplete",
      });
      // Math's result at its key was in the store: its move resolved in that same commit, unrun.
      expect(after.files[testFileId({ project: "", path: MATH as never })]).toEqual({
        open: null,
        resolved: { [math.revision]: [after.dropped, expect.any(Number)] },
      });
      expect(second.runsOf(MATH)).toHaveLength(0);
      expect(answerMoves(store, id, revision, after.dropped, HARNESS_INCARNATION)).toEqual({
        state: "answered",
        rekeyed: [],
      });
    },
  );

  it(
    "takes nothing in after a newer daemon that wrote the moves, nor on a fresh worktree",
    SLOW,
    async () => {
      const repo = createRepo();
      const store = openRepoStore(repo.commonDir);
      const first = await openHarness(repo.main, store, repo.commonDir, { predecessor: null });
      await first.scheduler.start();
      await first.scheduler.idle();
      await first.scheduler.close();
      const id = first.worktreeId as WorktreeId;
      const fresh = JSON.parse(store.meta.get(rekeyedMovesMetaKey(id)) ?? "{}");
      expect(fresh.dropped).toBe(0);

      // Math left queued with no move, as a backlog file is: not the edit's.
      const math = store.testFileKeys.list(id).find((row) => row.testFile.path === MATH);
      if (math === undefined) throw new Error("math has no row");
      store.testFileKeys.upsertMany([{ ...math, pending: "queued" }]);
      const before = JSON.parse(store.meta.get(rekeyedMovesMetaKey(id)) ?? "{}");

      const second = await openHarness(repo.main, store, repo.commonDir, {
        predecessor: HARNESS_INCARNATION,
        incarnation: NEXT,
      });
      await second.scheduler.start();
      await second.scheduler.idle();

      const after = JSON.parse(store.meta.get(rekeyedMovesMetaKey(id)) ?? "{}");
      expect(after.dropped).toBe(before.dropped);
      expect(after.writer).toBe(NEXT);
      expect(after.files[testFileId({ project: "", path: MATH as never })]).toBeUndefined();
    },
  );
});
