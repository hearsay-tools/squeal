import { testFileId } from "../keys/reverse-index.js";
import type { TestFileRef } from "../types/keys.js";
import { BacklogWall, backlogBudget } from "./backlog.js";
import { poolKind } from "./capacity.js";
import { batchBudget } from "./promoted-tier.js";
import { joinSpan, type TierSpan } from "./sharing.js";
import { joinsSlot } from "./slots.js";
import { focusedCandidate } from "./tier-focus.js";
import type { Candidate, CandidateReason, Outcome, PlanAsks, QueueView } from "./tier-plan.js";
import { estimateMs, fewest, grantFit, widest } from "./tier-width.js";
import type { Tier, TierFile } from "./tiers.js";

/**
 * One pass of the selection `selectTier` made (rows 011-265, 011-268,
 * 011-269 and 011-308): `wide` false once no batch could form a tier as the
 * backlog's; `rest`, the backlog's turn after a batch's tier
 * (`batchTurnDue`), files of the second group only; `beside`, the files a
 * tier beside a batch's tier takes, whatever lane is busy; `asEdit`, a
 * batch's tier the pool refused or granted less than an edit's tier of its
 * files runs with, picked again as an edit's: at most `runner.tierSize`
 * files and no grant. `origin` names the stage or former self-call that
 * made it.
 */
export interface Pass {
  readonly busy: ReadonlySet<string>;
  readonly turnDue: boolean;
  readonly wide: boolean;
  readonly rest: boolean;
  readonly beside: ((ref: TestFileRef) => boolean) | null;
  readonly asEdit: boolean;
  readonly origin: "main" | "slot" | "beside" | "turn-after-batch" | "after-claims";
}

/** A pass yields candidates and returns the tier that started, or `null` when it started none. */
export type Steps = Generator<Candidate, Tier | null, Outcome>;

/**
 * `selectTier`'s body, its self-calls as passes (`research/tier-plan.md`,
 * "The six self-calls"): every read through `view`, every write through
 * `asks`, each at the point and in the order `selectTier` made it. The rules
 * are `selectTier`'s, documented there.
 */
export function* pass(view: QueueView, asks: PlanAsks, p: Pass): Steps {
  const { runner } = view;
  const free = p.beside ?? ((ref: TestFileRef) => !p.busy.has(view.lane(ref)));
  // Row 011-145 (C4 as amended 2026-10-23): a focused entry's tier leads its lane. Row 011-283
  // (review 0.1.378-r2 N1): it is a tier of its wait's group, which a due post-batch turn precedes.
  // A batch's tier picked again as an edit's (row 011-308) comes after both, already asked.
  const postBatch =
    p.wide &&
    p.beside === null &&
    !p.asEdit &&
    view.batchTurn() &&
    view.hasFast((ref) => free(ref) && !view.isFirstGroup(ref));
  if (p.beside === null && !p.asEdit) {
    const focus = focusedCandidate(view, asks, p.busy, p.turnDue || postBatch);
    if (focus !== null) {
      const outcome = yield focus;
      if ("started" in outcome) return outcome.started;
    }
  }
  // Row 011-268 (review 0.1.378 B1): after a batch's tier, the backlog's turn before anything else.
  if (postBatch) {
    const rest: Pass = { ...p, turnDue: true, wide: false, rest: true, asEdit: false };
    const turnOfRest = yield* pass(view, asks, { ...rest, origin: "turn-after-batch" });
    if (turnOfRest !== null) return turnOfRest;
  }
  const picked: TierFile[] = [];
  asks.beginPass();
  // Row 011-268: a named wait's batch leads its lane, one tier of it at the whole grant.
  const batch = p.wide && p.beside === null ? batchOf(view, free) : null;
  /** The batch's tier as an edit's: no grant, at most `runner.tierSize` files (row 011-308). */
  const asEdit = p.asEdit && batch !== null;
  // The batch's turn is a turn's tier, first group queued or not: no edit's work cancels it.
  const backlog = !p.rest && (batch !== null || !view.hasFirstGroup(free));
  /** The second group's turn after four tiers of the first (C4 step 4), or after a batch's. */
  const turn = !backlog && (p.turnDue || p.rest);
  /** The tier is the turn's: it took a file of the second group first. */
  let turnTier = false;
  let size =
    batch !== null
      ? asEdit
        ? runner.tierSize
        : runner.backlogTierSize
      : backlog
        ? asks.backlogSize(view.fastSize())
        : runner.tierSize;
  const offer = backlog && !asEdit ? asks.offer(size, poolKind(view.checkpointActive())) : 0;
  const budget = (batch !== null ? batchBudget : backlogBudget)(runner.timeoutMs);
  const wall = backlog && !asEdit ? new BacklogWall(budget) : null;
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
    if (picked.length >= size) break;
    const at = view.lane(ref);
    if (!free(ref) || (lane !== null && at !== lane)) continue;
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
    if (picked.length >= cap) continue;
    if (picked.length === 0 && (backlog || (turn && !view.isFirstGroup(ref)))) {
      turnTier = !backlog;
      slot = view.backlogSlot(ref);
    } else if (slot !== null && !joinsSlot(picked, file, (r) => view.tierPart(r))) break;
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
    picked.push({ file, key, inputs, runtimePolicy, checkpointId, forced, recent, waits, catchUp });
  }
  if (p.turnDue && !turnTier && focusWaits.size > 0) {
    // A due turn that started no file of the second group leaves the lane to the waiting focused
    // entries before any whole tier (review 0.1.280 B2).
    asks.endPass();
    return yield* pass(view, asks, { ...p, turnDue: false });
  }
  if (lane !== null) {
    const granted = (backlog || turnTier) && !asEdit;
    const kind = backlog || (turnTier && slot !== null) ? "backlog" : turnTier ? "turn" : "edit";
    const width = slot !== null ? 1 : granted ? widest(view, picked) : 0;
    const least = slot !== null ? 1 : fewest(view, picked);
    const atGrant = grantFit(view, [...picked], {
      ...{ budget, offer, width, slot, trimmed, backlog },
      batch: batch !== null,
      tierSize: runner.tierSize,
    });
    const outcome = yield {
      reason: reasonOf(p, { batch: batch !== null, asEdit, backlog, turnTier }),
      kind,
      lane,
      files: picked,
      focus: null,
      width: granted
        ? {
            want: width,
            least,
            offer,
            kind: poolKind(view.checkpointActive(), picked),
            lane,
            refusalWaits: batch === null,
            atGrant,
          }
        : null,
      promoted: batch !== null,
      beside: p.beside !== null,
      counts: batch !== null ? "batch" : p.beside === null ? "tier" : "none",
      tookBacklog,
      estimateMs: estimateMs(view, picked, granted ? offer : picked.length),
    };
    if ("started" in outcome) return outcome.started;
    if ("refused" in outcome) {
      asks.endPass();
      // Row 011-308: the batch's tier does not wait for the pool; it goes at once as an edit's.
      if (batch !== null) return yield* pass(view, asks, { ...p, asEdit: true });
      // The turn holds no edit's tier back on the pool: that tier goes, and the turn after it.
      // The batch's turn stays due while the selection goes on (review 0.1.378 B1).
      return turnTier && !p.rest ? yield* pass(view, asks, { ...p, turnDue: false }) : null;
    }
    picked.splice(0, picked.length, ...outcome.unstarted);
  }
  asks.endPass();
  // Row 011-265: no promoted file could start, each waiting on another worktree's claim of its key
  // (C7): the rest of the queue starts as before this row (coordinator, request 88c59c1f).
  if (batch !== null && picked.length === 0)
    return yield* pass(view, asks, { ...p, wide: false, origin: "after-claims" });
  // A result recorded since the lookup settled a pick in the start: the queue moved (wave 13o, B1).
  const settled = picked.some((f) => !view.has(f.file.ref));
  // The edit's work settled by lookups and left only the backlog's: its slots start now.
  const slots = skipped && picked.length === 0 && !view.hasFirstGroup(free);
  return settled || slots ? yield* pass(view, asks, p) : null;
}

/** `batchFiles`: the promoted files a batch's tier takes, `null` when none is due (row 011-268). */
function batchOf(
  view: QueueView,
  free: (ref: TestFileRef) => boolean,
): ((ref: TestFileRef) => boolean) | null {
  const takes = (ref: TestFileRef) =>
    free(ref) && view.isPromoted(ref) && view.backlogSlot(ref) === null;
  return view.hasFast(takes) ? takes : null;
}

function reasonOf(
  p: Pass,
  tier: { batch: boolean; asEdit: boolean; backlog: boolean; turnTier: boolean },
): CandidateReason {
  if (p.origin === "beside" || p.origin === "turn-after-batch") return p.origin;
  if (tier.batch) return tier.asEdit ? "batch-as-edit" : "batch";
  if (p.origin !== "main") return p.origin;
  return tier.turnTier ? "turn" : tier.backlog ? "backlog" : "edit";
}
