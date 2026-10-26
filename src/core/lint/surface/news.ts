import { type CodeBound, isOwn } from "../../delivery/code-delta.js";
import type { EpochMs, RelativePath } from "../../types/index.js";
import type {
  LintCheckId,
  LintFinding,
  LintKnownState,
  LintTransitionKind,
  LintViewEntry,
} from "../../types/lint.js";
import type { LintNewsEntry } from "../../types/lint-delivery.js";
import { lintCheck } from "../pass/judge.js";
import type { LintTransitionRecord } from "../store/types.js";
import type { LintToldMark } from "./told.js";

/*
 * Spec 017 D2, D8: a consumer's lint view against the states now, after
 * 015's `code-delta.ts`. The view holds what the consumer was told of each
 * file: `fail` with a fingerprint, or nothing, which reads `pass`. A file
 * whose state now differs is told only when its last transition is the
 * consumer's own and came after the mark; then the evidence is what its
 * own transitions since added and removed, never a config change's. Any
 * other difference is taken in by count. A file `pending`, `unknown` or a
 * stale `pass` is told nothing and stays deferred, so its news waits for a
 * judged result and is never lost to the mark moving on.
 */

export interface LintPlanInput {
  readonly view: ReadonlyMap<RelativePath, LintViewEntry>;
  /** The states of the candidates (`candidatesOf`); a file with none is gone or not linted. */
  readonly states: ReadonlyMap<RelativePath, LintKnownState>;
  /** The worktree's transitions after `fromId(mark)`, oldest first. */
  readonly transitions: readonly LintTransitionRecord[];
  readonly mark: LintToldMark;
  /** The revisions whose changes are the consumer's (`codeSeenUpTo`); `null`, every one. */
  readonly seenUpTo: CodeBound | null;
  /** The findings a state was judged with; `null` when that result is not stored. */
  readonly findings: (state: LintKnownState) => readonly LintFinding[] | null;
  readonly at: EpochMs;
}

export interface LintPlan {
  /** Every change to tell, failures first, then passes, then removed files. */
  readonly entries: readonly LintNewsEntry[];
  /** View entries to write, `full` for each told change. */
  readonly writes: readonly LintViewEntry[];
  readonly removals: readonly LintCheckId[];
  readonly deferred: readonly (readonly [RelativePath, number])[];
}

/** The lowest transition id any of the mark's files counts after. */
export function fromId(mark: LintToldMark): number {
  return Math.min(mark.transition, ...mark.deferred.map(([, id]) => id));
}

/** The files a delivery looks at: those with a transition after their mark, and the deferred ones. */
export function candidatesOf(
  mark: LintToldMark,
  transitions: readonly LintTransitionRecord[],
): RelativePath[] {
  const bases = new Map(mark.deferred);
  const paths = new Set(bases.keys());
  for (const t of transitions) {
    if (t.id > (bases.get(t.check.path) ?? mark.transition)) paths.add(t.check.path);
  }
  return [...paths].sort();
}

/** Whether a state is judged at its bytes, so news of it may be told (D8: never an unknown or stale PASS). */
const settled = (s: LintKnownState) =>
  s.judged !== null && (s.outcome === "fail" || (s.outcome === "pass" && !s.stale));

/**
 * D2: what `transitions` added and removed together, by rule and message:
 * a finding added and later removed is neither. Evidence only.
 */
export function netChange(transitions: readonly LintTransitionRecord[]): {
  readonly added: LintFinding[];
  readonly removed: LintFinding[];
} {
  const net = new Map<string, { n: number; added: LintFinding[]; removed: LintFinding[] }>();
  const entry = (f: LintFinding) => {
    const key = JSON.stringify([f.rule, f.message]);
    const found = net.get(key);
    if (found !== undefined) return found;
    const e = { n: 0, added: [] as LintFinding[], removed: [] as LintFinding[] };
    net.set(key, e);
    return e;
  };
  for (const t of transitions) {
    for (const f of t.added) {
      const e = entry(f);
      e.n++;
      e.added.push(f);
    }
    for (const f of t.removed) {
      const e = entry(f);
      e.n--;
      e.removed.push(f);
    }
  }
  const added: LintFinding[] = [];
  const removed: LintFinding[] = [];
  for (const e of net.values()) {
    if (e.n > 0) added.push(...e.added.slice(-e.n));
    if (e.n < 0) removed.push(...e.removed.slice(0, -e.n));
  }
  return { added, removed };
}

/** The kind from what the view holds (`toldFail`) to `now` (`null`: gone). */
function kindOf(
  toldFail: boolean,
  now: LintKnownState | null,
  own: readonly LintTransitionRecord[],
): LintTransitionKind {
  if (now === null) return "removed";
  if (now.outcome === "pass") return "fail-to-pass";
  if (toldFail) return "fail-changed";
  return own[0]?.kind === "first-seen-fail" ? "first-seen-fail" : "pass-to-fail";
}

const RANK: Record<LintTransitionKind, number> = {
  "first-seen-fail": 0,
  "pass-to-fail": 0,
  "fail-changed": 0,
  "fail-to-pass": 1,
  removed: 2,
};

/** What one candidate file changes: the view entry it writes or removes, what it tells, or that it waits. */
interface FileStep {
  readonly write?: LintViewEntry;
  readonly removal?: LintCheckId;
  readonly entry?: LintNewsEntry;
  /** The id its transitions count after, while it waits for a judged result. */
  readonly deferred?: number;
}

/** Whether the view's `told` entry says what `now` says: both pass, or both fail alike. */
function toldAlike(told: LintViewEntry | null, now: LintKnownState | null): boolean {
  const nowFail = now?.outcome === "fail";
  if ((told?.outcome === "fail") !== nowFail) return false;
  return !nowFail || told?.fingerprint === (now?.judged?.fingerprint ?? null);
}

/** The view's next entry for `now`: a `fail` written, or a `pass` that leaves the view. */
function viewStep(
  path: RelativePath,
  now: LintKnownState | null,
  told: LintViewEntry | null,
  tell: boolean,
  at: EpochMs,
): FileStep {
  if (now?.outcome !== "fail") return told === null ? {} : { removal: lintCheck(path) };
  const fingerprint = now.judged?.fingerprint ?? null;
  const toldAs = tell ? "full" : "count";
  return {
    write: { check: lintCheck(path), outcome: "fail", fingerprint, told: toldAs, toldAt: at },
  };
}

function fileStep(input: LintPlanInput, path: RelativePath, base: number): FileStep {
  const now = input.states.get(path) ?? null;
  if (now !== null && !settled(now)) return { deferred: base };
  const told = input.view.get(path) ?? null;
  if (toldAlike(told, now)) return {};
  const ts = input.transitions.filter((t) => t.check.path === path && t.id > base);
  const last = ts.at(-1);
  const own = ts.filter((t) => isOwn(input.seenUpTo, t.revision));
  const change = netChange(own);
  const tell =
    last !== undefined &&
    isOwn(input.seenUpTo, last.revision) &&
    change.added.length + change.removed.length > 0;
  const view = viewStep(path, now, told, tell, input.at);
  if (!tell || last === undefined) return view;
  const failing = now?.outcome === "fail" ? now : null;
  const entry: LintNewsEntry = {
    path,
    kind: kindOf(told?.outcome === "fail", now, own),
    findings: failing === null ? 0 : (input.findings(failing)?.length ?? null),
    ...change,
    revision: last.revision,
    ...(now?.stale === true ? { stale: true as const } : {}),
  };
  return { ...view, entry };
}

/** Spec 017 D8: what to tell the consumer of its lint view, and how the view changes. */
export function planLintNews(input: LintPlanInput): LintPlan {
  const bases = new Map(input.mark.deferred);
  const entries: LintNewsEntry[] = [];
  const writes: LintViewEntry[] = [];
  const removals: LintCheckId[] = [];
  const deferred: [RelativePath, number][] = [];
  for (const path of candidatesOf(input.mark, input.transitions)) {
    const step = fileStep(input, path, bases.get(path) ?? input.mark.transition);
    if (step.deferred !== undefined) deferred.push([path, step.deferred]);
    if (step.write !== undefined) writes.push(step.write);
    if (step.removal !== undefined) removals.push(step.removal);
    if (step.entry !== undefined) entries.push(step.entry);
  }
  const sorted = entries
    .map((entry, i) => ({ entry, i }))
    .sort((a, b) => RANK[a.entry.kind] - RANK[b.entry.kind] || a.i - b.i)
    .map(({ entry }) => entry);
  return { entries: sorted, writes, removals, deferred };
}
