import { checkIdentity, transitionKind } from "../state/index.js";
import type {
  AbsolutePath,
  CheckId,
  DeltaEntry,
  DeltaKind,
  DiagnosticFingerprint,
  EpochMs,
  KnownState,
  RevisionNumber,
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

/** The part of a plan about entries of `kinds`: their view writes and removals, nothing else. */
export function restrictPlan(plan: DeltaPlan, kinds: ReadonlySet<DeltaKind>): DeltaPlan {
  const entries = plan.entries.filter((e) => kinds.has(e.kind));
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
    const kind = transitionKind(before, state);
    if (before === null || kind !== null) writes.push(toView(state, input.toldAt));
    if (kind === null) continue;
    const baseline =
      kind === "first-seen-fail" && input.isBaselineFinding(state.check, state.fingerprint);
    const originRoot =
      state.origin?.kind === "inherited" ? input.rootOf(state.origin.worktreeId) : null;
    entries.push({
      check: state.check,
      kind,
      from: before?.outcome ?? null,
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
