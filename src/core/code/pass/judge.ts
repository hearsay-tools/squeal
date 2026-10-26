import type {
  CodeCheckId,
  CodeKnownState,
  CodeOutcome,
  CodeTransition,
  FileCount,
} from "../../types/code.js";
import type { EpochMs, RelativePath, RevisionNumber } from "../../types/index.js";
import { type Counted, countedChecks, outcomeAt } from "./counted.js";

/** One file of the work set after the revision: its count, or `null` when it is gone, too big or no longer included. */
export interface FileAfter {
  readonly path: RelativePath;
  readonly count: Pick<FileCount, "blob" | "functions" | "errors"> | null;
  /**
   * The count a first count or recount failed on, made since at the same
   * blob: judged as that pass would have, with no move, transition or edit
   * (review 0.1.293 B1).
   */
  readonly quiet?: boolean;
  /**
   * The threshold of the edit whose count failed at this path before this
   * count, from its record: a crossing it does not make too is a later
   * policy change's, told by the recount's summary (D1, row 015-31).
   */
  readonly editedUnder?: number;
}

export interface JudgeInput {
  readonly worktreeId: string;
  readonly revision: RevisionNumber;
  readonly threshold: number;
  readonly at: EpochMs;
  /** A first count or a policy change: no move, no transition, nothing edited (D5, D6's summary). */
  readonly quiet: boolean;
  /** The complexity states of every path in `after`. */
  readonly before: readonly CodeKnownState[];
  /** The body hash of each check in `before`, by `checkKey`, from the count it was judged at. */
  readonly bodies: ReadonlyMap<string, string>;
  readonly after: readonly FileAfter[];
}

/** What the store gets, in this order: moves, removals, states, transitions. */
export interface Judged {
  readonly moves: readonly { readonly from: CodeCheckId; readonly to: CodeCheckId }[];
  readonly removed: readonly CodeCheckId[];
  readonly states: readonly CodeKnownState[];
  readonly transitions: readonly CodeTransition[];
  /** Same identity, another body hash (015-08). */
  readonly edited: readonly CodeCheckId[];
}

/** A check's identity as one string (spec 015 D2). */
export function checkKey(
  check: Pick<CodeCheckId, "path" | "qualifiedName" | "occurrence">,
): string {
  return `${check.path}\0${check.qualifiedName}\0${check.occurrence}`;
}

export type { Counted };

/** A work set's counted checks beside its stored ones (D2): what a move pairs and what goes. */
export interface Sides {
  readonly before: ReadonlyMap<string, CodeKnownState>;
  readonly counted: readonly Counted[];
  /** Counted checks no state holds, not quiet: the moves' targets. */
  readonly added: readonly Counted[];
  /** Stored checks no count holds now. */
  readonly gone: ReadonlyMap<string, CodeKnownState>;
}

/**
 * Spec 015 D2 and D5: the states and transitions a work set's counts give.
 * A check keeps its identity `(path, qualified name, occurrence)`; a removed
 * check and an added one with the same body hash are a move, which keeps the
 * state and records nothing. A new function over the threshold is a
 * first-seen fail, a removed failing one is `removed`. A parse error's
 * `unknown` records no transition in or out of it (D3: it delivers nothing).
 * Row 015-55: each step but the moves reads one file at a time, so an edit
 * pass over many files judges them in parts around one `matchMoves`.
 */
export function judge(input: JudgeInput): Judged {
  const sides = sidesOf(input);
  const quiet = quietOf(input);
  const moves = matchMoves(sides.added, movable(sides.gone, quiet), input.bodies);
  const prior = priorOf(moves, sides.gone);
  const counted = judgeCounted(input, sides, (key) => prior.get(key) ?? sides.before.get(key));
  const gone = judgeGone(input, quiet, sides.gone, moves);
  return {
    moves,
    removed: gone.removed,
    states: counted.states,
    transitions: [...counted.transitions, ...gone.transitions],
    edited: counted.edited,
  };
}

/** Whether a check is judged with no move, transition or edit: a quiet pass's, or a seed path's. */
export function quietOf(input: {
  readonly quiet: boolean;
  readonly after: readonly Pick<FileAfter, "path" | "quiet">[];
}): (check: CodeCheckId) => boolean {
  const seeds = new Set(input.after.flatMap((a) => (a.quiet === true ? [a.path] : [])));
  return (check) => input.quiet || seeds.has(check.path);
}

/** The counted and stored checks of `input`'s files. */
export function sidesOf(input: JudgeInput): Sides {
  const quiet = quietOf(input);
  const before = new Map(input.before.map((s) => [checkKey(s.check), s]));
  const counted = countedChecks(input);
  const now = new Set(counted.map((c) => checkKey(c.check)));
  const added = counted.filter((c) => !before.has(checkKey(c.check)) && !quiet(c.check));
  const gone = new Map([...before].filter(([key]) => !now.has(key)));
  return { before, counted, added, gone };
}

/** The gone checks a move may take: not quiet. */
export function movable(
  gone: ReadonlyMap<string, CodeKnownState>,
  quiet: (check: CodeCheckId) => boolean,
): Map<string, CodeKnownState> {
  return new Map([...gone].filter(([, s]) => !quiet(s.check)));
}

/** Each move's target and the state it takes over. */
export function priorOf(
  moves: readonly { readonly from: CodeCheckId; readonly to: CodeCheckId }[],
  gone: ReadonlyMap<string, CodeKnownState>,
): Map<string, CodeKnownState> {
  const prior = new Map<string, CodeKnownState>();
  for (const { from, to } of moves) {
    const state = gone.get(checkKey(from));
    if (state !== undefined) prior.set(checkKey(to), state);
  }
  return prior;
}

/** The states, transitions and edits of `sides`' counted checks, each after its `prior` state. */
export function judgeCounted(
  input: JudgeInput,
  sides: Pick<Sides, "before" | "counted">,
  prior: (key: string) => CodeKnownState | undefined,
): Pick<Judged, "states" | "transitions" | "edited"> {
  const quiet = quietOf(input);
  const editedUnder = new Map(
    input.after.flatMap((a) => (a.editedUnder === undefined ? [] : [[a.path, a.editedUnder]])),
  );
  const states: CodeKnownState[] = [];
  const transitions: CodeTransition[] = [];
  const edited: CodeCheckId[] = [];
  for (const c of sides.counted) {
    const key = checkKey(c.check);
    const was = prior(key);
    states.push({
      worktreeId: input.worktreeId,
      check: c.check,
      measure: "complexity",
      outcome: c.outcome,
      value: c.fn.complexity,
      threshold: input.threshold,
      countedAt: input.revision,
      blob: c.blob,
      changedAt: was !== undefined && was.outcome === c.outcome ? was.changedAt : input.revision,
    });
    if (quiet(c.check)) continue;
    const kind = transitionKind(was?.outcome ?? null, c.outcome);
    if (kind !== null && !byPolicy(c, was, editedUnder.get(c.check.path))) {
      transitions.push(transition(input, c.check, kind, was ?? null, c));
    }
    const body = input.bodies.get(key);
    if (sides.before.has(key) && body !== undefined && body !== c.fn.bodyHash) {
      edited.push(c.check);
    }
  }
  return { states, transitions, edited };
}

/** The gone checks no move took, and the `removed` transition of each failing one not quiet. */
export function judgeGone(
  input: Pick<JudgeInput, "worktreeId" | "revision" | "threshold" | "at">,
  quiet: (check: CodeCheckId) => boolean,
  gone: ReadonlyMap<string, CodeKnownState>,
  moves: readonly { readonly from: CodeCheckId }[],
): Pick<Judged, "removed" | "transitions"> {
  const moved = new Set(moves.map((m) => checkKey(m.from)));
  const removed: CodeCheckId[] = [];
  const transitions: CodeTransition[] = [];
  for (const [key, state] of gone) {
    if (moved.has(key)) continue;
    removed.push(state.check);
    if (!quiet(state.check) && state.outcome === "fail") {
      transitions.push(transition(input, state.check, "removed", state, null));
    }
  }
  return { removed, transitions };
}

/**
 * Row 015-31: whether the threshold the check's state was judged at, or
 * its failed edit was made under, gives the count another outcome than
 * now. Then a later policy change, not the edit, made the crossing (D1).
 */
function byPolicy(
  c: Counted,
  was: CodeKnownState | undefined,
  editedUnder: number | undefined,
): boolean {
  return [was?.threshold, editedUnder].some(
    (t) => typeof t === "number" && outcomeAt(c.fn.complexity, t) !== c.outcome,
  );
}

/**
 * Pairs each added check with a gone check of the same body hash (D2), in
 * source order, a gone check of the same file first. A body hash the old
 * count did not keep pairs nothing.
 */
export function matchMoves(
  added: readonly Counted[],
  gone: ReadonlyMap<string, CodeKnownState>,
  bodies: ReadonlyMap<string, string>,
): { from: CodeCheckId; to: CodeCheckId }[] {
  const byBody = new Map<string, CodeCheckId[]>();
  for (const [key, state] of gone) {
    const body = bodies.get(key);
    if (body === undefined) continue;
    byBody.set(body, [...(byBody.get(body) ?? []), state.check]);
  }
  const moves: { from: CodeCheckId; to: CodeCheckId }[] = [];
  for (const a of added) {
    const candidates = byBody.get(a.fn.bodyHash);
    if (candidates === undefined || candidates.length === 0) continue;
    const same = candidates.findIndex((c) => c.path === a.check.path);
    const [from] = candidates.splice(same === -1 ? 0 : same, 1);
    if (from !== undefined) moves.push({ from, to: a.check });
  }
  return moves;
}

function transitionKind(from: CodeOutcome | null, to: CodeOutcome): CodeTransition["kind"] | null {
  if (from === null) return to === "fail" ? "first-seen-fail" : null;
  if (from === "pass" && to === "fail") return "pass-to-fail";
  if (from === "fail" && to === "pass") return "fail-to-pass";
  return null;
}

function transition(
  input: Pick<JudgeInput, "worktreeId" | "revision" | "threshold" | "at">,
  check: CodeCheckId,
  kind: CodeTransition["kind"],
  was: CodeKnownState | null,
  counted: Counted | null,
): CodeTransition {
  return {
    worktreeId: input.worktreeId,
    check,
    measure: "complexity",
    kind,
    from: was?.outcome ?? null,
    to: counted?.outcome ?? null,
    fromValue: was?.value ?? null,
    toValue: counted?.fn.complexity ?? null,
    threshold: counted === null ? (was?.threshold ?? null) : input.threshold,
    revision: input.revision,
    at: input.at,
  };
}
