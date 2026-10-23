import type {
  CodeCheckId,
  CodeKnownState,
  CodeMeasure,
  CodeTransition,
  CodeTransitionKind,
  CodeViewEntry,
} from "../types/code.js";
import type { CodeDeltaEntry } from "../types/code-delivery.js";
import type { EpochMs } from "../types/index.js";

/*
 * Spec 015 D5, D6: the consumer's code view against the current states,
 * after 011 C5's view diff. A view holds what the consumer was told: a
 * check's `pass` or `fail` at a threshold, never its value, so a count that
 * changes while the function stays over is no news. A difference is told
 * only when the check's last transition explains it and came after what the
 * view holds; any other (a recount, a first count, a parse error healed) is
 * written silently, told by count.
 */

/** A view row's key: one measure of one check. */
export type CodeViewKey = Pick<CodeViewEntry, "check" | "measure">;

export interface CodePlanInput {
  readonly view: readonly CodeViewEntry[];
  readonly states: readonly CodeKnownState[];
  /** The check's measure's last recorded transition; `null` when it has none. */
  readonly last: (check: CodeCheckId, measure: CodeMeasure) => CodeTransition | null;
  /** When the view was last seeded whole: a transition before it was told by count. */
  readonly seededAt: EpochMs;
  readonly toldAt: EpochMs;
}

export interface CodePlan {
  /** Every change to tell, failures first, then recoveries, then removed functions. */
  readonly entries: readonly Omit<CodeDeltaEntry, "line">[];
  readonly writes: readonly CodeViewEntry[];
  readonly removals: readonly CodeViewKey[];
}

/** The view key as text. */
export function codeKey({ check, measure }: CodeViewKey): string {
  return JSON.stringify([check.path, check.qualifiedName, check.occurrence, measure]);
}

/** A view entry of `state`, told by count: a seed, a silent write. */
export function seedEntry(state: CodeKnownState, toldAt: EpochMs): CodeViewEntry {
  return {
    check: state.check,
    measure: state.measure,
    outcome: state.outcome,
    threshold: state.threshold,
    told: "count",
    toldAt,
  };
}

/** Only `pass` and `fail` are told; `pending` and `unknown` leave the view as it is (D3). */
const judged = (state: CodeKnownState) => state.outcome === "pass" || state.outcome === "fail";

const RANK: Record<CodeTransitionKind, number> = {
  "pass-to-fail": 0,
  "first-seen-fail": 0,
  "fail-to-pass": 1,
  removed: 2,
};

/**
 * The transition kind that takes `told` (the view's outcome, `null` when it
 * has none) to `now` (`null` when the check is gone), when the last
 * transition explains it; `null` when nothing is to tell.
 */
function toldKind(
  told: CodeViewEntry | null,
  now: CodeKnownState | null,
  last: CodeTransition | null,
  after: EpochMs,
): CodeTransitionKind | null {
  if (last === null || last.at <= after) return null;
  if (now === null) return told?.outcome === "fail" && last.kind === "removed" ? "removed" : null;
  if (now.outcome === "fail" && told?.outcome !== "fail") {
    return last.kind === "first-seen-fail" || last.kind === "pass-to-fail" ? last.kind : null;
  }
  if (now.outcome === "pass" && told?.outcome === "fail") {
    return last.kind === "fail-to-pass" ? last.kind : null;
  }
  return null;
}

/** Spec 015 D5, D6: what to tell the consumer of its code view, and how the view changes. */
export function planCodeDelta(input: CodePlanInput): CodePlan {
  const told = new Map(input.view.map((v) => [codeKey(v), v]));
  const entries: Omit<CodeDeltaEntry, "line">[] = [];
  const writes: CodeViewEntry[] = [];
  for (const state of input.states) {
    const key = codeKey(state);
    const before = told.get(key) ?? null;
    told.delete(key);
    if (!judged(state)) continue;
    if (before?.outcome === state.outcome && before.threshold === state.threshold) continue;
    const last = input.last(state.check, state.measure);
    const kind = toldKind(before, state, last, Math.max(input.seededAt, before?.toldAt ?? 0));
    if (kind === null) {
      writes.push(seedEntry(state, input.toldAt));
      continue;
    }
    writes.push({ ...seedEntry(state, input.toldAt), told: "full" });
    entries.push({
      check: state.check,
      measure: state.measure,
      kind,
      value: state.value,
      threshold: state.threshold,
      revision: last?.revision ?? state.changedAt,
    });
  }
  const removals: CodeViewKey[] = [];
  for (const view of told.values()) {
    removals.push({ check: view.check, measure: view.measure });
    const last = view.outcome === "fail" ? input.last(view.check, view.measure) : null;
    if (last === null || toldKind(view, null, last, view.toldAt) === null) continue;
    entries.push({
      check: view.check,
      measure: view.measure,
      kind: "removed",
      value: last.fromValue,
      threshold: view.threshold,
      revision: last.revision,
    });
  }
  const sorted = entries
    .map((entry, i) => ({ entry, i }))
    .sort((a, b) => RANK[a.entry.kind] - RANK[b.entry.kind] || a.i - b.i)
    .map(({ entry }) => entry);
  return { entries: sorted, writes, removals };
}
