import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { OVERRUN_FLOOR_MS } from "../../src/core/scheduler/overrun.js";
import { UNWRITTEN_RETRY_MS, yieldsMetaKey } from "../../src/core/scheduler/yields.js";
import { storePaths } from "../../src/core/store/paths.js";
import type { AbsolutePath } from "../../src/core/types/common.js";
import { facts, hung, overrunsOf } from "./overrun-fixture.js";
import { settle } from "./tier-yields-fixture.js";

/*
 * Review 0.1.567-r2 B2 (row 011-399): a calendar step after the overrun is
 * published moves it in memory; when the store refuses that one write
 * (SQLITE_BUSY: another connection holds `BEGIN IMMEDIATE` just then), the
 * row is owed, and a check queued by its own wake writes it once the lock is
 * free, with no file event. Before the repair the row kept the old start:
 * status read 3,662 s run and a deadline 3,062 s past, for a tier that had
 * run 62 s of a 600 s timeout.
 */

const HOUR = 3_600_000;
const TIMEOUT_MS = 600_000;

/**
 * The next write of the `yields` row meets a write lock another connection
 * takes just for it and releases after: the write throws a real SQLite busy
 * error. Returns how many writes it refused.
 */
function refuseNextWrite(side: Awaited<ReturnType<typeof hung>>["side"]): { refused: number } {
  const other = new DatabaseSync(storePaths(join(side.root, ".git") as AbsolutePath).database);
  const meta = side.store.meta;
  const set = meta.set.bind(meta);
  const seen = { refused: 0 };
  let armed = true;
  meta.set = (key, value) => {
    if (!armed || key !== yieldsMetaKey(side.worktreeId)) return set(key, value);
    armed = false;
    other.exec("BEGIN IMMEDIATE");
    try {
      return set(key, value);
    } catch (error) {
      if ((error as { errcode?: number }).errcode === 5) seen.refused += 1;
      throw error;
    } finally {
      other.exec("ROLLBACK");
      other.close();
    }
  };
  return seen;
}

describe("a refused calendar republish of an overrun is written again (review 0.1.567-r2 B2)", {
  timeout: 120_000,
}, () => {
  for (const shift of [HOUR, -HOUR]) {
    it(`the calendar set ${shift > 0 ? "forward" : "back"} 1 h after publication, its write refused once`, async () => {
      const { side, hung: gate, beside, start, clock } = await hung();
      side.advance(OVERRUN_FLOOR_MS);
      await settle(side);
      expect(overrunsOf(side).map((o) => o.startedAt)).toEqual([start]);

      const refusal = refuseNextWrite(side);
      clock.shiftCalendar(shift);
      side.advance(UNWRITTEN_RETRY_MS);
      await settle(side);
      expect(refusal.refused).toBe(1);
      side.advance(UNWRITTEN_RETRY_MS);
      await settle(side);

      // The lock is free: the row and memory agree, with no file event.
      const [overrun] = overrunsOf(side);
      expect(overrun?.startedAt).toBe(start + shift);
      expect(overrun?.at).toBe(start + shift + OVERRUN_FLOOR_MS);
      expect(overrun?.deadline).toBe(start + shift + TIMEOUT_MS);
      const ran = OVERRUN_FLOOR_MS + 2 * UNWRITTEN_RETRY_MS;
      expect(facts(side)).toEqual({ ranMs: ran, leftMs: TIMEOUT_MS - ran });
      gate.stop();
      beside.stop();
    });
  }
});
