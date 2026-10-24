import type { CodeStore } from "../../../src/core/code/store/index.js";
import { lastTransition } from "../../../src/core/delivery/code-deliver.js";
import { type CodeBound, codeKey, planCodeDelta } from "../../../src/core/delivery/code-delta.js";
import { wentOverSince } from "../../../src/core/delivery/code-since.js";
import type { FakeWorktree } from "./helpers.js";

/** The session registered at revision 1, its view seeded at 1,500 with no failing function. */
export const SESSION: CodeBound = { since: 1, gaps: [] };

/**
 * What a delivery to `SESSION` tells, with the edits the store marked, and
 * the functions its Stop check counts as gone over (review 0.1.293 B1, row
 * 015-31).
 */
export function told(store: CodeStore, tree: FakeWorktree) {
  const edits = new Map(store.states.edits(tree.id, "complexity").map((e) => [codeKey(e), e]));
  const plan = planCodeDelta({
    view: [],
    states: store.states.list(tree.id, { measure: "complexity" }),
    last: (check, measure) => lastTransition(store, tree.id, check, measure),
    edit: (check, measure) => edits.get(codeKey({ check, measure })) ?? null,
    seededAt: 1_500,
    seenUpTo: SESSION,
    toldAt: 100_000,
  });
  return {
    entries: plan.entries.map((e) => `${e.kind} ${e.check.qualifiedName} ${e.revision}`),
    wentOver: wentOverSince(store, tree.id, SESSION).map((s) => s.check.qualifiedName),
    writes: plan.writes.map((w) => `${w.check.qualifiedName} ${w.outcome} ${w.told}`),
  };
}
