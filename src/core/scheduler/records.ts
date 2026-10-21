import type {
  CheckError,
  CheckId,
  CheckKey,
  CheckRunResult,
  DiagnosticFingerprint,
  FileCheckId,
  Provenance,
  ResultRecord,
  RunReport,
  SourceLocation,
  TestCheckId,
  TestFileRef,
} from "../types/index.js";
import { checkId } from "./files.js";

/**
 * Summary and fingerprint of a failure. Defaults to `describeFailure` from
 * src/core/state (review S8); tests may pass another.
 */
export type FailureDescriber = (
  errors: readonly CheckError[],
  location: SourceLocation | null,
) => { readonly summary: string | null; readonly fingerprint: DiagnosticFingerprint | null };

export function fileCheck(ref: TestFileRef): FileCheckId {
  return { kind: "file", project: ref.project, testPath: ref.path };
}

export interface FileRecordsInput {
  readonly ref: TestFileRef;
  /** The key the tier ran under. */
  readonly key: CheckKey;
  readonly report: RunReport;
  /** Checks of the file's previous key, `ResultRepo.checksForKey` (D8). */
  readonly previousChecks: readonly CheckId[];
  readonly provenance: Provenance;
  readonly describe: FailureDescriber;
}

/**
 * The results to store for one completed test file of a run.
 *
 * Spec 001 D4: "File-level errors (import or syntax failures) become a `fail`
 * for every check previously known in that file plus one file-level check."
 * D8: "the file-level error expansion uses the checks of the file's previous
 * key, never every check ever seen." A check that ran in this run keeps its
 * own result: an unhandled error attributed to the file after its tests ran
 * fails the file-level check, not the tests that passed. A file with no
 * file-level error records a `pass` for its file-level check.
 *
 * The file-level check carries the whole file's time, its tests included,
 * when the runner reports a file duration, so `why` shows what the file
 * costs (row 013-03, gh-62: one cezar file read 3.5 s, its time outside its
 * tests, where its run took 112 s); `durationOf` reads it for D5 step 4,
 * after a run and after a lookup alike.
 *
 * A file whose module skipped itself (`RunReport.skippedFiles`, spec 007 D6:
 * "a module-level skip skips the file's known checks") records `skip` for
 * every test check of its previous key, inherited ones included, in place of
 * the runner's results for it; those stand only when the key held none
 * (task 007-23).
 */
export function recordsForFile(input: FileRecordsInput): ResultRecord[] {
  const { ref, key, report, provenance, describe } = input;
  const inFile = (check: CheckId) => check.project === ref.project && check.testPath === ref.path;
  const records: ResultRecord[] = [];
  const ran = new Set<string>();
  for (const result of fileResults(input, inFile)) {
    ran.add(checkId(result.check));
    const failure =
      result.outcome === "fail"
        ? describe(result.errors, result.location)
        : { summary: null, fingerprint: null };
    records.push({
      check: result.check,
      key,
      outcome: result.outcome,
      durationMs: result.durationMs,
      location: result.location,
      ...failure,
      errors: result.errors,
      provenance,
    });
  }

  // Task 001-361: the runner marks no error as a hook's, but a hook runs only
  // once the file loaded, and then its tests report (as skipped when a
  // `beforeAll` threw). A file-level error with no test reported is a load error;
  // one stored after they reported is an error after its tests ran (task 011-19).
  const phase: CheckError["phase"] = ran.size > 0 ? "after-tests" : "load";
  const errors = report.fileErrors
    .filter((e) => e.testFile.project === ref.project && e.testFile.path === ref.path)
    .flatMap((e) => e.errors.map((error): CheckError => ({ ...error, phase })));
  const fileMs =
    report.fileDurations?.find(
      (d) => d.testFile.project === ref.project && d.testFile.path === ref.path,
    )?.durationMs ?? 0;
  if (errors.length === 0) {
    // Spec 001 D6: "The file-level check of a test file records `pass`
    // whenever the file loads, so a fixed import or syntax error closes with
    // `fail -> pass` like any test."
    records.push({
      check: fileCheck(ref),
      key,
      outcome: "pass",
      durationMs: fileMs,
      location: null,
      summary: null,
      fingerprint: null,
      errors: [],
      provenance,
    });
    return records;
  }
  const location = errors[0]?.location ?? null;
  const failure = describe(errors, location);
  const failed = (check: CheckId): ResultRecord => ({
    check,
    key,
    outcome: "fail",
    durationMs: 0,
    location,
    ...failure,
    errors,
    provenance,
  });
  for (const check of input.previousChecks) {
    if (check.kind === "test" && inFile(check) && !ran.has(checkId(check))) {
      records.push(failed(check));
    }
  }
  records.push({ ...failed(fileCheck(ref)), durationMs: fileMs });
  return records;
}

/** The run's results of the file, or a `skip` for each known check of a skipped module. */
function fileResults(
  { ref, report, previousChecks }: FileRecordsInput,
  inFile: (check: CheckId) => boolean,
): readonly CheckRunResult[] {
  const listed = report.results.filter((result) => inFile(result.check));
  const skipped = report.skippedFiles?.some(
    (s) => s.testFile.project === ref.project && s.testFile.path === ref.path,
  );
  if (skipped !== true) return listed;
  const known = previousChecks.filter(
    (check): check is TestCheckId => check.kind === "test" && inFile(check),
  );
  if (known.length === 0) return listed;
  return known.map((check) => ({
    check,
    outcome: "skip",
    durationMs: 0,
    location: null,
    errors: [],
  }));
}
