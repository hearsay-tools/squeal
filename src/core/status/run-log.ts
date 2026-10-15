import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { consolePrefix, parseConsoleLine, testFileLabel, VITEST_LOG } from "../run-log.js";
import type { AbsolutePath, CheckId, ResultRecord, WhyConsole, WhyRunLog } from "../types/index.js";

/** Most console lines `squeal why --include-logs` prints. */
export const WHY_LOG_LINE_LIMIT = 200;

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
