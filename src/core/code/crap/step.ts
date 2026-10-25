import { compare } from "../../fs/index.js";
import type { CodeFile, CodeKnownState, FileCount } from "../../types/code.js";
import type { CheckKey, EpochMs, RevisionNumber, WorktreeId } from "../../types/index.js";
import { COVERAGE_PROVIDER_VERSION } from "../coverage/record.js";
import { uncountableFiles } from "../pass/failed.js";
import type { CodeStore } from "../store/types.js";
import { broughtByGit, keepUnjudged } from "./brought.js";
import { StepCache } from "./cache.js";
import { coverageOf, type FileCondition, type ReadyLoader } from "./file.js";
import { checkOf, evidenceOf, type Judged, judgeFiles, priorKey } from "./judge.js";
import { type LoaderCondition, type LoaderInputs, type Loaders, readLoaders } from "./loaders.js";
import {
  type CoverageSummary,
  type FileSummary,
  functionKey,
  readSummary,
  writeCrapRecount,
  writeEvidence,
  writeSummary,
} from "./summary.js";

/*
 * Spec 015 D9: the daemon's coverage step, run by the code pass after the
 * complexity pass while `coverage.enabled` holds. It judges each counted
 * source whose loaders all have a current record, and keeps a pending or
 * unknown source's last judged states. The first judgement of a function
 * that was there when coverage started, or when a recount seeded it, is
 * quiet; a function an edit added is a first-seen fail.
 */

export const COVERAGE_MEASURES = ["crap", "uncovered"] as const;

/**
 * A step works for at most this long, its reads of the loaders and records
 * included (row 015-42), then yields to hooks and runs again. It does one
 * unit of work, a record decoded or a file judged, past it, so a chain
 * always moves.
 */
export const STEP_BUDGET_MS = 50;

export interface CoverageStepInput {
  readonly store: CodeStore;
  readonly main: LoaderInputs["main"];
  readonly closures: LoaderInputs["closures"];
  readonly worktreeId: WorktreeId;
  readonly revision: RevisionNumber;
  /** `crap.threshold`. */
  readonly threshold: number;
  readonly now: () => EpochMs;
  /** The records' writer has work in hand: a result with no record may still get one. */
  readonly writing: boolean;
  /** Loader conditions that cannot change at their key, kept by the pass. */
  readonly settled: Map<CheckKey, LoaderCondition>;
  /** The complexity pass rebuilt every state: a function with no coverage state is seeded, not new. */
  readonly reseed: boolean;
  /** What the steps of a chain keep (row 015-42); absent, the step reads everything afresh. */
  readonly cache?: StepCache;
}

export interface CoverageStepReport {
  readonly judged: number;
  readonly transitions: number;
  /** When a waiting record turns `unknown`; `null` when none waits. */
  readonly wakeAt: EpochMs | null;
  /** Files left to judge past the budget. */
  readonly more: boolean;
}

/** Spec 015 D9: one step over the worktree; `null` while its first count runs. */
export function runCoverageStep(input: CoverageStepInput): CoverageStepReport | null {
  const { store, worktreeId } = input;
  const work = budget(input.now);
  const cache = input.cache ?? new StepCache();
  const files = store.files.list(worktreeId).filter((f) => f.tooBig !== true);
  const summary = readSummary(store.meta, worktreeId);
  const start = summary === null || summary.provider !== COVERAGE_PROVIDER_VERSION;
  // Coverage starts once the first count is done (a file the counter gave up on aside), so a
  // function it counts later is seeded with the rest, not new. After, an uncounted file waits.
  if (start) {
    const spent = uncountableFiles(store, worktreeId, files);
    if (store.files.uncounted(worktreeId).some((f) => !spent.has(f.path))) return null;
  }
  // Each count is read once, when a file is judged or seeded.
  const counts = new Map<string, FileCount>();
  const countOf = (file: CodeFile): FileCount | null => {
    const known = counts.get(file.path);
    if (known !== undefined) return known;
    const count = store.counts.get(file.blob, file.language, file.counterVersion);
    if (count !== null) counts.set(file.path, count);
    return count;
  };
  const loaders = cache.loaders(() =>
    readLoaders({ ...input, coverage: store.coverage, now: input.now() }),
  );
  const { next, judged, quiet, more } = walk(
    { input, cache, loaders, summary, start, countOf, work },
    files,
  );

  return store.transaction(() => {
    if (start || input.reseed) seed(input, files, countOf, start && summary !== null);
    const brought = broughtByGit(store.meta, worktreeId, summary, next);
    const transitions = writeJudgement(input, judged, brought);
    keepUnjudged(brought, files, next);
    for (const path of Object.keys(summary?.files ?? {})) {
      if (next[path] === undefined) writeEvidence(store.meta, worktreeId, path, null);
    }
    const waiting = [...quiet].filter((path) => next[path] !== undefined).sort(compare);
    const written: CoverageSummary = {
      v: 1,
      since: start ? input.revision : (summary?.since ?? input.revision),
      provider: COVERAGE_PROVIDER_VERSION,
      files: next,
      ...(waiting.length === 0 ? {} : { quiet: waiting }),
      ...(loaders.withoutImports === 0 ? {} : { withoutImports: loaders.withoutImports }),
      threshold: thresholdAfter(input, start ? null : summary, more),
      ...(brought.size === 0 ? {} : { brought: Object.fromEntries(brought) }),
    };
    if (start || JSON.stringify(written) !== JSON.stringify(summary)) {
      writeSummary(store.meta, worktreeId, written);
    }
    return { judged: judged.length, transitions, wakeAt: loaders.wakeAt, more };
  });
}

/**
 * A step's budget from now: each call allows one more unit of work, a
 * record decoded or a file judged, within `STEP_BUDGET_MS`, and the step's
 * first past it.
 */
function budget(now: () => EpochMs): () => boolean {
  const began = now();
  let worked = false;
  return () => {
    if (worked && now() - began > STEP_BUDGET_MS) return false;
    worked = true;
    return true;
  };
}

interface Walk {
  readonly input: CoverageStepInput;
  readonly cache: StepCache;
  readonly loaders: Loaders;
  readonly summary: CoverageSummary | null;
  readonly start: boolean;
  readonly countOf: (file: CodeFile) => FileCount | null;
  readonly work: () => boolean;
}

/**
 * Each file's summary, and the ready files judged within the step's
 * budget; a file past it keeps its last summary, and `more` is set.
 */
function walk(at: Walk, files: readonly CodeFile[]) {
  const { input, cache, loaders, summary, start, work } = at;
  const next: Record<string, FileSummary> = {};
  const judged: Judged[] = [];
  // B2 (review 0.1.297): a recount's files stay quiet until each is judged, records waited for too.
  const quiet = new Set(input.reseed ? files.map((f) => f.path) : (summary?.quiet ?? []));
  const keys = (ready: readonly ReadyLoader[]) => ready.map((l) => l.key);
  const record = (key: CheckKey) => cache.record(input.store.coverage, key);
  let more = false;
  for (const file of files) {
    const before = summary?.files[file.path];
    const condition = cache.condition(file.path, loaders);
    if (condition.state !== "ready") {
      next[file.path] = summaryOf(file, condition);
      continue;
    }
    const signature = cache.signature(file, input.threshold, condition.loaders);
    const recounted = quiet.has(file.path);
    if (!start && !recounted && before?.state === "judged" && before.signature === signature) {
      next[file.path] = before;
      continue;
    }
    if (!cache.decode(input.store.coverage, keys(condition.loaders), work) || !work()) {
      more = true;
      if (before !== undefined) next[file.path] = before;
      continue;
    }
    const count = at.countOf(file);
    if (count === null) continue;
    const coverage = coverageOf(file, count.functions, condition.loaders, record);
    if (coverage === "unread") {
      next[file.path] = { state: "unknown", blob: file.blob, cause: "unread" };
      continue;
    }
    next[file.path] = { state: "judged", blob: file.blob, signature };
    judged.push({ file, count, coverage, ...(recounted ? { quiet: true } : {}) });
    quiet.delete(file.path);
  }
  return { next, judged, quiet, more };
}

/**
 * Judges `judged`, and writes the states, the transitions, D6's edits
 * (row 015-40) and the evidence; the number of transitions. An own edit
 * that git changed the file after (`brought`) is not the body judged, so it
 * marks none (review 0.1.299 B1).
 */
function writeJudgement(
  input: CoverageStepInput,
  judged: readonly Judged[],
  brought: ReadonlyMap<string, RevisionNumber>,
): number {
  const { store, worktreeId } = input;
  const paths = judged.map((j) => j.file.path);
  if (paths.length === 0) return 0;
  const prior = new Map(store.states.list(worktreeId, { paths }).map((s) => [priorKey(s), s]));
  const judgedPaths = new Set(paths);
  const edits = new Map(
    store.states
      .edits(worktreeId, "complexity")
      .filter(
        (e) => judgedPaths.has(e.check.path) && e.revision > (brought.get(e.check.path) ?? -1),
      )
      .map((e) => [`${e.check.path}\0${functionKey(e.check)}`, e]),
  );
  const { revision, threshold } = input;
  const { states, transitions, edited } = judgeFiles(
    { worktreeId, revision, threshold, at: input.now(), prior, edits },
    judged,
  );
  store.states.upsertMany(states);
  store.transitions.append(transitions);
  // D6's first edit to a standing failure, for these measures too.
  store.states.markEdited(worktreeId, edited);
  for (const j of judged) writeEvidence(store.meta, worktreeId, j.file.path, evidenceOf(j));
  return transitions.length;
}

/**
 * Row 015-40: the `crap.threshold` the summary keeps, every ready file
 * judged at it. A change from the one `summary` keeps (`null` as coverage
 * starts) is recorded for the delivery's summary line once no file is left
 * past the budget (`more`); until then the summary keeps the old one.
 */
function thresholdAfter(
  input: CoverageStepInput,
  summary: CoverageSummary | null,
  more: boolean,
): number {
  const judgedAt = summary?.threshold;
  if (judgedAt === undefined || judgedAt === input.threshold) return input.threshold;
  if (more) return judgedAt;
  writeCrapRecount(input.store.meta, input.worktreeId, {
    revision: input.revision,
    at: input.now(),
    threshold: input.threshold,
  });
  return input.threshold;
}

function summaryOf(file: CodeFile, condition: Exclude<FileCondition, { state: "ready" }>) {
  return condition.state === "pending"
    ? {
        state: "pending" as const,
        blob: file.blob,
        reason: condition.reason,
        waiting: condition.waiting,
      }
    : { state: "unknown" as const, blob: file.blob, cause: condition.cause };
}

/**
 * A `pending` state for each function with no coverage state, so its first
 * judgement is quiet: the functions there when coverage started, or that a
 * first count or recount brought. With `again`, every state is pending
 * again: the provider's records changed meaning.
 */
function seed(
  input: CoverageStepInput,
  files: readonly CodeFile[],
  countOf: (file: CodeFile) => FileCount | null,
  again: boolean,
): void {
  const { store, worktreeId, revision } = input;
  const known = new Set(
    again
      ? []
      : store.states
          .list(worktreeId, { measure: "crap" })
          .map((s) => `${functionKey(s.check)}\0${s.check.path}`),
  );
  const states: CodeKnownState[] = [];
  for (const file of files) {
    for (const fn of countOf(file)?.functions ?? []) {
      if (known.has(`${functionKey(fn)}\0${file.path}`)) continue;
      for (const measure of COVERAGE_MEASURES) {
        states.push({
          worktreeId,
          check: checkOf(file.path, fn),
          measure,
          outcome: "pending",
          value: null,
          threshold: null,
          countedAt: revision,
          blob: file.blob,
          changedAt: revision,
        });
      }
    }
  }
  store.states.upsertMany(states);
}
