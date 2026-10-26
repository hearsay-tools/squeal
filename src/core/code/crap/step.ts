import { compare } from "../../fs/index.js";
import type { CodeFile, FileCount } from "../../types/code.js";
import type { CheckKey, EpochMs, RevisionNumber, WorktreeId } from "../../types/index.js";
import { COVERAGE_PROVIDER_VERSION } from "../coverage/record.js";
import type { CodeStore } from "../store/types.js";
import { broughtByGit, keepUnjudged } from "./brought.js";
import { StepCache } from "./cache.js";
import {
  ALL_CHECKS,
  applyChecks,
  type CoverageChecks,
  checksField,
  leaveOutSeeded,
} from "./checks.js";
import { LoaderBuild, type LoaderCondition, type LoaderInputs } from "./loaders.js";
import { Seed } from "./seed.js";
import {
  type CoverageSummary,
  readSummary,
  writeCrapRecount,
  writeEvidence,
  writeSummary,
} from "./summary.js";
import { walk } from "./walk.js";

/*
 * Spec 015 D9: the daemon's coverage step, run by the code pass after the
 * complexity pass while `coverage.enabled` holds. It judges each counted
 * source whose loaders all have a current record, and keeps a pending or
 * unknown source's last judged states. The first judgement of a function
 * that was there when coverage started, or when a recount seeded it, is
 * quiet; a function an edit added is a first-seen fail.
 */

/**
 * A step works for at most this long, its reads of the loaders and records
 * included (row 015-42), then yields to hooks and runs again. It does one
 * unit of work past it, so a chain always moves: a file seeded (row
 * 015-47), the listing of test files or one test file read into the loader
 * map (row 015-45), a file's condition looked up, a record decoded or a
 * file judged.
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
  /** Row 015-64: the checks judged and the files left out; absent, both checks and every file. */
  readonly checks?: CoverageChecks;
}

export interface CoverageStepReport {
  readonly judged: number;
  readonly transitions: number;
  /** When a waiting record turns `unknown`; `null` when none waits. */
  readonly wakeAt: EpochMs | null;
  /** Files left to judge past the budget. */
  readonly more: boolean;
  /**
   * The loader map is still being read (row 015-45): the step judged and
   * seeded nothing, so a recount's reseed waits for the step that judges.
   */
  readonly reading?: true;
  /**
   * The seed is not done (row 015-47): the step judged nothing, so a
   * recount's reseed waits for the step that judges.
   */
  readonly seeding?: true;
}

/** A step that only read part of the loader map (row 015-45). */
const READING: CoverageStepReport = {
  judged: 0,
  transitions: 0,
  wakeAt: null,
  more: true,
  reading: true,
};

/** A step that only seeded part of the files (row 015-47). */
const SEEDING: CoverageStepReport = {
  judged: 0,
  transitions: 0,
  wakeAt: null,
  more: true,
  seeding: true,
};

/** A step with no check to judge (row 015-64). */
const IDLE: CoverageStepReport = { judged: 0, transitions: 0, wakeAt: null, more: false };

/** Spec 015 D9: one step over the worktree; `null` while its first count runs. */
export function runCoverageStep(given: CoverageStepInput): CoverageStepReport | null {
  const { store, worktreeId } = given;
  const checks = given.checks ?? ALL_CHECKS;
  const work = budget(given.now);
  const cache = given.cache ?? new StepCache();
  // Without a cache the seed and the map are done whole, since no later step would go on with them.
  const slice = given.cache === undefined ? () => true : work;
  let summary = readSummary(store.meta, worktreeId);
  let reseed = given.reseed;
  // Row 015-64: a check switched off or a file left out loses its states first.
  if (summary !== null) {
    const at = { revision: given.revision, now: given.now() };
    const applied = applyChecks(store, worktreeId, checks, summary, at);
    summary = applied.summary;
    reseed ||= applied.reseed;
  }
  if (checks.measures.length === 0) return IDLE;
  // A check switched on, or a file no longer left out, is seeded and judged as a recount's.
  const input = reseed === given.reseed ? given : { ...given, reseed };
  const start = summary === null || summary.provider !== COVERAGE_PROVIDER_VERSION;
  // Each count is read once, when a file is judged or seeded.
  const counts = new Map<string, FileCount>();
  const countOf = (file: CodeFile): FileCount | null => {
    const known = counts.get(file.path);
    if (known !== undefined) return known;
    const count = store.counts.get(file.blob, file.language, file.counterVersion);
    if (count !== null) counts.set(file.path, count);
    return count;
  };
  // Row 015-47: every file is seeded before any is judged.
  if (start || input.reseed) {
    const seed = cache.seed(() => beginSeed(input, start, summary));
    const seeded = store.transaction(() => seed.advance(input, countOf, slice));
    if (seeded === "uncounted") return null;
    if (seeded === "more") return SEEDING;
  }
  const loaders = cache.loaders(
    () => new LoaderBuild({ ...input, coverage: store.coverage, now: input.now() }),
    slice,
  );
  if (loaders === null) return READING;
  const files = judgedFiles(input, checks);
  const brought = broughtByGit(store.meta, worktreeId, summary);

  const report = store.transaction(() => {
    const { next, judged, transitions, quiet, more } = walk(
      { input, cache, loaders, summary, start, countOf, work, brought },
      files,
    );
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
      ...checksField(checks.measures),
      ...(checks.exclude.length === 0 ? {} : { exclude: checks.exclude }),
    };
    if (start || JSON.stringify(written) !== JSON.stringify(summary)) {
      writeSummary(store.meta, worktreeId, written);
    }
    return { judged, transitions, wakeAt: loaders.wakeAt, more };
  });
  cache.dropSeed();
  return report;
}

/**
 * The seed a start or a recount begins. Coverage starts once the first
 * count is done, a file the counter gave up on aside, and the start's seed
 * waits for it a unit at a time (row 015-48). After, an uncounted file waits.
 * With no summary, `applyChecks` has nothing to apply against, so a start's
 * seed first leaves out what a seed the checks' change dropped wrote
 * (review 0.1.345 N2).
 */
function beginSeed(
  input: CoverageStepInput,
  start: boolean,
  summary: CoverageSummary | null,
): Seed {
  const checks = input.checks ?? ALL_CHECKS;
  const listed = input.store.files.list(input.worktreeId);
  if (summary === null) leaveOutSeeded(input.store, input.worktreeId, checks, listed);
  return new Seed(judgedFiles(input, checks, listed), start && summary !== null, start, checks);
}

/** The counted files a step judges: none too big, and none `coverage.exclude` leaves out. */
function judgedFiles(
  input: CoverageStepInput,
  checks: CoverageChecks,
  listed: readonly CodeFile[] = input.store.files.list(input.worktreeId),
): CodeFile[] {
  return listed.filter((f) => f.tooBig !== true && !checks.excluded(f.path));
}

/**
 * A step's budget from now: each call allows one more unit of work within
 * `STEP_BUDGET_MS`, and the step's first past it.
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
  // With `crap.enabled` off no state holds a threshold, and a switch on seeds quietly.
  if (!(input.checks ?? ALL_CHECKS).measures.includes("crap")) return input.threshold;
  if (more) return judgedAt;
  writeCrapRecount(input.store.meta, input.worktreeId, {
    revision: input.revision,
    at: input.now(),
    threshold: input.threshold,
  });
  return input.threshold;
}
