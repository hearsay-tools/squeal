import { testFileId } from "../keys/index.js";
import { readUnknownFiles } from "../scheduler/unknown-files.js";
import { SUMMARY_MAX_CHARS, testFileKeyOf } from "../state/index.js";
import { cap, plural } from "../text.js";
import type {
  KnownState,
  StatusSnapshot,
  Store,
  TestFileKeyRecord,
  UnknownTestFile,
  UnknownTestFiles,
  WorktreeId,
} from "../types/index.js";

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
): { unknownTestFiles?: UnknownTestFiles } {
  const checks = new Map<string, KnownState[]>();
  for (const state of states) {
    const id = testFileKeyOf(state.check);
    checks.set(id, [...(checks.get(id) ?? []), state]);
  }
  const unknown = keys.filter((row) => {
    const own = checks.get(testFileId(row.testFile)) ?? [];
    if ((row.key !== null && row.pending !== null) || own.some((s) => s.validity === "pending")) {
      return false;
    }
    return row.key === null || own.length === 0 || own.some((s) => s.validity === "unknown");
  });
  if (unknown.length === 0) return {};
  const recorded = readUnknownFiles(store, worktreeId);
  const files = unknown
    .sort((a, b) => testFileId(a.testFile).localeCompare(testFileId(b.testFile)))
    .slice(0, UNKNOWN_FILES_LISTED)
    .map((row): UnknownTestFile => {
      const id = testFileId(row.testFile);
      const entry = recorded.get(id);
      if (entry !== undefined && entry.key === row.key) {
        const { ran, reason, samples } = entry;
        return { testFile: row.testFile, ran, reason, samples };
      }
      const summary = checks.get(id)?.find((s) => s.validity === "unknown")?.summary ?? null;
      return { testFile: row.testFile, ran: false, reason: summary, samples: [] };
    });
  return { unknownTestFiles: { total: unknown.length, files } };
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
  const { project, path } = f.testFile;
  const name = project === "" ? path : `${project}: ${path}`;
  const what = f.ran ? "ran, nothing recorded" : "no result";
  const why = f.reason === null ? "no reason was kept" : cap(f.reason, SUMMARY_MAX_CHARS);
  const samples = f.samples.length === 0 ? "" : ` (paths: ${f.samples.join(", ")})`;
  return `${name}: ${what}: ${why}${samples}`;
}
