import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SerializedError, TestSpecification, Vitest } from "vitest/node";
import type {
  FileLevelError,
  RelativePath,
  RunEnd,
  RunOptions,
  RunReport,
  TestFileRef,
} from "../../core/types/index.js";
import { errorText, type RunCollector } from "./reporter.js";
import { compareRefs, refKey, toCheckError } from "./results.js";

/** After the first cancel, Vitest waits for running tests; a second cancel kills the workers. */
const GRACE_BEFORE_FORCE_MS = 1_000;
/** After the forced cancel, how long to wait before declaring the instance hung. */
const GRACE_AFTER_FORCE_MS = 5_000;

type CancelReason = Parameters<Vitest["cancelCurrentRun"]>[0];
const CANCEL_REASON = "squeal-timeout" as CancelReason;

export interface RunExecution {
  readonly end: RunEnd;
  readonly failure: string | null;
  /** The run did not settle even after a forced cancel. The instance must be dropped. */
  readonly hung: boolean;
}

/**
 * Runs specifications, honouring `timeoutMs`. Never rejects.
 *
 * On timeout: cancel, then cancel again to force-kill workers (a busy loop
 * ignores the first), then give up on the instance.
 */
export async function execute(
  vitest: Vitest,
  specs: readonly TestSpecification[],
  timeoutMs: number | null,
  collector: RunCollector,
): Promise<RunExecution> {
  const run = vitest.runTestSpecifications([...specs]).then(
    (): RunExecution => ({ end: "completed", failure: null, hung: false }),
    (error: unknown): RunExecution => ({
      end: "crashed",
      failure: describeError(error),
      hung: false,
    }),
  );
  if (timeoutMs === null) return run;

  const first = await settleWithin(run, timeoutMs);
  if (first) return first;
  collector.cancelRequested = true;
  const failure = `run exceeded timeoutMs (${timeoutMs} ms)`;
  vitest.cancelCurrentRun(CANCEL_REASON).catch(() => {});
  if (await settleWithin(run, GRACE_BEFORE_FORCE_MS))
    return { end: "timed-out", failure, hung: false };
  vitest.cancelCurrentRun(CANCEL_REASON).catch(() => {});
  if (await settleWithin(run, GRACE_AFTER_FORCE_MS))
    return { end: "timed-out", failure, hung: false };
  return { end: "timed-out", failure: `${failure}; workers did not stop`, hung: true };
}

async function settleWithin<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Builds the report from the collector only. A file counts as completed when
 * its module ended before any timeout cancel and in a final state; results
 * and errors of other files are dropped, because a cancelled test reports
 * `skipped`. A crashed run completes no file.
 */
export function buildReport(
  collector: RunCollector,
  execution: RunExecution,
  durationMs: number,
): RunReport {
  // Spec 001 D12: an unhandled error Vitest cannot attribute to a test file
  // makes the run untrusted, like a runner crash (review S7).
  const unattributed = collector.unhandledErrors.filter((e) => owner(e, collector) === null);
  const end: RunEnd = unattributed.length > 0 ? "crashed" : execution.end;
  const failure = [
    ...(execution.failure === null ? [] : [execution.failure]),
    ...unattributed.map((e) => `unhandled error outside any test file: ${errorText(e)}`),
  ].join("\n");

  // Nothing in a crashed run is trusted, so no file counts as completed.
  const completed =
    end === "crashed"
      ? []
      : [...collector.modules.values()]
          .filter((m) => !m.afterCancel && m.state !== "pending" && m.state !== "queued")
          .map((m) => m.ref)
          .sort(compareRefs);
  const completedKeys = new Set(completed.map(refKey));

  const errors = new Map<string, FileLevelError>();
  const addErrors = (ref: TestFileRef, list: FileLevelError["errors"]) => {
    if (list.length === 0) return;
    const existing = errors.get(refKey(ref))?.errors ?? [];
    errors.set(refKey(ref), { testFile: ref, errors: [...existing, ...list] });
  };
  for (const module of collector.modules.values()) {
    if (completedKeys.has(refKey(module.ref))) {
      addErrors(
        module.ref,
        module.errors.map((e) => toCheckError(e, collector.paths)),
      );
    }
  }
  // An unhandled error carrying `VITEST_TEST_PATH` belongs to that file.
  for (const error of collector.unhandledErrors) {
    const rel = owner(error, collector);
    const ref = completed.find((r) => r.path === rel);
    if (ref) addErrors(ref, [toCheckError(error, collector.paths)]);
  }

  return {
    end,
    durationMs,
    completedFiles: completed,
    results: collector.results
      .filter((r) => completedKeys.has(refKey(r.ref)))
      .sort((a, b) => compareRefs(a.ref, b.ref))
      .map((r) => r.result),
    fileErrors: [...errors.values()].sort((a, b) => compareRefs(a.testFile, b.testFile)),
    failure: failure === "" ? null : collector.paths.relativizeText(failure),
  };
}

/** The worktree-relative test file an unhandled error names, or `null`. */
function owner(error: SerializedError, collector: RunCollector): RelativePath | null {
  const path = typeof error.VITEST_TEST_PATH === "string" ? error.VITEST_TEST_PATH : null;
  return path === null ? null : collector.paths.toRelative(path);
}

/** Writes `vitest.log` (raw output, absolute paths kept) and `report.json` under `logDir`. */
export function writeRunLog(options: RunOptions, collector: RunCollector, report: RunReport): void {
  mkdirSync(options.logDir, { recursive: true });
  const header = [
    `squeal vitest run ${options.runId}`,
    `end: ${report.end}${report.failure ? ` (${report.failure})` : ""}, ${report.durationMs} ms`,
    "",
  ];
  writeFileSync(
    join(options.logDir, "vitest.log"),
    `${[...header, ...collector.log].join("\n")}\n`,
  );
  writeFileSync(
    join(options.logDir, "report.json"),
    `${JSON.stringify({ runId: options.runId, report }, null, 2)}\n`,
  );
}

function describeError(error: unknown): string {
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
}
