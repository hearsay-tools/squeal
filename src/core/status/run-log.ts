import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { consolePrefix, testFileLabel, VITEST_LOG } from "../run-log.js";
import type {
  AbsolutePath,
  CheckId,
  KnownState,
  WhyConsole,
  WhyResultEntry,
  WhyRunLog,
  WorktreeId,
} from "../types/index.js";

/** Most console lines `squeal why --include-logs` prints. */
export const WHY_LOG_LINE_LIMIT = 200;

/**
 * The stored result the known state shows, newest first among `results`:
 * this worktree's own, or for an inherited state the origin worktree's at
 * the origin commit, preferring one with the state's outcome. With no known
 * state, the newest result. `null` when none of `results` produced it.
 */
export function shownResult(
  worktreeId: WorktreeId,
  knownState: KnownState | null,
  results: readonly WhyResultEntry[],
): WhyResultEntry | null {
  if (knownState === null) return results[0] ?? null;
  const origin = knownState.origin;
  const producer = origin?.kind === "inherited" ? origin.worktreeId : worktreeId;
  const candidates = results.filter((e) => e.result.provenance.worktreeId === producer);
  const sameCommit = (e: WhyResultEntry) =>
    origin?.kind !== "inherited" || e.result.provenance.commit === origin.commit;
  const sameOutcome = (e: WhyResultEntry) => e.result.outcome === knownState.outcome;
  return (
    candidates.find((e) => sameCommit(e) && sameOutcome(e)) ??
    candidates.find(sameOutcome) ??
    candidates[0] ??
    null
  );
}

/**
 * The run log of `entry`'s run. `runsDir` names the directory when the run
 * record was pruned. With `includeLogs`, the log's console lines that the
 * reporter tagged with `check`'s test file.
 */
export function runLogOf(
  entry: WhyResultEntry,
  check: CheckId,
  runsDir: AbsolutePath,
  includeLogs: boolean,
): WhyRunLog {
  const { runId, worktreeId } = entry.result.provenance;
  const dir = entry.logDir ?? join(runsDir, runId);
  const path = join(dir, VITEST_LOG);
  const state = existsSync(path) ? "present" : existsSync(dir) ? "not-vitest" : "pruned";
  const text = includeLogs && state === "present" ? read(path) : null;
  if (includeLogs && state === "present" && text === null) {
    return { runId, worktreeId, path, state: "pruned", console: null };
  }
  return { runId, worktreeId, path, state, console: text === null ? null : consoleOf(text, check) };
}

/** The file's text, or `null` when it went between the check and the read (a prune). */
function read(path: AbsolutePath): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function consoleOf(text: string, check: CheckId): WhyConsole {
  const label = testFileLabel(check.project, check.testPath);
  const prefixes = ["stdout", "stderr"].map((type) => consolePrefix(type, label));
  const tagged = text
    .split("\n")
    .filter((line) => prefixes.some((prefix) => line.startsWith(prefix)));
  return {
    lines: tagged.slice(0, WHY_LOG_LINE_LIMIT),
    total: tagged.length,
    limit: WHY_LOG_LINE_LIMIT,
  };
}
