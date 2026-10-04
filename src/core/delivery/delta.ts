import { checkIdentity, transitionKind } from "../state/index.js";
import type {
  CheckId,
  DeltaEntry,
  DiagnosticFingerprint,
  EpochMs,
  KnownState,
  RevisionNumber,
  TransitionKind,
  ViewEntry,
} from "../types/index.js";

/** What one delivery tells a consumer and how its view changes. */
export interface DeltaPlan {
  /** Notable differences, failures first. */
  readonly entries: readonly DeltaEntry[];
  /** View entries to write: every delivered entry plus first observations written silently. */
  readonly writes: readonly ViewEntry[];
  /** Checks in the view that have no known state any more (retired). */
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
  /** Used as `observedAt` of a state never observed (an `unknown` without a revision). */
  readonly revision: RevisionNumber;
}

/** Regressions first, then changed failures, baseline findings, unknowns, recoveries. */
const RANK: Record<TransitionKind, number> = {
  "pass-to-fail": 0,
  "first-seen-fail": 0,
  "fail-changed": 1,
  "to-unknown": 3,
  "fail-to-pass": 4,
};

const rank = (e: DeltaEntry) => (e.baseline === true ? 2 : RANK[e.kind]);

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
    entries.push({
      check: state.check,
      kind,
      from: before?.outcome ?? null,
      to: state.outcome,
      validity: state.validity,
      observedAt: state.observedAt ?? input.revision,
      origin: state.origin ?? { kind: "own" },
      summary: state.summary,
      location: state.location,
      ...(baseline ? { baseline } : {}),
    });
  }
  const sorted = entries
    .map((entry, i) => ({ entry, i }))
    .sort((a, b) => rank(a.entry) - rank(b.entry) || a.i - b.i)
    .map(({ entry }) => entry);
  return { entries: sorted, writes, removals: [...told.values()].map((v) => v.check) };
}
