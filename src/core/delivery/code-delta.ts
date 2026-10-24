import type { CodeEdit } from "../code/store/types.js";
import type {
  CodeCheckId,
  CodeKnownState,
  CodeMeasure,
  CodeTransition,
  CodeTransitionKind,
  CodeViewEntry,
} from "../types/code.js";
import type { CodeDeltaEntry, CodeDeltaKind } from "../types/code-delivery.js";
import type { EpochMs, RevisionNumber } from "../types/index.js";

/*
 * Spec 015 D5, D6: the consumer's code view against the current states,
 * after 011 C5's view diff. A view holds what the consumer was told: a
 * check's `fail` at a threshold, never its value, so a count that changes
 * while the function stays over is no news. A check with no entry reads
 * `pass`, so a view holds the failing functions only and a passing one
 * leaves it (lessons round 1, P5). A difference is told
 * only when the check's last transition explains it and came after what the
 * view holds; any other (a recount, a first count, a parse error healed) is
 * written silently, told by count. One more is told with no change of
 * state: the first edit to a function the view holds failing by count only,
 * or told failing in full (015-21); after it, edits are quiet.
 */

/** A view row's key: one measure of one check. */
export type CodeViewKey = Pick<CodeViewEntry, "check" | "measure">;

export interface CodePlanInput {
  readonly view: readonly CodeViewEntry[];
  readonly states: readonly CodeKnownState[];
  /** The check's measure's last recorded transition; `null` when it has none. */
  readonly last: (check: CodeCheckId, measure: CodeMeasure) => CodeTransition | null;
  /** The check's measure's last edit with its identity kept; `null` when none is stored. */
  readonly edit: (check: CodeCheckId, measure: CodeMeasure) => CodeEdit | null;
  /** When the view was last seeded whole: a transition before it was told by count. */
  readonly seededAt: EpochMs;
  /**
   * The revision the consumer's changes count after (`codeSeenUpTo`): a
   * transition or edit at or before it was in the tree at registration, so
   * it is taken in by count (lessons round 1, P2). `null`: none recorded.
   */
  readonly seenUpTo: RevisionNumber | null;
  readonly toldAt: EpochMs;
}

/** A told change before its line is looked up. */
export type PlanEntry = Omit<CodeDeltaEntry, "line">;

export interface CodePlan {
  /** Every change to tell: failures, recoveries, removed functions, then edits to standing failures. */
  readonly entries: readonly PlanEntry[];
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

const RANK: Record<CodeDeltaKind, number> = {
  "pass-to-fail": 0,
  "first-seen-fail": 0,
  "fail-to-pass": 1,
  removed: 2,
  edited: 3,
  "edited-after-fail": 3,
};

/** A `STILL FAIL`: an edit that left a failing function over, not a change of state. */
export const isStillFail = (kind: CodeDeltaKind) =>
  kind === "edited" || kind === "edited-after-fail";

/**
 * The transition kind that takes `told` (the view's outcome, `null` when it
 * has none) to `now` (`null` when the check is gone), when the last
 * transition explains it; `null` when nothing is to tell.
 */
function toldKind(
  told: CodeViewEntry | null,
  now: CodeKnownState | null,
  last: CodeTransition | null,
  { after, seenUpTo }: { after: EpochMs; seenUpTo: RevisionNumber | null },
): CodeTransitionKind | null {
  if (last === null || last.at <= after || last.revision <= (seenUpTo ?? -1)) return null;
  if (now === null) return told?.outcome === "fail" && last.kind === "removed" ? "removed" : null;
  if (now.outcome === "fail" && told?.outcome !== "fail") {
    return last.kind === "first-seen-fail" || last.kind === "pass-to-fail" ? last.kind : null;
  }
  if (now.outcome === "pass" && told?.outcome === "fail") {
    return last.kind === "fail-to-pass" ? last.kind : null;
  }
  return null;
}

/**
 * D6, its last rule, and 015-21: the edit to tell of a function failing
 * before and after it, when the view holds it told by count or told its
 * FAIL in full, and the edit came after what the view holds; `null`
 * otherwise. Told once: the view entry is then written `still`, so later
 * edits are quiet until the state changes.
 */
function editToTell(
  told: CodeViewEntry,
  now: CodeKnownState,
  input: CodePlanInput,
): CodeEdit | null {
  if (now.outcome !== "fail" || told.told === "still") return null;
  const edit = input.edit(now.check, now.measure);
  if (edit === null || edit.revision <= (input.seenUpTo ?? -1)) return null;
  return edit.at > Math.max(input.seededAt, told.toldAt) ? edit : null;
}

function entryOf(state: CodeKnownState, kind: CodeDeltaKind, revision: RevisionNumber): PlanEntry {
  const { check, measure, value, threshold } = state;
  return { check, measure, kind, value, threshold, revision };
}

/** What one judged state changes: the view entry it writes or removes, and what it tells. */
interface StateStep {
  readonly write?: CodeViewEntry;
  readonly removal?: CodeViewKey;
  readonly entry?: PlanEntry;
}

function stateStep(
  state: CodeKnownState,
  before: CodeViewEntry | null,
  input: CodePlanInput,
): StateStep {
  if (state.outcome === "pass" && before === null) return {};
  if (before?.outcome === state.outcome && before.threshold === state.threshold) {
    const edit = editToTell(before, state, input);
    if (edit === null) return {};
    return {
      write: { ...seedEntry(state, Math.max(input.toldAt, edit.at)), told: "still" },
      entry: entryOf(
        state,
        before.told === "count" ? "edited" : "edited-after-fail",
        edit.revision,
      ),
    };
  }
  const last = input.last(state.check, state.measure);
  const after = Math.max(input.seededAt, before?.toldAt ?? 0);
  const kind = toldKind(before, state, last, { after, seenUpTo: input.seenUpTo });
  // The entry holds every change this delivery read, though the pass may have
  // written one after the hook read its clock: that edit is told by the FAIL.
  const asOf = Math.max(
    input.toldAt,
    last?.at ?? 0,
    input.edit(state.check, state.measure)?.at ?? 0,
  );
  // Told or not, a passing function leaves the view.
  const view: StateStep =
    state.outcome === "pass"
      ? { removal: { check: state.check, measure: state.measure } }
      : { write: { ...seedEntry(state, asOf), told: kind === null ? "count" : "full" } };
  if (kind === null) return view;
  return { ...view, entry: entryOf(state, kind, last?.revision ?? state.changedAt) };
}

/** Spec 015 D5, D6: what to tell the consumer of its code view, and how the view changes. */
export function planCodeDelta(input: CodePlanInput): CodePlan {
  const told = new Map(input.view.map((v) => [codeKey(v), v]));
  const entries: PlanEntry[] = [];
  const writes: CodeViewEntry[] = [];
  const removals: CodeViewKey[] = [];
  for (const state of input.states) {
    const key = codeKey(state);
    const before = told.get(key) ?? null;
    told.delete(key);
    if (!judged(state)) continue;
    const { write, removal, entry } = stateStep(state, before, input);
    if (write !== undefined) writes.push(write);
    if (removal !== undefined) removals.push(removal);
    if (entry !== undefined) entries.push(entry);
  }
  for (const view of told.values()) {
    removals.push({ check: view.check, measure: view.measure });
    const last = view.outcome === "fail" ? input.last(view.check, view.measure) : null;
    const seen = { after: view.toldAt, seenUpTo: input.seenUpTo };
    if (last === null || toldKind(view, null, last, seen) === null) continue;
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
