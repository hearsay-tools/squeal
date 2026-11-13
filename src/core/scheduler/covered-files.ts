import { type CoveredFile, writeCoveredFiles } from "../store/covered-files.js";
import type { SchedulerContext } from "./context.js";
import { classify, type FileState } from "./files.js";
import type { Ledger } from "./ledger.js";

/*
 * Row 011-325 (GLOSSARY "Covered files"): how the request intake records
 * a request's covered files, as the scheduler decided them when it took
 * the request. The state of each is read from the ledger once the
 * request's stage queued its files, inside its transaction: queued (or
 * found queued or running), already current, or not queued with the
 * reason. The reasons are the narrow run's (review 0.1.411, B2), so a
 * narrow run's answer and its record say the same.
 */

/**
 * `file` as a request covers it; `waiting` is why nothing was queued (an
 * install awaited, a reinstall), else `null`. While the daemon waits for
 * an install, a queued file does not run either. A blocked file's reason
 * is the first line of its runner's message.
 */
export function coveredOf(file: FileState, waiting: string | null): CoveredFile {
  const testFile = file.ref;
  if (classify(file) === "current") return { testFile, state: "current" };
  if (waiting === null && file.phase !== null) return { testFile, state: "queued" };
  const reason =
    waiting ??
    (file.blocked !== null
      ? `its runner failed: ${file.blocked.split("\n")[0]}`
      : file.key === null
        ? "Squeal cannot key it"
        : "it has no result at its key and was not queued");
  return { testFile, state: "not-queued", reason };
}

/**
 * Writes request `id`'s covered `files` in the transaction the caller
 * holds, after its stage, each decided by `coveredOf` (`waiting`: an
 * install-wait answer's reason). A file named twice is recorded once. The
 * worktree's older records are pruned by the ledger's queued and running
 * files (`writeCoveredFiles`).
 */
export function recordCovered(
  context: SchedulerContext,
  ledger: Ledger,
  id: string,
  files: readonly FileState[],
  waiting: string | null,
): void {
  const unique = [...new Map(files.map((file) => [file.id, file])).values()];
  writeCoveredFiles(
    context.store,
    {
      id,
      worktreeId: context.worktreeId,
      revision: ledger.revision.number,
      recordedAt: context.now(),
      files: unique.map((file) => coveredOf(file, waiting)),
    },
    (ref) => (ledger.file(ref)?.phase ?? null) !== null,
  );
}
