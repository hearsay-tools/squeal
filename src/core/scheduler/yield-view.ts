import { testFileId } from "../keys/reverse-index.js";
import type { EpochMs } from "../types/common.js";
import type { CheckKey, TestFileRef } from "../types/keys.js";
import { NOTHING_CHANGED } from "./context.js";
import type { FileState } from "./files.js";
import type { PromotionRank } from "./promotions.js";
import { Priority, priorityOf } from "./queue.js";
import type { CutFiles } from "./sharing.js";
import { isIdle, type PlanAsks, planTiers, type QueueView } from "./tier-plan.js";

/*
 * Row 011-348 (`research/tier-plan.md`, decision 2): a yield's "would the
 * waiting file start sooner" check asks the tier plan, over a queue view of
 * the queue after the cut. The view holds the cut files and the waiting file
 * only, with no saved result, no claim and no pool, as the check modelled it
 * before this row (row 011-263): the plan forms an edit's tiers of them. A
 * view of the whole live queue is a later rule change, asked of the human.
 */

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

/** C15's rank, then C4's class and last-known duration, as `RunQueue.ordered` sorts promoted files. */
type Order = readonly [rank: number, priority: Priority, durationMs: number];

/**
 * Spec 011 C4 step 5 and C15 Rank as amended 2026-10-28 (row 011-263, gh-121,
 * `research/issue-121.md` F3; the coordinator chose this rule, request
 * 143b0a81): whether a yield that cuts `cut` starts `promoted` before the
 * tier's estimated remainder. The cut files keep their promotions, so those
 * that rank before it go back to the queue ahead of it: C15's rank, then C4's
 * order, class and last-known duration. On a full tie the promoted file goes
 * first, as the cut queues its files after it. The tier plan forms tiers of
 * that queue as it forms an edit's (`runner.tierSize`, `joinSpan`), the
 * tier's other files joining where they share. It starts sooner when it
 * joins the first, or when the tiers before its own end, each at its longest
 * last-known duration (a file with none counts 0, as the remainder counts
 * it), before the remainder. In F3 a later wait's 1 ms file cut three 308 s
 * files an earlier wait selected, and they ran again first: 308 s against
 * the 298 s the tier had left. Queued files are not read: one that ranks
 * first is a promoted file the yield starts sooner, or one that waits behind
 * it as before.
 */
export function startsSooner(cut: AfterCut, promoted: Promoted, marks: CutFiles): boolean {
  const own = orderOf(promoted.file, promoted.rank, promoted.priority);
  const ahead: { file: FileState; order: Order }[] = [];
  const behind: FileState[] = [];
  for (const { file, rank } of cut.files) {
    const order =
      rank === null ? null : orderOf(file, rank.rank, priorityOf(file, NOTHING_CHANGED));
    if (order !== null && compare(order, own) < 0) ahead.push({ file, order });
    else behind.push(file);
  }
  if (ahead.length === 0) return true;
  ahead.sort((a, b) => compare(a.order, b.order));
  const cutIds = new Set(cut.files.map(({ file }) => file.id));
  const view = yieldView(
    [...ahead.map(({ file }) => file), promoted.file, ...behind],
    cut.size,
    (file) => (cutIds.has(file.id) ? cut.past : marks.cutPastEstimate(file)),
  );
  let startMs = 0;
  for (;;) {
    const next = planTiers(view, YIELD_ASKS).first;
    if (isIdle(next)) return false;
    if (next.files.some(({ file }) => file.id === promoted.file.id))
      return startMs === 0 || startMs < cut.remainderMs;
    startMs += Math.max(0, ...next.files.map(({ file }) => file.durationMs ?? 0));
    if (startMs > 0 && startMs >= cut.remainderMs) return false;
    for (const { file } of next.files) view.started(file.ref);
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

/** A yield's model holds no key: its files stand for the tiers they would run in. */
const NO_KEY = "yield-view" as CheckKey;

/**
 * The yield's asks: no saved result settles a file, no claim holds one, no
 * pool is asked (an edit's tier takes no grant), nothing is written.
 */
const YIELD_ASKS: PlanAsks = {
  beginPass: () => {},
  focusWaiting: () => [],
  dropFocus: () => {},
  peek: () => "free",
  drop: () => {},
  lookup: () => ({ mayWait: false }),
  held: () => false,
  backlogSize: (queued) => queued,
  offer: (want) => want,
  endPass: () => {},
  claimsWaiting: () => false,
};

/**
 * A queue of `files` in their order, one lane, the first group only: the
 * plan forms an edit's tiers of them, at most `size` files each, sharing by
 * `cut`'s marks. A file's key, block and tier cap are not read, as the check
 * modelled them before the plan (row 011-263). `started` takes a tier's
 * files out, so the next plan forms the tier after it.
 */
function yieldView(
  files: readonly FileState[],
  size: number,
  cut: (file: FileState) => boolean,
): QueueView & { started(ref: TestFileRef): void } {
  const queued = new Map(
    files.map((file) => [file.id, { ...file, key: NO_KEY, blocked: null, tierCap: null }]),
  );
  const of = (ref: TestFileRef) => queued.get(testFileId(ref));
  const has = (ref: TestFileRef) => of(ref) !== undefined;
  const some = (where: (ref: TestFileRef) => boolean) =>
    [...queued.values()].some((file) => where(file.ref));
  return {
    now: 0 as EpochMs,
    runner: { tierSize: size, backlogTierSize: size, timeoutMs: null },
    cut: { cutPastEstimate: (file) => cut(file) },
    slots: false,
    busy: () => new Set(),
    turnDue: () => false,
    beside: () => null,
    lane: () => "",
    tierWidth: (_, grant) => grant,
    tierPart: () => "",
    backlogSlot: () => null,
    file: of,
    inputs: () => [],
    runtimePolicy: () => "",
    checkpointIdFor: () => null,
    checkpointActive: () => null,
    ordered: () => [...queued.values()].map((file) => file.ref),
    orderedBatches: () => [],
    rankAt: () => null,
    has,
    isFirstGroup: has,
    isForced: () => false,
    isRecent: () => false,
    isCatchUp: () => false,
    isPromoted: () => false,
    hasFast: some,
    fastQueued: some,
    hasFirstGroup: some,
    fastSize: () => queued.size,
    batchTurn: () => false,
    quietHolds: () => false,
    quietWakeMs: () => null,
    focusedSize: () => 0,
    focusRunnable: () => null,
    started: (ref) => {
      const file = of(ref);
      if (file !== undefined) queued.delete(file.id);
    },
  };
}
