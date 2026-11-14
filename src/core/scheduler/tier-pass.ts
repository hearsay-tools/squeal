import type { TestFileRef } from "../types/keys.js";
import { poolKind } from "./capacity.js";
import { focusedCandidate } from "./tier-focus.js";
import { type Pick, pickFiles, type Shape, shapeOf } from "./tier-pick.js";
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
  const free = p.beside ?? ((ref: TestFileRef) => !p.busy.has(view.lane(ref)));
  // Row 011-145 (C4 as amended 2026-10-23): a focused entry's tier leads its lane. Row 011-283
  // (review 0.1.378-r2 N1): it is a tier of its wait's group, which a due post-batch turn precedes.
  // A batch's tier picked again as an edit's (row 011-308) comes after both, already asked.
  const postBatch = p.wide && p.beside === null && !p.asEdit && batchTurnDue(view, free);
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
  asks.beginPass();
  const shape = shapeOf(view, asks, p, free);
  const pick = pickFiles(view, asks, p, shape);
  if (p.turnDue && !pick.turnTier && pick.focusWaits > 0) {
    // A due turn that started no file of the second group leaves the lane to the waiting focused
    // entries before any whole tier (review 0.1.280 B2).
    asks.endPass();
    return yield* pass(view, asks, { ...p, turnDue: false });
  }
  let picked: readonly TierFile[] = pick.files;
  if (pick.lane !== null) {
    const outcome = yield candidateOf(view, p, shape, { ...pick, lane: pick.lane });
    if ("started" in outcome) return outcome.started;
    if ("refused" in outcome) {
      asks.endPass();
      // Row 011-308: the batch's tier does not wait for the pool; it goes at once as an edit's.
      if (shape.batch !== null) return yield* pass(view, asks, { ...p, asEdit: true });
      // The turn holds no edit's tier back on the pool: that tier goes, and the turn after it.
      // The batch's turn stays due while the selection goes on (review 0.1.378 B1).
      return pick.turnTier && !p.rest ? yield* pass(view, asks, { ...p, turnDue: false }) : null;
    }
    picked = outcome.unstarted;
  }
  asks.endPass();
  // Row 011-265: no promoted file could start, each waiting on another worktree's claim of its key
  // (C7): the rest of the queue starts as before this row (coordinator, request 88c59c1f).
  if (shape.batch !== null && picked.length === 0)
    return yield* pass(view, asks, { ...p, wide: false, origin: "after-claims" });
  // A result recorded since the lookup settled a pick in the start: the queue moved (wave 13o, B1).
  const settled = picked.some((f) => !view.has(f.file.ref));
  // The edit's work settled by lookups and left only the backlog's: its slots start now.
  const slots = pick.skipped && picked.length === 0 && !view.hasFirstGroup(shape.free);
  return settled || slots ? yield* pass(view, asks, p) : null;
}

/** The candidate of a pick of one lane: its kind, its grant ask and what it counts toward. */
function candidateOf(
  view: QueueView,
  p: Pass,
  shape: Shape,
  pick: Pick & { readonly lane: string },
): Candidate {
  const { backlog, asEdit, offer } = shape;
  const { files, turnTier, slot, lane } = pick;
  const batch = shape.batch !== null;
  const granted = (backlog || turnTier) && !asEdit;
  // The turn's slot is a slot as any other; its runner cannot cancel it (C4 step 5).
  const kind = backlog || (turnTier && slot !== null) ? "backlog" : turnTier ? "turn" : "edit";
  const width = slot !== null ? 1 : granted ? widest(view, files) : 0;
  const atGrant = grantFit(view, [...files], {
    ...{ budget: shape.budget, offer, width, slot, trimmed: pick.trimmed, backlog, batch },
    tierSize: view.runner.tierSize,
  });
  return {
    reason: reasonOf(p, { batch, asEdit, backlog, turnTier }),
    kind,
    lane,
    files: [...files],
    focus: null,
    width: granted
      ? {
          want: width,
          least: slot !== null ? 1 : fewest(view, files),
          offer,
          kind: poolKind(view.checkpointActive(), files),
          lane,
          // Row 011-309: a refusal holds the lane's files, unless the batch's tier goes on as an
          // edit's; a grant ends the lane's wait either way (review 0.1.413 B2).
          refusalWaits: !batch,
          atGrant,
        }
      : null,
    promoted: batch,
    beside: p.beside !== null,
    // A batch's tier does not count toward the backlog's turn (row 011-268); one beside it counts
    // toward neither (row 011-269).
    counts: batch ? "batch" : p.beside === null ? "tier" : "none",
    tookBacklog: pick.tookBacklog,
    estimateMs: estimateMs(view, files, granted ? offer : files.length),
  };
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

/**
 * The backlog's turn is due after a batch's tier (row 011-268,
 * Recommendation 4; review `reviews/0.1.378.md` B1): a batch's tier was
 * selected while the second group waited, no tier has taken a file of it
 * since, and one is queued in a free lane. It is C4 step 4's turn after
 * four first-group tiers: selected while an edit's work is queued,
 * `runner.tierSize` files of a comparable time, a grant, cancelled only by
 * supersession and cut by no wait (`TierKind` `turn`). An edit's tier does
 * not discharge it. A stream of waits then moves the backlog by one tier
 * after each batch tier, and the gate's verdict does not move (435 s
 * against 1,607 s for the unnamed files' first result in the heavy stream).
 */
function batchTurnDue(view: QueueView, free: (ref: TestFileRef) => boolean): boolean {
  return view.batchTurn() && view.hasFast((ref) => free(ref) && !view.isFirstGroup(ref));
}
