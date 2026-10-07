import { checkIdentity, type Observation, transitionKind } from "../state/index.js";
import type {
  AbsolutePath,
  CheckId,
  DeltaEntry,
  DeltaKind,
  DiagnosticFingerprint,
  EpochMs,
  KnownState,
  RevisionNumber,
  Transition,
  ViewEntry,
  WorktreeId,
} from "../types/index.js";

/** What one delivery tells a consumer and how its view changes. */
export interface DeltaPlan {
  /** Notable differences, failures first. */
  readonly entries: readonly DeltaEntry[];
  /** View entries to write: every delivered entry plus first observations written silently. */
  readonly writes: readonly ViewEntry[];
  /** Checks in the view that have no known state any more (retired); told failures among them are entries. */
  readonly removals: readonly CheckId[];
}

export interface PlanInput {
  readonly view: readonly ViewEntry[];
  readonly states: readonly KnownState[];
  readonly isBaselineFinding: (
    check: CheckId,
    fingerprint: DiagnosticFingerprint | null,
  ) => boolean;
  readonly toldAt: EpochMs;
  /** Root of a registered worktree, for naming the origin of inherited results. */
  readonly rootOf: (worktreeId: WorktreeId) => AbsolutePath | null;
  /** Current revision: `observedAt` of a retired entry and of a state never observed. */
  readonly revision: RevisionNumber;
  /**
   * Transitions of a check in this worktree, oldest first
   * (`TransitionRepo.history`). Read only for a failing check the consumer
   * was never told about; without it such a check is first observed.
   */
  readonly history?: (check: CheckId) => readonly Transition[];
}

/**
 * What a failing check was before it started failing, from the audit log,
 * when the log ends at the current failure; `null` when it has no state
 * before the failure. A consumer registered before a check's first pass was
 * never told the pass, yet the pass was known: the delta reads `PASS -> FAIL`
 * from it, not "first observed" (goal 3). Changed failures are walked past,
 * since the consumer was told none of them. A pass followed only by unknown
 * results (a runner crash between runs) is the state before the failure too
 * (task 001-101).
 */
export function beforeFailing(
  history: readonly Transition[],
  state: Pick<KnownState, "outcome" | "fingerprint">,
): Observation | null {
  const last = history.at(-1);
  if (state.outcome !== "fail" || last?.to !== "fail" || last.toFingerprint !== state.fingerprint) {
    return null;
  }
  const at = history.findLastIndex((t) => t.kind !== "fail-changed");
  const entered = history[at];
  if (entered?.from == null) return null;
  const passed = entered.from === "unknown" ? passBeforeUnknown(history, at) : null;
  return passed ?? { outcome: entered.from, fingerprint: entered.fromFingerprint };
}

/** The pass the transitions into unknown before `end` left, `null` when they left something else. */
function passBeforeUnknown(history: readonly Transition[], end: number): Observation | null {
  for (let i = end - 1; i >= 0 && history[i]?.to === "unknown"; i--) {
    const from = history[i]?.from;
    if (from === "pass") return { outcome: "pass", fingerprint: null };
    if (from !== "unknown") return null;
  }
  return null;
}

/** Regressions first, then changed failures, baseline findings, unknowns, recoveries, retired failures. */
const RANK: Record<DeltaKind, number> = {
  "pass-to-fail": 0,
  "first-seen-fail": 0,
  "fail-changed": 1,
  "to-unknown": 3,
  "fail-to-pass": 4,
  "fail-retired": 5,
};

const rank = (e: DeltaEntry) => (isBaselineEntry(e) ? 2 : RANK[e.kind]);

/** A `first-seen-fail` first observed by the worktree's baseline checkpoint. */
export function isBaselineEntry(e: DeltaEntry): boolean {
  return e.kind !== "fail-retired" && e.baseline === true;
}

/** The part of a plan about the entries `keep` accepts: their view writes and removals, nothing else. */
export function restrictPlan(plan: DeltaPlan, keep: (entry: DeltaEntry) => boolean): DeltaPlan {
  const entries = plan.entries.filter(keep);
  const ids = new Set(entries.map((e) => checkIdentity(e.check)));
  return {
    entries,
    writes: plan.writes.filter((w) => ids.has(checkIdentity(w.check))),
    removals: plan.removals.filter((c) => ids.has(checkIdentity(c))),
  };
}

export function toView(state: KnownState, toldAt: EpochMs): ViewEntry {
  return { check: state.check, outcome: state.outcome, fingerprint: state.fingerprint, toldAt };
}

/**
 * Spec 001 D6: "At delivery time the daemon or hook computes the delta
 * between the view and the current known states, keeps only notable
 * differences (the transition kinds above, evaluated between what was told
 * and what is known now), writes the result into the view, and returns the
 * delta. A pass never told to anyone is written into the view silently."
 *
 * A difference that is not notable leaves the view as it was: what the view
 * holds is what the consumer was told. So a check that broke and recovered
 * between two deliveries, or a failure that was skipped and came back
 * unchanged, produces nothing.
 *
 * A view entry with no known state is a retired check. D6: one told as
 * `fail` "is delivered once to that consumer as resolved"; every other one
 * leaves the view silently.
 */
export function planDelta(input: PlanInput): DeltaPlan {
  const told = new Map(input.view.map((v) => [checkIdentity(v.check), v]));
  const entries: DeltaEntry[] = [];
  const writes: ViewEntry[] = [];
  for (const state of input.states) {
    const id = checkIdentity(state.check);
    const before = told.get(id) ?? null;
    told.delete(id);
    // A failure told after an unknown reads as a regression when a pass preceded the unknown.
    const prior =
      (before === null || before.outcome === "unknown") &&
      state.outcome === "fail" &&
      input.history !== undefined
        ? beforeFailing(input.history(state.check), state)
        : null;
    const from = before === null || prior?.outcome === "pass" ? prior : before;
    const kind = transitionKind(from, state);
    if (before === null || kind !== null) writes.push(toView(state, input.toldAt));
    if (kind === null) continue;
    const baseline =
      kind === "first-seen-fail" && input.isBaselineFinding(state.check, state.fingerprint);
    const originRoot =
      state.origin?.kind === "inherited" ? input.rootOf(state.origin.worktreeId) : null;
    entries.push({
      check: state.check,
      kind,
      from: from?.outcome ?? null,
      to: state.outcome,
      validity: state.validity,
      observedAt: state.observedAt ?? input.revision,
      origin: state.origin ?? { kind: "own" },
      ...(originRoot === null ? {} : { originRoot }),
      summary: state.summary,
      location: state.location,
      ...(baseline ? { baseline } : {}),
    });
  }
  for (const view of told.values()) {
    if (view.outcome !== "fail") continue;
    entries.push({
      check: view.check,
      kind: "fail-retired",
      from: "fail",
      to: null,
      fingerprint: view.fingerprint,
      observedAt: input.revision,
    });
  }
  const sorted = entries
    .map((entry, i) => ({ entry, i }))
    .sort((a, b) => rank(a.entry) - rank(b.entry) || a.i - b.i)
    .map(({ entry }) => entry);
  return { entries: sorted, writes, removals: [...told.values()].map((v) => v.check) };
}
