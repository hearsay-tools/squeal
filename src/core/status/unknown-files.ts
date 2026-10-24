import { readPolicy } from "../daemon/policy.js";
import { testFileId } from "../keys/index.js";
import { readUnknownFiles } from "../scheduler/unknown-files.js";
import { SUMMARY_MAX_CHARS, testFileKeyOf } from "../state/index.js";
import { cap, plural, testFileText } from "../text.js";
import type {
  AbsolutePath,
  EpochMs,
  KnownState,
  StatusSnapshot,
  Store,
  TestFileKeyRecord,
  UnknownCause,
  UnknownTestFile,
  UnknownTestFiles,
  WorktreeId,
} from "../types/index.js";
import { claimantOf } from "./open-runs.js";

/*
 * Task 001-403: the test files with no result at their current key and none
 * on the way, each named with why, so a checkpoint that ended `abandoned`
 * and status's `unknown` count point at the file to fix (spec 001 D5, D7).
 */

/** The most files a snapshot lists; `total` counts the rest. */
export const UNKNOWN_FILES_LISTED = 20;

/** The files `readVerdict` counts `unknown`, path order, with the reason kept for each. */
export function unknownTestFilesOf(
  store: Store,
  worktreeId: WorktreeId,
  states: readonly KnownState[],
  keys: readonly TestFileKeyRecord[],
  root?: AbsolutePath,
  now: EpochMs = Date.now(),
): { unknownTestFiles?: UnknownTestFiles } {
  const checks = checksByFile(states);
  const unknown = keys.filter((row) => {
    const own = checks.get(testFileId(row.testFile)) ?? [];
    if ((row.key !== null && row.pending !== null) || own.some((s) => s.validity === "pending")) {
      return false;
    }
    return row.key === null || own.length === 0 || own.some((s) => s.validity === "unknown");
  });
  if (unknown.length === 0) return {};
  const reasons = unknownReasons(store, worktreeId, states, root, now);
  const files = unknown
    .sort((a, b) => testFileId(a.testFile).localeCompare(testFileId(b.testFile)))
    .slice(0, UNKNOWN_FILES_LISTED)
    .map((row) => reasons.of(row, checks.get(testFileId(row.testFile)) ?? []));
  return { unknownTestFiles: { total: unknown.length, files } };
}

/** Each test file's known states, by `testFileId`. */
export function checksByFile(states: readonly KnownState[]): Map<string, KnownState[]> {
  const checks = new Map<string, KnownState[]>();
  for (const state of states) {
    const id = testFileKeyOf(state.check);
    checks.set(id, [...(checks.get(id) ?? []), state]);
  }
  return checks;
}

/** Why a file is `unknown`, for one worktree's read (`unknownReasons`). */
export interface UnknownReasons {
  of(row: TestFileKeyRecord, own: readonly KnownState[]): UnknownTestFile;
}

/**
 * Why each `unknown` file has no result, from what the store keeps (011 C15,
 * issue 24): the reason recorded at its key (001-403), an unknown check's
 * reason, a key that could not be computed, its project's failed global
 * setup, another worktree's run of its key, or a key that never had a
 * result, nothing queued for it (and why, under a lookup-only baseline).
 * `reason` is `null`, "no reason was kept", only when an unknown check kept
 * none and no record names one; the record keeps 256 files.
 */
export function unknownReasons(
  store: Store,
  worktreeId: WorktreeId,
  states: readonly KnownState[],
  root: AbsolutePath | undefined,
  now: EpochMs,
): UnknownReasons {
  const recorded = readUnknownFiles(store, worktreeId);
  const setups = new Set(
    states
      .filter((s) => s.check.kind === "setup" && s.outcome === "fail")
      .map((s) => s.check.project),
  );
  let lookupOnly: boolean | undefined;
  const isLookupOnly = () => {
    lookupOnly ??= root !== undefined && readPolicy(root).baseline.onStart === "lookup-only";
    return lookupOnly;
  };
  const reason = (
    row: TestFileKeyRecord,
    own: readonly KnownState[],
  ): { reason: string | null; cause?: UnknownCause } => {
    const summary = own.find((s) => s.validity === "unknown")?.summary ?? null;
    if (summary !== null) return { reason: summary };
    if (row.key === null) {
      return {
        reason:
          "no key: its project's environment or closure is not known (a runner call failed), or a closure path is untracked",
        cause: "runner",
      };
    }
    if (setups.has(row.testFile.project)) {
      return { reason: "its project's global setup failed", cause: "setup" };
    }
    const claimant = claimantOf(store, worktreeId, row.testFile, row.key, now);
    if (claimant !== null)
      return { reason: `${claimant.worktree.root}'s daemon is running its key` };
    if (own.length > 0) return { reason: null };
    return {
      reason: isLookupOnly()
        ? "never run at this key: the baseline is lookup-only, so nothing queued it"
        : "never run at this key, and nothing queued it",
      cause: "never-run",
    };
  };
  return {
    of(row, own) {
      const entry = recorded.get(testFileId(row.testFile));
      if (entry !== undefined && entry.key === row.key) {
        const { ran, reason, samples, cause } = entry;
        return {
          testFile: row.testFile,
          ran,
          reason,
          samples,
          ...(cause === undefined ? {} : { cause }),
        };
      }
      return { testFile: row.testFile, ran: false, samples: [], ...reason(row, own) };
    },
  };
}

/** Status's lines naming each unknown test file and why; none when there are none. */
export function unknownFilesLines(s: StatusSnapshot): string[] {
  const listed = s.unknownTestFiles;
  if (listed === undefined) return [];
  const more = listed.total - listed.files.length;
  return [
    `Test files without a result: ${listed.total} (nothing current at their inputs, none queued)`,
    ...listed.files.map((f) => `  ${unknownFileText(f)}`),
    ...(more > 0 ? [`  and ${plural(more, "more test file")}`] : []),
  ];
}

/**
 * "src/a.test.ts: ran, nothing recorded: 3 runs in a row read paths no
 * earlier run had read (paths: x, y)", or "…: no result: timed out
 * after 600 s". The project, when there is one, leads the path. The reason
 * is cut as a delivery cuts it; `status --json` keeps it whole (task 011-02).
 */
export function unknownFileText(f: UnknownTestFile): string {
  const name = testFileText(f.testFile);
  const what = f.ran ? "ran, nothing recorded" : "no result";
  const why = f.reason === null ? "no reason was kept" : cap(f.reason, SUMMARY_MAX_CHARS);
  const samples = f.samples.length === 0 ? "" : ` (paths: ${f.samples.join(", ")})`;
  return `${name}: ${what}: ${why}${samples}`;
}
