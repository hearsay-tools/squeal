import type {
  CheckKey,
  EpochMs,
  Policy,
  RelativePath,
  RevisionNumber,
  WorktreeId,
} from "../../types/index.js";
import type { LintCheckId, LintKnownState, LintTransition } from "../../types/lint.js";
import type { LintStore } from "../store/types.js";
import {
  type JudgeAt,
  judgeRemoved,
  judgeResult,
  lintCheck,
  pendingState,
  unknownState,
} from "./judge.js";
import type { Keyed, Keyer } from "./keyer.js";
import { environmentOf, includedSet } from "./keys.js";
import type { LintFileInputs } from "./provider.js";
import {
  failedKey,
  type LintCursor,
  type LintProgram,
  readCursor,
  readProgram,
  readQuiet,
  writeCursor,
  writeProgram,
  writeQuiet,
  writeReason,
} from "./records.js";
import { isFlatConfig } from "./session.js";
import type { LintPassReport, LintSource } from "./types.js";

export interface RekeyContext {
  readonly worktreeId: WorktreeId;
  readonly store: LintStore;
  readonly source: LintSource;
  readonly lint: Policy["lint"];
  readonly now: () => EpochMs;
}

/** What a keying did, and what its parts take first. */
export interface Rekeyed extends Pick<LintPassReport, "mode" | "keyed" | "hits" | "stale"> {
  readonly transitions: number;
  /** D7 step 4: the revision's changed files; at a first pass, the latest revision's. */
  readonly first: ReadonlySet<RelativePath>;
  /** The changed program files, fed to the edit's lint call (017-04's contract). */
  readonly feed: readonly RelativePath[];
}

/** What a keying reads before it asks the provider. */
interface Plan {
  readonly mode: LintPassReport["mode"];
  readonly environment: string;
  readonly states: ReadonlyMap<RelativePath, LintKnownState>;
  readonly changed: readonly RelativePath[];
  /** The paths keyed again, sorted. */
  readonly candidates: readonly RelativePath[];
  readonly at: JudgeAt;
}

/**
 * Spec 017 D7 steps 1 to 3 at `latest`. With no cursor (`first`) or a
 * moved environment (`config`), every included file is keyed and none
 * records a transition (D2's last row, 015 D5's first count); else the
 * files the revisions since the cursor changed (`edit`). Each key is looked
 * up: a hit is the file's state with no lint, a miss reads `pending`. When
 * the program segment moved, every other whole-program file reads `stale`
 * with its outcome kept, keyed when it lints (D5). One transaction writes
 * it all with the cursor; `null` when nothing was due. Inputs the provider
 * refuses (D9) make the keyed files `unknown` and keep the cursor, so the
 * next pass keys them again.
 */
export async function rekey(
  ctx: RekeyContext,
  keyer: Keyer,
  latest: RevisionNumber,
): Promise<Rekeyed | null> {
  const { store, worktreeId, source } = ctx;
  const program = readProgram(store.meta, worktreeId);
  const plan =
    planOf(ctx, keyer, latest, readCursor(store.meta, worktreeId)) ??
    programMoved(ctx, keyer, latest, program);
  if (plan === null) return null;
  const { mode, candidates } = plan;
  const included = includedSet(ctx.lint, source.ignored());
  let inputs: Map<RelativePath, LintFileInputs>;
  try {
    inputs = await keyer.inputs(candidates.filter(included));
  } catch (error) {
    failKeying(ctx, plan, error);
    return null;
  }
  keyer.setLintable(() => lintableAfter(ctx, plan, inputs));
  const keys = await keyer.keys([...inputs.keys()]);
  const whole = new Set(mode === "edit" ? program.files : []);
  for (const path of candidates) {
    if (keys.get(path)?.wholeProgram === true) whole.add(path);
    else whole.delete(path);
  }
  const segment = whole.size === 0 ? "" : keyer.segment;
  const taken = new Set(candidates);
  const others =
    mode === "edit" && segment !== program.segment ? [...whole].filter((p) => !taken.has(p)) : [];

  const writes = judgeAll(ctx, plan, keys);
  const stale = staleOthers(statesOf(ctx, others), others, writes);
  store.transaction(() => {
    writes.commit(ctx, plan.at);
    writeCursor(store.meta, worktreeId, { revision: latest, environment: plan.environment });
    writeProgram(store.meta, worktreeId, { segment, files: [...whole] });
    writeReason(store.meta, failedKey(worktreeId), null);
  });
  const programFiles = new Set(keyer.basis.snapshot.program);
  return {
    mode,
    keyed: keys.size,
    hits: writes.hits,
    stale,
    transitions: writes.transitions.length,
    first: new Set(mode === "edit" ? plan.changed : source.changedPaths(latest - 1, latest)),
    feed: mode === "edit" ? plan.changed.filter((p) => programFiles.has(p) && keyer.blobOf(p)) : [],
  };
}

/** The keying due at `latest`, or `null` when the cursor and its environment are current. */
function planOf(
  ctx: RekeyContext,
  keyer: Keyer,
  latest: RevisionNumber,
  cursor: LintCursor | null,
): Plan | null {
  const { worktreeId, source } = ctx;
  const environment = environmentOf(keyer.basis, ctx.lint, keyer.blobOf);
  const changed =
    cursor === null || cursor.revision === latest
      ? []
      : source.changedPaths(cursor.revision, latest);
  // A nested flat config moves the computed config of every file below it: all re-key.
  const mode =
    cursor === null
      ? "first"
      : cursor.environment === environment && !changed.some(isFlatConfig)
        ? "edit"
        : "config";
  if (mode === "edit" && cursor?.revision === latest) return null;
  // An edit reads the states of its own paths only: a pass per edit stays off the whole set.
  const states = statesOf(ctx, mode === "edit" ? changed : undefined);
  const all = mode === "edit" ? changed : [...source.files().map((f) => f.path), ...states.keys()];
  return {
    mode,
    environment,
    states,
    changed,
    candidates: [...new Set(all)].sort(),
    at: { worktreeId, revision: latest, now: ctx.now() },
  };
}

/**
 * An edit keying with no revision since the cursor, when the program
 * segment moved anyway: a lint report grew the program (017-04's contract),
 * and the whole-program files read `stale` (D5).
 */
function programMoved(
  ctx: RekeyContext,
  keyer: Keyer,
  latest: RevisionNumber,
  program: LintProgram,
): Plan | null {
  if (program.files.length === 0 || keyer.segment === program.segment) return null;
  const { worktreeId } = ctx;
  return {
    mode: "edit",
    environment: environmentOf(keyer.basis, ctx.lint, keyer.blobOf),
    states: new Map(),
    changed: [],
    candidates: [],
    at: { worktreeId, revision: latest, now: ctx.now() },
  };
}

/** A worktree's states by path: of `paths`, or every one. */
function statesOf(
  ctx: RekeyContext,
  paths: readonly RelativePath[] | undefined,
): Map<RelativePath, LintKnownState> {
  if (paths?.length === 0) return new Map();
  const filter = paths === undefined ? {} : { paths };
  return new Map(ctx.store.states.list(ctx.worktreeId, filter).map((s) => [s.check.path, s]));
}

/**
 * The files ESLint lints in the worktree after the keying, read only when
 * a whole-program file is keyed: D5's program segment holds them.
 */
function lintableAfter(
  ctx: RekeyContext,
  plan: Plan,
  inputs: ReadonlyMap<RelativePath, LintFileInputs>,
): Set<RelativePath> {
  const lintable = new Set(plan.mode === "edit" ? statesOf(ctx, undefined).keys() : []);
  for (const path of plan.candidates) {
    if (inputs.has(path)) lintable.add(path);
    else lintable.delete(path);
  }
  return lintable;
}

/** D9: the provider refused the inputs; each candidate with a state reads `unknown` with why. */
function failKeying(ctx: RekeyContext, plan: Plan, error: unknown): void {
  const reason = error instanceof Error ? error.message : String(error);
  const unknown = plan.candidates.flatMap((path) => {
    const prior = plan.states.get(path);
    return prior === undefined ? [] : [unknownState(prior, path, plan.at, reason)];
  });
  ctx.store.transaction(() => {
    ctx.store.states.upsertMany(unknown);
    writeReason(ctx.store.meta, failedKey(ctx.worktreeId), reason);
  });
}

/** The writes of one keying, made in one transaction with its cursor. */
class Writes {
  readonly states: LintKnownState[] = [];
  readonly removed: LintCheckId[] = [];
  readonly transitions: LintTransition[] = [];
  readonly used: [LintCheckId, CheckKey][] = [];
  hits = 0;

  constructor(readonly quiet: Set<RelativePath>) {}

  commit(ctx: RekeyContext, at: JudgeAt): void {
    const { store, worktreeId } = ctx;
    store.states.removeMany(worktreeId, this.removed);
    store.states.upsertMany(this.states);
    store.transitions.append(this.transitions);
    for (const [check, key] of this.used) store.results.use(check, key, at.now);
    writeQuiet(store.meta, worktreeId, this.quiet);
  }
}

/**
 * Each candidate's next state: removed when ESLint no longer lints it or it
 * is gone, judged on a hit, `pending` on a miss. A first or config keying's
 * misses join the quiet set, and so record no transition when they lint.
 */
function judgeAll(ctx: RekeyContext, plan: Plan, keys: ReadonlyMap<RelativePath, Keyed>): Writes {
  const { store, worktreeId } = ctx;
  const edit = plan.mode === "edit";
  const writes = new Writes(edit ? readQuiet(store.meta, worktreeId) : new Set());
  for (const path of plan.candidates) {
    const prior = plan.states.get(path) ?? null;
    const keyed = keys.get(path);
    const cause = edit && !writes.quiet.has(path) ? "edit" : "config";
    if (keyed === undefined) {
      if (prior === null) continue;
      // D2: deleted or excluded while `fail` is resolved once; quietly in a config keying.
      const removal = cause === "edit" ? judgeRemoved(store.results, prior, plan.at) : null;
      if (removal !== null) writes.transitions.push(removal);
      writes.removed.push(prior.check);
      writes.quiet.delete(path);
      continue;
    }
    const result = store.results.get(lintCheck(path), keyed.key);
    if (result === null) {
      writes.states.push(pendingState(prior, path, plan.at));
      if (!edit) writes.quiet.add(path);
      continue;
    }
    const judged = judgeResult(store.results, prior, result, keyed.blob, { ...plan.at, cause });
    writes.states.push(judged.state);
    if (judged.transition !== null) writes.transitions.push(judged.transition);
    writes.used.push([result.check, result.key]);
    writes.quiet.delete(path);
    writes.hits++;
  }
  return writes;
}

/** D5: whole-program files the edit did not change read `stale`, outcome kept; how many newly. */
function staleOthers(
  states: ReadonlyMap<RelativePath, LintKnownState>,
  others: readonly RelativePath[],
  writes: Writes,
): number {
  let stale = 0;
  for (const path of others) {
    const prior = states.get(path);
    if (prior === undefined || prior.stale || prior.outcome === "pending") continue;
    writes.states.push({ ...prior, stale: true });
    stale++;
  }
  return stale;
}
