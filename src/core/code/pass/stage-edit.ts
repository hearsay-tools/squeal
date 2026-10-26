import { setImmediate as nextTurn } from "node:timers/promises";
import type { CodeCheckId, CodeKnownState, CodeTransition } from "../../types/code.js";
import type { RelativePath } from "../../types/index.js";
import { moveChecks } from "../crap/checks.js";
import { removedFailures } from "../crap/removed.js";
import { type CodeEdit, stagedId } from "../store/index.js";
import { bodiesOf } from "./bodies.js";
import type { EditPlan } from "./edit.js";
import { type End, report, writeEnd } from "./end.js";
import {
  type JudgeInput,
  judgeCounted,
  judgeGone,
  matchMoves,
  movable,
  priorOf,
  quietOf,
  type Sides,
  sidesOf,
} from "./judge.js";
import { holdRemovals } from "./listed.js";
import { inCheckOrder } from "./order.js";
import type { PassContext } from "./pass.js";
import { writePulled } from "./pulled.js";
import { clearStaged, dropStaged, inParts, partFiles } from "./stage.js";
import type { PassReport } from "./types.js";

/*
 * Row 015-55: a pull or checkout of every file of 011-197's store made an
 * edit pass's first turn 110 ms and its last 309 ms at load 7.3. An edit
 * pass over more than one part reads, judges and stages in parts, as a
 * quiet pass does (`stage.ts`), each within `PART_BUDGET_MS` and a turn
 * apart. Its moves pair checks of any two files (D2), so the parts read
 * every file before one `matchMoves`, then judge. One transaction makes
 * the staged states, edits and transitions the worktree's with the moves
 * and the meta, so a hook reads the old pass or the new one, never a mix.
 */

interface Part {
  readonly input: Omit<JudgeInput, "at">;
  readonly sides: Sides;
}

/**
 * Judges and stages an edit pass in parts, then switches to it in one
 * transaction: the symlinks' rows, the moves, the states with their edits,
 * the removals, the transitions, the pulled record and the meta.
 */
export async function stagedEditEnd(
  ctx: PassContext,
  end: Omit<End, "listed">,
  plan: EditPlan,
): Promise<PassReport> {
  const { store, worktreeId } = ctx;
  clearStaged(store, worktreeId);
  const parts = await readParts(ctx, end, plan);
  // Each step after the parts takes a turn of its own, the switch too (row 015-56).
  await nextTurn();
  const at = ctx.now();
  const input = { worktreeId, revision: end.latest, threshold: ctx.complexity.threshold, at };
  const quiet = quietOf({ quiet: false, after: plan.files });
  // One order with the one-transaction pass, whatever part a check was read in (review 0.1.330 B1).
  const gone = inCheckOrder(parts.flatMap((p) => [...p.sides.gone]));
  // A move pairs a gone check's body: only theirs are kept past their part.
  const bodies = new Map(
    parts.flatMap((p) =>
      [...p.sides.gone.keys()].flatMap((key) => {
        const body = p.input.bodies.get(key);
        return body === undefined ? [] : [[key, body] as const];
      }),
    ),
  );
  const moves = matchMoves(
    parts.flatMap((p) => p.sides.added),
    movable(gone, quiet),
    bodies,
  );
  const prior = priorOf(moves, gone);
  const { judged: removal, deferred } = holdRemovals(
    { moves, states: [], edited: [], ...judgeGone(input, quiet, gone, moves) },
    plan.held > 0,
    plan.seeds,
  );
  // D9's measures go with the function, a failing one resolved (row 015-12).
  const told = removal.removed.filter((check) => !plan.seeds.has(check.path));
  const failures = removedFailures(store, worktreeId, told, end.latest, at);
  // Staged in the order the one-transaction pass appends them.
  await stageTransitions(ctx, failures);
  const staged = await judgeParts(ctx, parts, at, prior, plan.committed);
  await stageTransitions(ctx, removal.transitions);
  const transitions = [...failures, ...staged.transitions, ...removal.transitions];
  await nextTurn();
  const done = store.transaction(() => {
    store.files.removeMany(worktreeId, [...plan.links]);
    moveChecks(store, worktreeId, moves, ctx.coverageExcluded);
    switchStates(ctx, staged.states, removal.removed, staged.edits);
    const copied = store.transitions.adopt(worktreeId, stagedId(worktreeId), transitions.length);
    if (copied !== transitions.length) store.transitions.append(transitions);
    // 015-38: the files git changed last, whose PASS or RESOLVED a session told by count is not told.
    writePulled(store.meta, worktreeId, end.latest, plan.paths, plan.committed);
    writeEnd(ctx, { ...end, listed: plan.listed(deferred) });
    return report(end.latest, null, plan.entries, end.counted, {
      moves,
      removed: removal.removed,
      transitions: [...staged.transitions, ...removal.transitions],
      edited: staged.edits.map((e) => e.check),
    });
  });
  await dropStaged(store, worktreeId);
  return done;
}

/** Each part's states, bodies and counts, read; and its sides. */
async function readParts(
  ctx: PassContext,
  end: Omit<End, "listed">,
  plan: EditPlan,
): Promise<Part[]> {
  const { store, worktreeId } = ctx;
  const parts: Part[] = [];
  await inParts(ctx, plan.files, partFiles(ctx), (files) => {
    const paths = files.map((f) => f.path);
    const before = store.states.list(worktreeId, { measure: "complexity", paths });
    const input: Omit<JudgeInput, "at"> = {
      worktreeId,
      revision: end.latest,
      threshold: ctx.complexity.threshold,
      quiet: false,
      before,
      bodies: bodiesOf(store, before, plan.languages, ctx.counter.version),
      after: files.map(({ count, ...file }) => ({ ...file, count: count() })),
    };
    parts.push({ input, sides: sidesOf({ ...input, at: 0 }) });
  });
  return parts;
}

/** Judges each part after the moves and stages its states, edits and transitions. */
async function judgeParts(
  ctx: PassContext,
  parts: readonly Part[],
  at: number,
  prior: ReadonlyMap<string, CodeKnownState>,
  committed: ReadonlySet<RelativePath>,
) {
  const { store, worktreeId } = ctx;
  const staged = stagedId(worktreeId);
  const states: CodeKnownState[] = [];
  const transitions: CodeTransition[] = [];
  const edits: CodeEdit[] = [];
  await inParts(ctx, parts, 1, ([part]) => {
    if (part === undefined) return;
    const judged = judgeCounted(
      { ...part.input, at },
      part.sides,
      (key) => prior.get(key) ?? part.sides.before.get(key),
    );
    // D6's last rule: the delivery tells a standing failure's first edit in a session once.
    // A body a move of `HEAD` brought is not the agent's edit (015-19).
    const edited = judged.edited
      .filter((check) => !committed.has(check.path))
      .map((check) => ({
        check,
        measure: "complexity" as const,
        revision: part.input.revision,
        at,
      }));
    store.transaction(() => {
      store.states.upsertMany(judged.states.map((s) => ({ ...s, worktreeId: staged })));
      store.states.markEdited(staged, edited);
    });
    store.transitions.append(judged.transitions.map((t) => ({ ...t, worktreeId: staged })));
    states.push(...judged.states);
    transitions.push(...judged.transitions);
    edits.push(...edited);
  });
  return { states, transitions, edits };
}

/** Stages `transitions`, a part's worth at a time. */
async function stageTransitions(
  ctx: PassContext,
  transitions: readonly CodeTransition[],
): Promise<void> {
  const staged = stagedId(ctx.worktreeId);
  await inParts(ctx, transitions, partFiles(ctx), (part) =>
    ctx.store.transitions.append(part.map((t) => ({ ...t, worktreeId: staged }))),
  );
}

/**
 * The staged states and their edits become the worktree's, and the removed
 * checks go. A prune between two parts takes staged rows, as their id is no
 * live worktree's; then the whole set is written here the old way.
 */
function switchStates(
  ctx: PassContext,
  states: readonly CodeKnownState[],
  removed: readonly CodeCheckId[],
  edits: readonly CodeEdit[],
): void {
  const { store, worktreeId } = ctx;
  const written = store.states.adopt(worktreeId, stagedId(worktreeId), "complexity", removed);
  if (written === states.length) return;
  store.states.upsertMany(states);
  store.states.markEdited(worktreeId, edits);
}
