import type { CheckKey, FileHash, RelativePath } from "../../types/index.js";
import type { LintKnownState, LintResult, LintTransition } from "../../types/lint.js";
import { type JudgeAt, judgeResult, lintCheck, resultOf, unknownState } from "./judge.js";
import type { Keyer } from "./keyer.js";
import type { PartsContext } from "./parts.js";
import type { LintEnvironment, LintRunReport } from "./provider.js";

/** What one part did. */
export interface LintedPart {
  readonly linted: number;
  readonly hits: number;
  readonly transitions: number;
  /** Why the provider turned itself off (D9), or `null`. */
  readonly off: string | null;
  /** The report named an input the keys did not hold: the next pass keys again (B3). */
  readonly grew: boolean;
}

/** A part's file at the bytes it is linted at; `key` is `null` for a feed file ESLint does not lint. */
export interface PartFile {
  readonly path: RelativePath;
  readonly text: string;
  readonly blob: FileHash;
  readonly key: CheckKey | null;
  /** D5: its key holds the program segment. */
  readonly wholeProgram: boolean;
}

type Answer = LintResult | { readonly unknown: string };

const NONE: LintedPart = { linted: 0, hits: 0, transitions: 0, off: null, grew: false };

/**
 * One part. A file waiting to lint (`pending` or stale) whose key another
 * worktree linted since is a hit (goal 7); the misses and the part's feed
 * files go to the provider in one call. With `judged`, once every changed
 * program file is fed, each miss's result is stored at its key and judged;
 * a file it gives none for, or a call that throws, reads `unknown` with the
 * reason (D9). Without it the misses stay `pending` for a later part. A
 * feed file not waiting is fed only. A quiet file records no transition
 * (D2's last row) and leaves `quiet`, which the pass writes when its parts
 * end. One transaction writes the rest. On `LintOff` nothing is written and
 * the provider is closed. A report that names an input the keys did not
 * hold stores nothing for the files whose keys it moves, hits included:
 * they stay `pending` or stale for the next pass's keys (D5, review
 * 0.1.348 B3).
 */
export async function lintFiles(
  ctx: PartsContext,
  keyer: Keyer,
  files: readonly PartFile[],
  judged: boolean,
  quiet: Set<RelativePath>,
): Promise<LintedPart> {
  const { store, worktreeId } = ctx;
  const priors = new Map(
    store.states
      .list(worktreeId, { paths: files.map((f) => f.path) })
      .map((s) => [s.check.path, s]),
  );
  const waiting = (f: PartFile) => {
    const prior = priors.get(f.path);
    return f.key !== null && (prior?.outcome === "pending" || prior?.stale === true);
  };
  const hits: [PartFile, LintResult][] = [];
  const misses: PartFile[] = [];
  for (const file of files.filter(waiting)) {
    const stored = store.results.get(lintCheck(file.path), file.key as CheckKey);
    if (stored === null) misses.push(file);
    else hits.push([file, stored]);
  }
  const call = files.filter((f) => ctx.feed.has(f.path) || misses.includes(f));
  const asked = call.length === 0 ? null : await ask(ctx, keyer, call, misses);
  for (const file of call) ctx.feed.delete(file.path);
  if (asked !== null && "off" in asked) return { ...NONE, off: asked.off };
  const moved = (f: PartFile) =>
    asked?.grew.closure === true || (asked?.grew.program === true && f.wholeProgram);
  const answers = new Map<RelativePath, Answer>();
  if (judged) {
    for (const [path, answer] of asked?.answers ?? []) {
      if (!moved(misses.find((f) => f.path === path) as PartFile)) answers.set(path, answer);
    }
  }

  const at: JudgeAt = { worktreeId, revision: ctx.latest, now: ctx.now() };
  const states: LintKnownState[] = [];
  const transitions: LintTransition[] = [];
  const judge = (file: PartFile, result: LintResult) => {
    const cause = quiet.has(file.path) ? "config" : "edit";
    const prior = priors.get(file.path) ?? null;
    const next = judgeResult(store.results, prior, result, file.blob, { ...at, cause });
    states.push(next.state);
    if (next.transition !== null) transitions.push(next.transition);
    quiet.delete(file.path);
  };
  const kept = hits.filter(([file]) => !moved(file));
  for (const [file, result] of kept) judge(file, result);
  const stored: LintResult[] = [];
  for (const [path, answer] of answers) {
    const file = misses.find((f) => f.path === path) as PartFile;
    if ("unknown" in answer) {
      states.push(unknownState(priors.get(path) ?? null, path, at, answer.unknown));
      continue;
    }
    // Judged before it is stored: the transition reads the result it was judged on.
    judge(file, answer);
    stored.push(answer);
  }
  store.transaction(() => {
    for (const result of stored) store.results.put(result, at.now);
    for (const [, result] of kept) store.results.use(result.check, result.key, at.now);
    store.states.upsertMany(states);
    store.transitions.append(transitions);
  });
  const grew = asked?.grew.closure === true || asked?.grew.program === true;
  return {
    linted: answers.size,
    hits: kept.length,
    transitions: transitions.length,
    off: null,
    grew,
  };
}

/**
 * The provider's lint of `call`: each miss's answer, and whether the report
 * named a closure file or a program file the keys did not hold. A call that
 * throws makes each miss `unknown` with its message (D9).
 */
async function ask(
  ctx: PartsContext,
  keyer: Keyer,
  call: readonly PartFile[],
  misses: readonly PartFile[],
): Promise<
  { readonly answers: Map<RelativePath, Answer>; readonly grew: Grew } | { readonly off: string }
> {
  let report: LintRunReport;
  try {
    const given = await keyer.provider.lint(call.map(({ path, text }) => ({ path, text })));
    if ("off" in given) return ctx.session.turnOff(given.off, ctx.latest);
    report = given;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const grew = { closure: false, program: false };
    return { answers: new Map(misses.map((f) => [f.path, { unknown: reason }])), grew };
  }
  const grew = grown(keyer, report);
  ctx.session.observe(report);
  const version = keyer.basis.snapshot.declaration.toolVersion;
  const at = ctx.now();
  const answers = new Map<RelativePath, Answer>();
  for (const file of misses) {
    const given = report.results.get(file.path);
    if (given === undefined) answers.set(file.path, { unknown: "the provider gave no result" });
    else if ("unknown" in given) answers.set(file.path, given);
    else
      answers.set(
        file.path,
        resultOf(file.path, file.key as CheckKey, given.findings, version, at),
      );
  }
  return { answers, grew };
}

/**
 * Which keys a report's inputs moved: every key for a closure file they did
 * not hold, a whole-program key for a program file the segment did not hold.
 */
interface Grew {
  readonly closure: boolean;
  readonly program: boolean;
}

function grown(keyer: Keyer, report: LintEnvironment): Grew {
  const closure = new Set(keyer.basis.snapshot.closure);
  return {
    closure: report.closure.some((p) => !closure.has(p)),
    program: report.program.some((p) => !keyer.holds(p)),
  };
}

/** D9: inputs the provider refused make the part's waiting files `unknown` with why. */
export function unknownPart(
  ctx: PartsContext,
  paths: readonly RelativePath[],
  reason: string,
): LintedPart {
  const { store, worktreeId } = ctx;
  const at: JudgeAt = { worktreeId, revision: ctx.latest, now: ctx.now() };
  const states = store.states
    .list(worktreeId, { paths })
    .filter((s) => s.outcome === "pending" || s.stale)
    .map((s) => unknownState(s, s.check.path, at, reason));
  store.states.upsertMany(states);
  for (const path of paths) ctx.feed.delete(path);
  return NONE;
}
