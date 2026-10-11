import { describe, expect, it } from "vitest";
import {
  answerMoves,
  rekeyedMovesMetaKey,
  unrecordedRows,
} from "../../src/core/scheduler/rekeyed-moves.js";
import type { RevisionNumber, WorktreeId } from "../../src/core/types/index.js";
import { createRepo, openHarness, openRepoStore, SLOW } from "./helpers.js";

/*
 * Review wave 13ac, B1 (task 001-265): a daemon before task 001-265 writes
 * rows its re-key moves do not vouch for: one before 001-258 never writes
 * the moves, and one of 001-258 writes them without the rows' keys. The
 * first commit of a newer daemon's ledger takes such rows in: a pending one
 * as a move open at its row's revision, so a later wait holds for it until
 * its result, and the history before as lost, so a wait from before falls
 * back.
 */

const MATH = "test/math.test.ts";

describe("a newer daemon after one that wrote no keys in its moves", () => {
  it(
    "takes the row it left queued in as a move, and then vouches for every row",
    SLOW,
    async () => {
      const repo = createRepo();
      const store = openRepoStore(repo.commonDir);
      const first = await openHarness(repo.main, store, repo.commonDir);
      await first.scheduler.start();
      await first.scheduler.idle();
      await first.scheduler.close();
      const id = first.worktreeId as WorktreeId;
      const revision = first.scheduler.status().revision as RevisionNumber;
      expect(unrecordedRows(store, id)).toEqual([]);

      // The older daemon: its record has no keys, and it queued math (a held failure's re-run).
      const moves = JSON.parse(store.meta.get(rekeyedMovesMetaKey(id)) ?? "{}");
      delete moves.keys;
      store.meta.set(rekeyedMovesMetaKey(id), JSON.stringify(moves));
      const math = store.testFileKeys.list(id).find((row) => row.testFile.path === MATH);
      if (math === undefined) throw new Error("math has no row");
      store.testFileKeys.upsertMany([{ ...math, pending: "queued" }]);
      const before = moves.seq as number;
      expect(answerMoves(store, id, revision, before)).toEqual({ state: "incomplete" });

      const second = await openHarness(repo.main, store, repo.commonDir);
      await second.scheduler.start();
      await second.scheduler.idle();

      expect(unrecordedRows(store, id)).toEqual([]);
      const after = JSON.parse(store.meta.get(rekeyedMovesMetaKey(id)) ?? "{}");
      // Taken in by the commit that dropped the history before it: a wait from before falls back.
      expect(after.dropped).toBeGreaterThan(before);
      expect(answerMoves(store, id, revision, before)).toEqual({ state: "incomplete" });
      // Math's result at its key was in the store: its move resolved in that same commit, unrun.
      expect(after.files[`\0${MATH}`]).toEqual({
        open: null,
        resolved: { [math.revision]: [after.dropped, expect.any(Number)] },
      });
      expect(second.runsOf(MATH)).toHaveLength(0);
      expect(answerMoves(store, id, revision, after.dropped)).toEqual({
        state: "answered",
        rekeyed: [],
      });
    },
  );
});
