import type { EpochMs } from "../types/common.js";
import type { Candidate, FocusPick, PlanAsks, QueueView } from "./tier-plan.js";
import type { TierFile } from "./tiers.js";

/**
 * The focused tier the plan would start, `null` when none (spec 011 C4 and
 * C15 as amended 2026-10-23, row 011-145): the waiting entries in request
 * order, of the lane of the first that may run there, up to
 * `runner.tierSize` files, each for its own texts. A lane in `busy` takes
 * none; its tier in flight may yield to the entry as to a promoted file
 * (`TierYields`). An entry that may not run goes (`PlanAsks.dropFocus`).
 * The act step starts it (`startFocusedTier`): it claims no key, leaves its
 * files queued, and counts as a tier of its named wait's group.
 */
export function focusedCandidate(
  view: QueueView,
  asks: PlanAsks,
  busy: ReadonlySet<string>,
  turnDue: boolean,
): Candidate | null {
  if (view.focusedSize() === 0 || turnFirst(view, asks, busy, turnDue)) return null;
  const picked: FocusPick[] = [];
  let lane: string | null = null;
  for (const entry of asks.focusWaiting(view.now)) {
    if (picked.length >= view.runner.tierSize) break;
    const run = view.focusRunnable(entry);
    if (run === null) {
      asks.dropFocus(entry);
      continue;
    }
    const at = view.lane(entry.ref);
    if (busy.has(at) || (lane !== null && at !== lane)) continue;
    lane = at;
    picked.push({ entry, ...run });
  }
  if (lane === null) return null;
  const files: TierFile[] = picked.map(({ file, key }) => ({
    file,
    key,
    inputs: view.inputs(file.ref),
    runtimePolicy: view.runtimePolicy(file.ref),
    checkpointId: null,
    forced: false,
  }));
  return {
    reason: "focused",
    kind: "focused",
    lane,
    files,
    focus: picked,
    width: null,
    promoted: false,
    beside: false,
    counts: "none",
    tookBacklog: false,
    estimateMs: 0,
  };
}

/**
 * Whether the backlog's turn after four tiers of the first group (C4 step
 * 4) goes before the focused tier: it is due and a file of the second
 * group may start in a free lane. A focused tier counts toward the four, so
 * a stream of focused waits cannot starve the backlog.
 */
function turnFirst(
  view: QueueView,
  asks: PlanAsks,
  busy: ReadonlySet<string>,
  turnDue: boolean,
): boolean {
  if (!turnDue) return false;
  const now: EpochMs = view.now;
  // Only a file that may start now takes the turn: a departure drain's paused
  // backlog does not, nor a file another worktree's claim holds or a stored
  // result stands for (review 0.1.280).
  return view.fastQueued((ref) => {
    const lane = view.lane(ref);
    if (busy.has(lane) || view.isFirstGroup(ref)) return false;
    if (view.quietHolds(ref, lane, { backlog: true, turn: true }, now)) return false;
    const file = view.file(ref);
    if (!file || file.key === null || file.blocked !== null) return false;
    return asks.peek(ref) === "free";
  });
}
