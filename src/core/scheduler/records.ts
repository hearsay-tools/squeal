import type {
  CheckError,
  CheckId,
  CheckKey,
  DiagnosticFingerprint,
  FileCheckId,
  Provenance,
  ResultRecord,
  RunReport,
  SourceLocation,
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
 */
export function recordsForFile(input: FileRecordsInput): ResultRecord[] {
  const { ref, key, report, provenance, describe } = input;
  const inFile = (check: CheckId) => check.project === ref.project && check.testPath === ref.path;
  const records: ResultRecord[] = [];
  const ran = new Set<string>();
  for (const result of report.results) {
    if (!inFile(result.check)) continue;
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

  const errors = report.fileErrors
    .filter((e) => e.testFile.project === ref.project && e.testFile.path === ref.path)
    .flatMap((e) => e.errors);
  if (errors.length === 0) {
    // Spec 001 D6: "The file-level check of a test file records `pass`
    // whenever the file loads, so a fixed import or syntax error closes with
    // `fail -> pass` like any test."
    records.push({
      check: fileCheck(ref),
      key,
      outcome: "pass",
      durationMs: 0,
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
  records.push(failed(fileCheck(ref)));
  return records;
}
