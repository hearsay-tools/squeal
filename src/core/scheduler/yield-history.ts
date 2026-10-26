import { testFileId } from "../keys/index.js";
import type { EpochMs, LastYield, TestFileRef, TierYield } from "../types/index.js";
import type { Tier, TierFile } from "./tiers.js";
import type { YieldRow } from "./yield-row.js";

/*
 * Row 011-209 (`research/issue-91.md` F2 to F4, spec 011 C15): what
 * `TierYields` keeps for status beside each tier's standing, all of it in
 * memory, so a restart keeps none: the last yield, a file of the first tier
 * that ended in each lane (rule C, `tasks/011-209/notes.md`), and how many
 * files of each several-file tier in flight the runner named ended.
 */

/**
 * The runner's file ends write a tier's ended count at most once in this
 * per worktree (F4; the coordinator's bound, request dd6ee382): a 1,000-file
 * tier makes no 1,000 writes beside its results.
 */
export const ENDED_WRITE_MS = 2_000;

export class YieldHistory {
  /** The last yield, until a later tier that holds a file it cut ends (F2). */
  #last: LastYield | null = null;
  /** A file of the first tier that ended in each lane of this daemon, by lane: status words lanes by its own rule. */
  readonly #lanes = new Map<string, TestFileRef>();
  /** How many files of each several-file tier in flight the runner named ended, by run id (F4). */
  readonly #ended = new Map<string, number>();
  /** When a file end last wrote the row; `null` before one did. */
  #endedAt: EpochMs | null = null;

  /**
   * `tier` yielded at `at` for `to`, its estimated remainder then
   * `remainderMs`, cutting `cut`: the remainder rule's when that exceeds
   * `bound`, else the overrun rule's (`byRemainder`).
   */
  yielded(
    at: EpochMs,
    tier: Tier,
    to: LastYield["to"],
    remainderMs: number,
    cut: readonly TierFile[],
    bound: number,
  ): void {
    this.#last = {
      at,
      runId: tier.runId,
      to,
      rule: remainderMs > bound ? "remainder" : "overrun",
      remainderMs,
      lane: tier.lane,
      files: cut.map(({ file }) => file.ref),
      runStartedAt: tier.startedAt ?? at,
      runEndedAt: null,
    };
  }

  /**
   * The runner named a file of `tier` ended at `now`: whether the row is due
   * a write of the count, at most once per `ENDED_WRITE_MS`. One inside that
   * window waits for the next write of the row, with no timer.
   */
  fileEnded(now: EpochMs, tier: Tier): boolean {
    const count = tier.ended?.size ?? 0;
    if (count === 0 || tier.files.length < 2) return false;
    this.#ended.set(tier.runId, count);
    if (this.#endedAt !== null && now - this.#endedAt < ENDED_WRITE_MS) return false;
    this.#endedAt = now;
    return true;
  }

  /**
   * `tier` ended at `now`: its count goes, its lane has had a tier end, and
   * the last yield gets its cut run's end when `tier` is that run, or goes
   * when `tier` held a file it cut. Whether what status reads changed: a
   * count alone is not, as status reads the counts of open runs only, so
   * the next write drops it.
   */
  ended(now: EpochMs, tier: Tier): boolean {
    this.#ended.delete(tier.runId);
    let changed = false;
    const [first] = tier.files;
    if (!this.#lanes.has(tier.lane) && first !== undefined) {
      this.#lanes.set(tier.lane, first.file.ref);
      changed = true;
    }
    const last = this.#last;
    if (last === null) return changed;
    if (last.runId === tier.runId) {
      if (last.runEndedAt !== null) return changed;
      this.#last = { ...last, runEndedAt: now };
      return true;
    }
    const cut = new Set(last.files.map(testFileId));
    if (!tier.files.some(({ file }) => cut.has(file.id))) return changed;
    this.#last = null;
    return true;
  }

  /** The row to publish, with `tiers`, the standings of the tiers in flight. */
  row(tiers: ReadonlyMap<string, TierYield>): YieldRow {
    return { tiers, ended: this.#ended, last: this.#last, lanes: this.#lanes };
  }
}
