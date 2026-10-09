import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { consolePrefix, parseConsoleLine, testFileLabel, VITEST_LOG } from "../run-log.js";
import type {
  AbsolutePath,
  CheckId,
  CheckKey,
  EpochMs,
  KnownState,
  ResultRecord,
  WhyConsole,
  WhyRunLog,
  WorktreeId,
} from "../types/index.js";

/** Most console lines `squeal why --include-logs` prints. */
export const WHY_LOG_LINE_LIMIT = 200;

/**
 * The stored result the known state shows, from all of the check's
 * `results` (review wave-13i B4). A current state was derived from the row
 * at its test file's current `key`: that row, if it is still the result the
 * state names. Otherwise the only row the state names: same outcome and
 * commit, from the producing worktree, and for an own result at the
 * revision it was observed at. `null` when no stored row is identifiably it:
 * replaced, pruned, or several keys fit. Never a nearby run. With no known
 * state, the held failure `why` shows.
 *
 * An inherited state names a row only when the row provably predates it
 * (review wave-13j B4): recorded no later than `observedSince`, the time the
 * revision the state was observed at was created. The state was applied at
 * or after that time from the row then at the key, and a row replaced later
 * is recorded later. A same-key replacement by a later run, at any commit or
 * revision, names none. An own state is re-derived from each of its own runs.
 */
export function shownResult(
  worktreeId: WorktreeId,
  knownState: KnownState | null,
  key: CheckKey | null,
  results: readonly ResultRecord[],
  held: ResultRecord | undefined,
  observedSince: EpochMs | null,
): ResultRecord | null {
  if (knownState === null) return held ?? null;
  const origin = knownState.origin;
  if (origin === null) return null;
  const names = (r: ResultRecord) =>
    r.outcome === knownState.outcome &&
    r.provenance.commit === knownState.commit &&
    (origin.kind === "inherited"
      ? r.provenance.worktreeId === origin.worktreeId &&
        observedSince !== null &&
        r.provenance.recordedAt <= observedSince
      : r.provenance.worktreeId === worktreeId && r.provenance.revision === knownState.observedAt);
  if (knownState.validity === "current" && key !== null) {
    const atKey = results.find((r) => r.key === key);
    return atKey !== undefined && names(atKey) ? atKey : null;
  }
  const named = results.filter(names);
  return named.length === 1 ? (named[0] ?? null) : null;
}

/**
 * The run log of `result`'s run, its directory `logDir`, or under `runsDir`
 * when the run record was pruned. A node:test file's run keeps its own
 * stdout and stderr logs (task 001-188); otherwise the run's `vitest.log`.
 * With `includeLogs`, the console lines of `check`'s test file.
 */
export function runLogOf(
  result: ResultRecord,
  logDir: AbsolutePath | null,
  check: CheckId,
  runsDir: AbsolutePath,
  includeLogs: boolean,
): WhyRunLog {
  const { runId, worktreeId } = result.provenance;
  const dir = logDir ?? join(runsDir, runId);
  const nodeTest = nodeTestLogs(dir, check);
  if (nodeTest !== null) {
    const base = { runId, worktreeId, path: nodeTest.stdout, stderrPath: nodeTest.stderr };
    if (!existsSync(nodeTest.stdout) && !existsSync(nodeTest.stderr)) {
      return { ...base, state: "pruned", console: null };
    }
    if (!includeLogs) return { ...base, state: "node-test", console: null };
    const stdout = read(nodeTest.stdout);
    const stderr = read(nodeTest.stderr);
    const label = testFileLabel(check.project, check.testPath);
    const lines = [
      ...linesOf(stdout).map((line) => `${consolePrefix("stdout", label)}${line}`),
      ...linesOf(stderr).map((line) => `${consolePrefix("stderr", label)}${line}`),
    ];
    return { ...base, state: "node-test", console: capped(lines) };
  }
  const path = join(dir, VITEST_LOG);
  const state = existsSync(path) ? "present" : existsSync(dir) ? "not-vitest" : "pruned";
  const text = includeLogs && state === "present" ? read(path) : null;
  if (includeLogs && state === "present" && text === null) {
    return { runId, worktreeId, path, state: "pruned", console: null };
  }
  // A run with no log of the file captured none of its console: said, not left out (task 001-188).
  const none = includeLogs && state === "not-vitest" ? capped([]) : null;
  return { runId, worktreeId, path, state, console: text === null ? none : consoleOf(text, check) };
}

/**
 * A node:test run writes `node-test/<project>/run.json`, listing its files
 * in order, beside `stdout-<i>.log` and `stderr-<i>.log` of the `i`th
 * (`src/runners/node-test/run/run.ts`). `null` when the run holds no
 * node:test log of `check`'s file.
 */
function nodeTestLogs(dir: AbsolutePath, check: CheckId) {
  const project = join(dir, "node-test", encodeURIComponent(check.project));
  const text = read(join(project, "run.json"));
  if (text === null) return null;
  let files: unknown;
  try {
    files = (JSON.parse(text) as { files?: unknown }).files;
  } catch {
    return null;
  }
  if (!Array.isArray(files)) return null;
  const index = files.findIndex(
    (f) => (f as { testFile?: unknown } | null)?.testFile === check.testPath,
  );
  if (index < 0) return null;
  return {
    stdout: join(project, `stdout-${index}.log`),
    stderr: join(project, `stderr-${index}.log`),
  };
}

/** The file's text, or `null` when it is gone (a prune, or a run that never wrote it). */
function read(path: AbsolutePath): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function linesOf(text: string | null): string[] {
  if (text === null || text === "") return [];
  return text.replace(/\n$/, "").split("\n");
}

/** The lines the reporter tagged with exactly `check`'s test file (review wave-13i S2). */
function consoleOf(text: string, check: CheckId): WhyConsole {
  const label = testFileLabel(check.project, check.testPath);
  return capped(text.split("\n").filter((line) => parseConsoleLine(line)?.label === label));
}

function capped(lines: readonly string[]): WhyConsole {
  return {
    lines: lines.slice(0, WHY_LOG_LINE_LIMIT),
    total: lines.length,
    limit: WHY_LOG_LINE_LIMIT,
  };
}
