import { testFileId } from "../keys/reverse-index.js";
import type { TestFileRef } from "../types/keys.js";
import { BacklogWall, backlogBudget, shareBudget } from "./backlog.js";
import { poolKind } from "./capacity.js";
import { batchBudget } from "./promoted-tier.js";
import { joinSpan, type TierSpan } from "./sharing.js";
import { joinsSlot } from "./slots.js";
import type { Pass } from "./tier-pass.js";
import type { PlanAsks, QueueView } from "./tier-plan.js";
import type { TierFile } from "./tiers.js";

/** What a pass selects, decided before its files are picked. */
export interface Shape {
  readonly free: (ref: TestFileRef) => boolean;
  /** Row 011-268: a named wait's batch leads its lane, one tier of it at the whole grant. */
  readonly batch: ((ref: TestFileRef) => boolean) | null;
  /** The batch's tier as an edit's: no grant, at most `runner.tierSize` files (row 011-308). */
  readonly asEdit: boolean;
  /** The batch's turn is a turn's tier, first group queued or not: no edit's work cancels it. */
  readonly backlog: boolean;
  /** The second group's turn after four tiers of the first (C4 step 4), or after a batch's. */
  readonly turn: boolean;
  readonly size: number;
  readonly offer: number;
  /** The wall budget at the offer: `budgetAt(offer)`. */
  readonly budget: number;
  /**
   * The wall budget of a tier run `workers` wide: a backlog tier's scales with
   * their share of its full width (row 011-418); a batch's is whole.
   */
  readonly budgetAt: (workers: number) => number;
}

export function shapeOf(
  view: QueueView,
  asks: PlanAsks,
  p: Pass,
  free: (ref: TestFileRef) => boolean,
): Shape {
  const { runner } = view;
  const batch = p.wide && p.beside === null ? batchFiles(view, free) : null;
  const asEdit = p.asEdit && batch !== null;
  // A tier beside another is an edit's (row 011-269), also when it takes backlog files beside a
  // tier that overruns (row 011-399): `runner.tierSize` files, no grant, in the second instance.
  const backlog = !p.rest && p.beside === null && (batch !== null || !view.hasFirstGroup(free));
  const turn = !backlog && (p.turnDue || p.rest);
  const size =
    batch !== null
      ? asEdit
        ? runner.tierSize
        : runner.backlogTierSize
      : backlog
        ? asks.backlogSize(view.fastSize())
        : runner.tierSize;
  // Row 011-412: a named wait's batch is offered as it is granted, outside the ceiling (021 D18).
  const kind = poolKind(view.checkpointActive(), undefined, batch !== null);
  const offer = backlog && !asEdit ? asks.offer(size, kind) : 0;
  const full = (batch !== null ? batchBudget : backlogBudget)(runner.timeoutMs);
  // Row 011-418: a backlog tier offered few workers selects little and is chosen again soon.
  const widest = backlog && batch === null ? asks.fullWidth() : null;
  const budgetAt = (workers: number) => shareBudget(full, workers, widest);
  const budget = budgetAt(offer);
  return { free, batch, asEdit, backlog, turn, size, offer, budget, budgetAt };
}

/** The files a pass picked and what the pick found on the way. */
export interface Pick {
  readonly files: TierFile[];
  /** The tier is the turn's: it took a file of the second group first. */
  readonly turnTier: boolean;
  /** The files a backlog slot takes at most, once its first file's runner runs slots. */
  readonly slot: number | null;
  /** A backlog file left to a lane's slots by an edit's tier. */
  readonly skipped: boolean;
  /** The wall budget left a file out: an edit's tier would have taken more (review 0.1.413 B1). */
  readonly trimmed: boolean;
  readonly tookBacklog: boolean;
  readonly lane: string | null;
  /** How many focused entries wait. */
  readonly focusWaits: number;
}

/** A pass's pick loop: the files of one lane in queue order, asked lazily up to the tier's size. */
export function pickFiles(view: QueueView, asks: PlanAsks, p: Pass, shape: Shape): Pick {
  const { batch, backlog, turn, offer } = shape;
  const files: TierFile[] = [];
  const wall = backlog && !shape.asEdit ? new BacklogWall(shape.budget) : null;
  let { size } = shape;
  let turnTier = false;
  let batchRank: number | null = null;
  let span: TierSpan | null = null;
  let tookBacklog = false;
  let lane: string | null = null;
  let slot: number | null = null;
  let skipped = false;
  let trimmed = false;
  const { now } = view;
  // Row 011-145 (review 0.1.280 B2): a file whose focused entry waits runs focused first.
  const focusWaits = new Set(asks.focusWaiting(now).map((e) => testFileId(e.ref)));
  const order =
    batch === null ? view.ordered(p.turnDue || p.rest) : view.orderedBatches().filter(batch);
  for (const ref of order) {
    if (files.length >= size) break;
    const at = view.lane(ref);
    if (!shape.free(ref) || (lane !== null && at !== lane)) continue;
    // The batch's turn takes the second group's files only: an edit's tier does not stand for it.
    if (p.rest && view.isFirstGroup(ref)) continue;
    if (focusWaits.has(testFileId(ref))) continue;
    // One batch per tier: the order holds the earlier batch's files first (row 011-268).
    const rank = batch === null ? null : view.rankAt(ref, now);
    if (batchRank !== null && rank !== batchRank) break;
    // Rows 011-82 and 011-153: a lane that waits for quiet starts no backlog tier, nor catch-up.
    if (view.quietHolds(ref, at, { backlog: backlog && batch === null, turn }, now)) continue;
    const file = view.file(ref);
    const key = file?.key ?? null;
    if (!file || key === null || file.blocked !== null) {
      asks.drop(ref);
      continue;
    }
    const forced = view.isForced(ref);
    const recent = view.isRecent(ref);
    const catchUp = view.isCatchUp(ref);
    // A lane of slots runs the backlog's files there: an edit's tier takes only the edit's work
    // (task 011-21 slice 2), except on the turn after four first-group tiers (wave-4 slice 2, B2).
    if (!backlog && !view.isFirstGroup(ref) && !turn && view.backlogSlot(ref) !== null) {
      skipped = true;
      continue;
    }
    let waits = false;
    if (!forced) {
      const found = asks.lookup(file, key);
      if (found === "settled") continue;
      waits = found.mayWait && !recent;
      if (waits && asks.held(key, now)) continue;
    }
    const cap = Math.min(size, file.tierCap ?? size);
    if (files.length >= cap) continue;
    if (files.length === 0 && (backlog || (turn && !view.isFirstGroup(ref)))) {
      turnTier = !backlog;
      slot = view.backlogSlot(ref);
    } else if (slot !== null && !joinsSlot(files, file, (r) => view.tierPart(r))) break;
    if (!backlog && slot === null) {
      const joined = joinSpan(span, file.durationMs, view.cut.cutPastEstimate(file));
      if (joined === null) continue;
      span = joined;
    }
    if (
      slot === null &&
      wall !== null &&
      !wall.take(file.durationMs, view.tierWidth(ref, offer), view.tierPart(ref))
    ) {
      trimmed = true;
      break;
    }
    tookBacklog ||= !recent && !view.isPromoted(ref);
    lane = at;
    batchRank ??= rank;
    size = Math.min(cap, slot ?? cap);
    const checkpointId = view.checkpointIdFor(ref);
    const inputs = view.inputs(ref);
    const runtimePolicy = view.runtimePolicy(ref);
    files.push({ file, key, inputs, runtimePolicy, checkpointId, forced, recent, waits, catchUp });
  }
  return {
    files,
    turnTier,
    slot,
    skipped,
    trimmed,
    tookBacklog,
    lane,
    focusWaits: focusWaits.size,
  };
}

/**
 * The promoted files (C15) a batch's tier takes, or `null` when none is due
 * (spec 011 C4 step 5 and C15 as amended 2026-10-29, row 011-268,
 * `research/named-wait-batches.md` Recommendation 1: at 11 workers the
 * 56-file gate's verdict took 364 and 327 s in a one-lane replay against
 * 1,978 and 2,053 s recorded).
 *
 * Such a tier is due while a free lane, whose runner runs its backlog in
 * tiers, holds a promoted file, whether or not an edit's work is queued. It
 * holds the files of one batch, the first with a file that can start, in
 * `RunQueue.orderedBatches`' order, longest first. It is chosen as the
 * backlog's, a grant from the pool, with no wall budget: up to
 * `runner.backlogTierSize` files within `batchBudget`. It never waits for
 * the pool (C10 Capacity and C15 as amended 2026-11-07, row 011-308): when
 * the pool refuses it, or grants fewer workers than an edit's tier of its
 * files runs with, it starts at once as an edit's tier would, at most
 * `runner.tierSize` of its files with no grant (the plan's `batch-as-edit`),
 * and the rest of the batch leads the lane's next selection. In flight it is
 * a backlog tier (`Tier.promoted`). Its files stay in their batch while
 * they run, so only a revision that supersedes it cancels it, an edit's
 * work does not make it yield (`cancelsBacklog`, `TierYields`, row
 * 011-265), and a later batch's file ranks after its own and does not cut
 * it (`rankToBeat`). It does not count toward the four first-group tiers
 * before the backlog's turn; after it, while a file of the second group is
 * queued, the backlog's turn is due (`batchTurnDue`). A lane's wait for
 * quiet does not hold it (row 011-82). When none of its files can start,
 * each waiting on another worktree's claim of its key (C7), the selection
 * runs again without this rule (the plan's `after-claims`), so the backlog does
 * not stall behind the claim.
 *
 * A lane whose runner runs its backlog in slots (`backlogSlot`: node:test,
 * pytest) keeps its promoted files in an edit's tier: its backlog tier is
 * one slot, narrower than `runner.tierSize` (coordinator, 2026-10-28).
 */
function batchFiles(
  view: QueueView,
  free: (ref: TestFileRef) => boolean,
): ((ref: TestFileRef) => boolean) | null {
  const takes = (ref: TestFileRef) =>
    free(ref) && view.isPromoted(ref) && view.backlogSlot(ref) === null;
  return view.hasFast(takes) ? takes : null;
}
