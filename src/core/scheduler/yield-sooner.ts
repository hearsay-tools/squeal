import { NOTHING_CHANGED } from "./context.js";
import type { FileState } from "./files.js";
import type { PromotionRank } from "./promotions.js";
import { Priority, priorityOf } from "./queue.js";
import { type CutFiles, joinSpan, type TierSpan } from "./sharing.js";

/** A file of a tier in flight that has not ended, and C15's rank it holds, which a cut keeps (row 011-193). */
export interface RankedFile {
  readonly file: FileState;
  readonly rank: PromotionRank | null;
}

/** What a yield would cut, as `startsSooner` reads it. */
export interface AfterCut {
  /** The tier's files that have not ended: the cut queues them again. */
  readonly files: readonly RankedFile[];
  /** `runner.tierSize`: the most files an edit's tier after the cut takes. */
  readonly size: number;
  /** The cut marks its files past their tier's estimate (`CutFiles`, row 011-112). */
  readonly past: boolean;
  /** The tier's estimated remainder, as the yield reads it. */
  readonly remainderMs: number;
}

/** A promoted file queued in the tier's lane: C15's rank and the class it is queued with (`RunQueue.priorityOf`). */
export interface Promoted {
  readonly file: FileState;
  readonly rank: number;
  readonly priority: Priority;
}

/** A file of the queue after the cut; `cut` when it shares a tier only with files so marked (`joinSpan`). */
interface Requeued {
  readonly file: FileState;
  readonly cut: boolean;
}

/** C15's rank, then C4's class and last-known duration, as `RunQueue.ordered` sorts promoted files. */
type Order = readonly [rank: number, priority: Priority, durationMs: number];

/**
 * Spec 011 C4 step 5 and C15 Rank as amended 2026-10-28 (row 011-263, gh-121,
 * `research/issue-121.md` F3; the coordinator chose this rule, request
 * 143b0a81): whether a yield that cuts `cut` starts `promoted` before the
 * tier's estimated remainder. The cut files keep their promotions, so those
 * that rank before it go back to the queue ahead of it: C15's rank, then C4's
 * order, class and last-known duration. On a full tie the promoted file goes
 * first, as the cut queues its files after it. Tiers form from them as
 * selection forms an edit's (`runner.tierSize`, `joinSpan`), the tier's other
 * files joining where they share. It starts sooner when it joins the first,
 * or when the tiers before its own end, each at its longest last-known
 * duration (a file with none counts 0, as the remainder counts it), before
 * the remainder. In F3 a later wait's 1 ms file cut three 308 s files an
 * earlier wait selected, and they ran again first: 308 s against the 298 s
 * the tier had left. Queued files are not read: one that ranks first is a
 * promoted file the yield starts sooner, or one that waits behind it as
 * before.
 */
export function startsSooner(cut: AfterCut, promoted: Promoted, marks: CutFiles): boolean {
  const own = orderOf(promoted.file, promoted.rank, promoted.priority);
  const ahead: { file: FileState; order: Order }[] = [];
  const behind: Requeued[] = [];
  for (const { file, rank } of cut.files) {
    const order =
      rank === null ? null : orderOf(file, rank.rank, priorityOf(file, NOTHING_CHANGED));
    if (order !== null && compare(order, own) < 0) ahead.push({ file, order });
    else behind.push({ file, cut: cut.past });
  }
  if (ahead.length === 0) return true;
  ahead.sort((a, b) => compare(a.order, b.order));
  const it: Requeued = { file: promoted.file, cut: marks.cutPastEstimate(promoted.file) };
  let left = [...ahead.map(({ file }) => ({ file, cut: cut.past })), it, ...behind];
  let startMs = 0;
  for (;;) {
    const tier = takes(left, cut.size);
    if (tier.includes(it)) return startMs === 0 || startMs < cut.remainderMs;
    startMs += Math.max(0, ...tier.map(({ file }) => file.durationMs ?? 0));
    if (startMs > 0 && startMs >= cut.remainderMs) return false;
    left = left.filter((file) => !tier.includes(file));
  }
}

/** Where `file` sorts among promoted files; an unknown duration last, but an `edited` file's first. */
function orderOf(file: FileState, rank: number, priority: Priority): Order {
  const unknown = priority === Priority.edited ? 0 : Number.POSITIVE_INFINITY;
  return [rank, priority, file.durationMs ?? unknown];
}

function compare(a: Order, b: Order): number {
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** The files an edit's tier takes from `left`, in order: each that shares while it holds fewer than `size` (`selectTier`). */
function takes(left: readonly Requeued[], size: number): Requeued[] {
  const tier: Requeued[] = [];
  let span: TierSpan | null = null;
  for (const file of left) {
    if (tier.length >= size) break;
    const joined = joinSpan(span, file.file.durationMs, file.cut);
    if (joined === null) continue;
    span = joined;
    tier.push(file);
  }
  return tier;
}
