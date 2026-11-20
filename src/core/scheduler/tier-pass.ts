import type { TestFileRef } from "../types/keys.js";
import { poolKind } from "./capacity.js";
import { focusedCandidate } from "./tier-focus.js";
import { type Pick, pickFiles, type Shape, shapeOf } from "./tier-pick.js";
import type { Candidate, CandidateReason, Outcome, PlanAsks, QueueView } from "./tier-plan.js";
import { estimateMs, fewest, grantFit, widest } from "./tier-width.js";
import type { Tier, TierFile } from "./tiers.js";

/**
 * One pass of the tier plan's selection (rows 011-265, 011-268,
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
 * One pass of the tier plan (`research/tier-plan.md`, rows 011-346 and
 * 011-349): the next tier from the queue as the latest revision ordered
 * it, offered as a candidate to the act step (`startNext`). Every read goes
 * through `view`, every write through `asks`, each at the point and in the
 * order the selection made it before the plan; the former self-calls are
 * nested passes ("The six self-calls"). The rules:
 *
 * Spec 001 D5: "runs them in tiers of a configurable size (default 4 test
 * files). Between tiers it re-plans against the latest revision." Each key is
 * looked up once more just before it would run, because another worktree may
 * have stored it meanwhile (`Ledger.lookup`, spec 004 D6); forced entries
 * skip the lookup. Returns the tier that started, or `null` when none did:
 * slow files are never in these tiers (spec 004 D2, `selectSlowTier`).
 *
 * While no queued file is recent or promoted (spec 011 C15), the tier is
 * the backlog's: up to `runner.backlogTierSize` files, cancelled by the next
 * edit (D5 step 5 as amended, task 001-124; lessons, defect 25: 559 tiers of
 * 4 took 4.6 h where one `npm test` took 514 s). It takes one file per
 * worker it will run with at the grant the pool offers (`tierWidth`), then
 * more while their estimated wall time stays within `backlogBudget`
 * (`BacklogWall`, spec 011 C4 step 5 as amended, task 001-366). The budget
 * bounds the selection, not the run: unknown durations count 0 and the
 * first round is always taken. A runner that cannot cancel runs its backlog
 * in slots instead (`backlogSlot`, C4 step 5 as amended for slots, task
 * 011-21 slice 2): a backlog tier of its lane is one slot, one file, or a
 * pytest batch of light files (`joinsSlot`), and asks the pool for one
 * permit; its lane holds up to `runner.tierSize` of them (`busyLanes`). An
 * edit's tier of such a lane takes only the edit's work: the backlog's
 * files run in the slots, which hold the permits.
 *
 * A named wait's batch (C15) leads its lane, an edit's work queued or not:
 * its tier holds one batch's files, longest first, as the backlog's at the
 * grant, with no wall budget but the run's deadline (`batchFiles`, C4 step
 * 5 as amended 2026-10-29, row 011-268). It never starts later or narrower
 * than an edit's tier would (C10 Capacity and C15 as amended 2026-11-07,
 * row 011-308): when the pool refuses it, or grants fewer workers than an
 * edit's tier of its first `runner.tierSize` files runs with, the grant goes
 * back and it is picked again as an edit's (`asEdit`): at most
 * `runner.tierSize` of its files, longest first, with no grant, stated to
 * the pool while it runs as an edit's tier is (`executeTier`). It is still a
 * batch's tier, and the rest of the batch leads the lane's next selection.
 * The backlog's turn and a wait for
 * quiet do not hold it and it does not count toward the turn. After it,
 * while a file of the second group is queued, the backlog's turn is due
 * (`batchTurnDue`), edits queued or not: selected with `rest`, a turn's tier
 * of the second group's files only (review `reviews/0.1.378.md` B1); when
 * none can start, the selection goes on as before. When no promoted file can start,
 * each waiting on another worktree's claim of its key, the queue's other
 * files start as before (`wide`). With `beside`, it selects an edit's tier
 * of those files only, in a lane a batch's tier holds (row 011-269): it
 * runs in the lane's second instance and counts toward no turn.
 *
 * A tier holds the files of one lane, the lane of the first file it takes;
 * files of a lane in `busy` (`busyLanes`), which takes no tier now, stay
 * queued and are not looked up (task 001-140). Whether the tier is the
 * backlog's is decided on the free lanes' files.
 *
 * Any other tier takes a file only beside files of a comparable last-known
 * time (`joinSpan`, task 001-184): a tier stores its results when it ends,
 * so a file far slower than one already taken waits for the next tier
 * instead of holding the faster file's result (lessons, defect 31). Nor
 * does it hold both a file a yield `cut` past its tier's estimate and one
 * it did not so cut (row 011-112): the file the tier yielded to does not
 * wait for the cut files to run again from their start.
 *
 * A file a timed-out tier left incomplete joins a tier of at most its
 * `tierCap` files; one that does not fit stays queued and leads a later tier
 * (task 001-179).
 *
 * A missed file another worktree's result could stand for, whose key another
 * live worktree is running, stays queued in its place and does not count
 * against the budget (`Claims`, D5 step 4 as amended, task 001-205); a
 * backlog tier is split with the other daemons that have its keys pending
 * (`Claims.backlogSize`).
 *
 * A lane that waits for quiet after its backlog tier's cancel
 * (`BacklogQuiet`, C4 step 5 as amended 2026-10-21, row 011-82) takes no
 * backlog tier: its files stay queued, as a busy lane's do. Its edit's work
 * and the turn below start as before. A lane whose catch-up of an edit waits
 * for quiet (as amended 2026-10-23, row 011-153) starts no tier of catch-up,
 * the turn's included; an edit's tier still takes catch-up files beside its
 * own, as it takes the backlog's, and the rest of the queue starts as before.
 *
 * The second group's turn after four tiers of the first (C4 step 4, catch-up
 * first) is selected while an edit's work is queued, so it is never
 * cancelled and holds `runner.tierSize` files of a comparable time; it still
 * takes the backlog's grant, and in a lane of slots it is one slot (review
 * W4r of wave 4, task 011-22). Where the pool makes it wait, the edit's tier
 * goes first and the turn comes after it.
 *
 * A backlog tier takes its grant from the per-user pool after its files are
 * picked and before `startTier` claims their keys, so a daemon that waits for
 * capacity holds no claim (D11 Capacity, task 001-376). It asks for no more
 * workers than its runner runs it with, and a grant below the offer trims
 * the picked tail to the same rule at the grant (task 001-366), and no fewer
 * than its runner runs it with at a grant of 1 (`fewest`, row 011-97: a
 * Vitest project with `isolate: false` runs 2). It waits while
 * no permit it may take is free, holding none: the pump looks again when a
 * tier of this daemon ends and at least every `CAPACITY_RECHECK_MS` (011 C10
 * as amended 2026-10-21, row 011-96). An edit's tier takes no grant and
 * never waits on the pool.
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
    ...{ budgetAt: shape.budgetAt, offer, width, slot, trimmed: pick.trimmed, backlog, batch },
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
          kind: poolKind(view.checkpointActive(), files, batch),
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
