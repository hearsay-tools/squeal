import type {
  CodeCheckId,
  CodeKnownState,
  CodeOutcome,
  CodeRange,
  CodeTransition,
  FileCount,
  FunctionCount,
} from "../../types/code.js";
import type { EpochMs, FileHash, RelativePath, RevisionNumber } from "../../types/index.js";

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

interface Counted {
  readonly check: CodeCheckId;
  readonly fn: FunctionCount;
  readonly blob: FileHash;
  readonly outcome: CodeOutcome;
}

/**
 * Spec 015 D2 and D5: the states and transitions a work set's counts give.
 * A check keeps its identity `(path, qualified name, occurrence)`; a removed
 * check and an added one with the same body hash are a move, which keeps the
 * state and records nothing. A new function over the threshold is a
 * first-seen fail, a removed failing one is `removed`. A parse error's
 * `unknown` records no transition in or out of it (D3: it delivers nothing).
 */
export function judge(input: JudgeInput): Judged {
  const seeds = new Set(input.after.flatMap((a) => (a.quiet === true ? [a.path] : [])));
  const quiet = (check: CodeCheckId) => input.quiet || seeds.has(check.path);
  const before = new Map(input.before.map((s) => [checkKey(s.check), s]));
  const counted = countedChecks(input);
  const now = new Set(counted.map((c) => checkKey(c.check)));
  const added = counted.filter((c) => !before.has(checkKey(c.check)) && !quiet(c.check));
  const gone = new Map([...before].filter(([key]) => !now.has(key)));
  const moves = matchMoves(
    added,
    new Map([...gone].filter(([, s]) => !quiet(s.check))),
    input.bodies,
  );
  const prior = new Map(before);
  for (const { from, to } of moves) {
    const state = before.get(checkKey(from));
    if (state !== undefined) prior.set(checkKey(to), state);
  }

  const states: CodeKnownState[] = [];
  const transitions: CodeTransition[] = [];
  const edited: CodeCheckId[] = [];
  for (const c of counted) {
    const key = checkKey(c.check);
    const was = prior.get(key);
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
    if (kind !== null) {
      transitions.push(transition(input, c.check, kind, was ?? null, c));
    }
    const body = input.bodies.get(key);
    if (before.has(key) && body !== undefined && body !== c.fn.bodyHash) edited.push(c.check);
  }
  const moved = new Set(moves.map((m) => checkKey(m.from)));
  const removed: CodeCheckId[] = [];
  for (const [key, state] of gone) {
    if (moved.has(key)) continue;
    removed.push(state.check);
    if (!quiet(state.check) && state.outcome === "fail") {
      transitions.push(transition(input, state.check, "removed", state, null));
    }
  }
  return { moves, removed, states, transitions, edited };
}

function countedChecks(input: JudgeInput): Counted[] {
  const out: Counted[] = [];
  for (const file of input.after) {
    if (file.count === null) continue;
    const { blob, functions, errors } = file.count;
    for (const fn of functions) {
      const check: CodeCheckId = {
        kind: "code",
        path: file.path,
        qualifiedName: fn.qualifiedName,
        occurrence: fn.occurrence,
      };
      const outcome: CodeOutcome = errors.some((e) => overlaps(fn.range, e))
        ? "unknown"
        : fn.complexity > input.threshold
          ? "fail"
          : "pass";
      out.push({ check, fn, blob, outcome });
    }
  }
  return out;
}

/**
 * Pairs each added check with a gone check of the same body hash (D2), in
 * source order, a gone check of the same file first. A body hash the old
 * count did not keep pairs nothing.
 */
function matchMoves(
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
  input: JudgeInput,
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

/**
 * Whether the error range `b` falls in the function range `a`, both
 * end-exclusive: they share a character. A zero-width error is a missing
 * token's point, and belongs to the function it is in or whose end it
 * touches, as at a missing closing brace; a function that starts at that
 * point is not in it (review 0.1.283 B3).
 */
function overlaps(a: CodeRange, b: CodeRange): boolean {
  if (b.startLine === b.endLine && b.startColumn === b.endColumn) {
    return (
      before(a.startLine, a.startColumn, b.startLine, b.startColumn) &&
      !before(a.endLine, a.endColumn, b.startLine, b.startColumn)
    );
  }
  return (
    before(a.startLine, a.startColumn, b.endLine, b.endColumn) &&
    before(b.startLine, b.startColumn, a.endLine, a.endColumn)
  );
}

function before(line: number, column: number, otherLine: number, otherColumn: number): boolean {
  return line < otherLine || (line === otherLine && column < otherColumn);
}
