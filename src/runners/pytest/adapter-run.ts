import { join } from "node:path";
import { toAbsolute } from "../../core/fs/index.js";
import {
  type AbsolutePath,
  type CheckRunResult,
  focusedTexts,
  holdsCheckText,
  isSlowLane,
  type PytestProject,
  type RunOptions,
  type RunReport,
  type TestFileRef,
} from "../../core/types/index.js";
import type { PytestAdapterOptions } from "./adapter.js";
import { type CollectionNames, enumerate } from "./enumerate.js";
import {
  environmentFingerprint,
  type PytestEnvironment,
  readEnvironmentFiles,
  syncNote,
} from "./environment/index.js";
import { type PytestRun, runPytest } from "./run/run.js";

export type ReadyEnvironment = Extract<PytestEnvironment, { state: "ready" }>;

export interface ProjectRun {
  readonly root: AbsolutePath;
  readonly project: PytestProject;
  readonly environment: ReadyEnvironment;
  readonly names: CollectionNames;
  readonly options: PytestAdapterOptions;
}

/** A tier's run, or why it stored nothing because the environment moved. */
export type RunOutcome =
  | { readonly kind: "ran"; readonly run: PytestRun; readonly report: RunReport }
  | { readonly kind: "moved"; readonly report: RunReport };

/** D2's fingerprint of the environment as it is now. */
export function currentFingerprint(environment: ReadyEnvironment): string {
  const { env, python } = environment.discovery;
  return environmentFingerprint(readEnvironmentFiles(env, python));
}

/**
 * Spec 007 D6 through `runPytest`, with D2's sync check around it: an
 * environment whose fingerprint moved since it was keyed, or during the
 * run, stores nothing (`moved`), and the adapter reads it again at the next
 * call. A completed file whose module skipped itself is listed in
 * `skippedFiles`, for the core to skip the checks it knows of the file (D6:
 * "a module-level skip skips the file's known checks"), with a `skip` for
 * each check the file lists statically as the fallback for a file the core
 * never saw (task 007-23).
 */
export async function runProject(
  context: ProjectRun,
  testFiles: readonly TestFileRef[],
  runOptions: RunOptions,
): Promise<RunOutcome> {
  const { root, project, environment, options } = context;
  const note = syncNote(project, environment.fingerprint, currentFingerprint(environment));
  if (note !== null) return { kind: "moved", report: unavailable(note) };
  const slow = runOptions.lane !== undefined && isSlowLane(runOptions.lane);
  const run = await runPytest({
    root,
    project,
    environment,
    files: testFiles,
    logDir: join(runOptions.logDir, "pytest", encodeURIComponent(project.name)),
    timeoutMs: runOptions.timeoutMs,
    // A slow tier starts every file it holds, each alone (004 D2, 007 D6).
    ...(options.concurrency === undefined || slow ? {} : { concurrency: options.concurrency() }),
    ...(options.batchSize === undefined ? {} : { batchSize: options.batchSize() }),
    ...(slow ? { alone: () => true } : {}),
    ...(options.cacheDir === undefined ? {} : { cacheDir: options.cacheDir }),
    childEnv: childEnvOf(options, runOptions.childEnv),
    ...(runOptions.stop === undefined ? {} : { signal: runOptions.stop }),
    ...(runOptions.checks === undefined ? {} : { checks: runOptions.checks }),
  });
  const after = syncNote(project, environment.fingerprint, currentFingerprint(environment));
  if (after !== null) return { kind: "moved", report: unavailable(after) };
  const skipped = await Promise.all(
    run.skippedFiles.map(({ testFile }) =>
      skipKnown(root, testFile, context.names, focusedTexts(runOptions.checks, testFile)),
    ),
  );
  const report: RunReport =
    skipped.length === 0
      ? run.report
      : {
          ...run.report,
          results: [...run.report.results, ...skipped.flat()],
          skippedFiles: run.skippedFiles,
        };
  return { kind: "ran", run, report };
}

/**
 * A `skip` for every check a skipped module lists statically: the fallback
 * of `skippedFiles`. In a focused run, for those that hold a text only.
 */
async function skipKnown(
  root: AbsolutePath,
  testFile: TestFileRef,
  names: CollectionNames,
  texts: readonly string[] | null,
): Promise<CheckRunResult[]> {
  const listed = await enumerate(toAbsolute(root, testFile.path), testFile, names).catch(() => []);
  const selected =
    texts === null ? listed : listed.filter(({ check }) => holdsCheckText(check.fullName, texts));
  return selected.map(({ check, location }) => ({
    check,
    outcome: "skip",
    durationMs: 0,
    location,
    errors: [],
  }));
}

/** The adapter's child mark and temp directory, the run's lane mark over them (004-18). */
function childEnvOf(
  options: PytestAdapterOptions,
  runEnv: Readonly<Record<string, string>> | undefined,
): Readonly<Record<string, string>> {
  const { tempDir } = options;
  return {
    ...options.childEnv,
    ...runEnv,
    ...(tempDir === undefined ? {} : { TMPDIR: tempDir, TMP: tempDir, TEMP: tempDir }),
  };
}

/** A run of a project that cannot run: nothing completed (001 D12). */
export function unavailable(failure: string): RunReport {
  return {
    end: "crashed",
    durationMs: 0,
    completedFiles: [],
    results: [],
    fileErrors: [],
    failure,
  };
}
