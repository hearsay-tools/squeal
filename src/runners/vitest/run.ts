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
const TIMEOUT_REASON = "squeal-timeout" as CancelReason;
const CANCEL_REASON = "squeal-cancel" as CancelReason;
/** `RunReport.failure` of a run the scheduler cancelled: some files did not complete. */
export const CANCELLED = "run cancelled: an edit arrived during a backlog tier";

export interface RunExecution {
  readonly end: RunEnd;
  readonly failure: string | null;
  /** The run did not settle even after a forced cancel. The instance must be dropped. */
  readonly hung: boolean;
}

/**
 * Runs specifications, honouring `timeoutMs` and `signal`. Never rejects.
 *
 * On timeout or abort: cancel, then cancel again to force-kill workers (a
 * busy loop ignores the first), then give up on the instance. A timeout ends
 * the run `timed-out`; an abort (task 001-124) keeps the run's own end with
 * `CANCELLED` as its failure, and the scheduler queues the files that did
 * not complete again.
 */
export async function execute(
  vitest: Vitest,
  specs: readonly TestSpecification[],
  timeoutMs: number | null,
  collector: RunCollector,
  signal?: AbortSignal,
): Promise<RunExecution> {
  if (signal?.aborted) return { end: "completed", failure: CANCELLED, hung: false };
  const run = vitest.runTestSpecifications([...specs]).then(
    (): RunExecution => ({ end: "completed", failure: null, hung: false }),
    (error: unknown): RunExecution => ({
      end: "crashed",
      failure: describeError(error),
      hung: false,
    }),
  );
  if (timeoutMs === null && signal === undefined) return run;
  const first = await settleOrStop(run, timeoutMs, signal);
  if (first !== "timeout" && first !== "abort") return first;
  collector.cancelRequested = true;
  const timedOut = first === "timeout";
  const reason = timedOut ? TIMEOUT_REASON : CANCEL_REASON;
  const failure = timedOut ? `run exceeded timeoutMs (${timeoutMs} ms)` : CANCELLED;
  // A cancelled run that crashed meanwhile stays crashed: nothing in it is trusted (D12).
  const stopped = (execution: RunExecution): RunExecution =>
    timedOut
      ? { end: "timed-out", failure, hung: false }
      : { ...execution, failure: execution.failure ?? failure };
  cancel(vitest, collector, reason);
  const graceful = await settleWithin(run, GRACE_BEFORE_FORCE_MS);
  if (graceful) return stopped(graceful);
  cancel(vitest, collector, reason);
  const forced = await settleWithin(run, GRACE_AFTER_FORCE_MS);
  if (forced) return stopped(forced);
  return {
    end: timedOut ? "timed-out" : "completed",
    failure: `${failure}; workers did not stop`,
    hung: true,
  };
}

/** The run's own execution when it settles first; else why it must stop. */
async function settleOrStop(
  run: Promise<RunExecution>,
  timeoutMs: number | null,
  signal: AbortSignal | undefined,
): Promise<RunExecution | "timeout" | "abort"> {
  let timer: NodeJS.Timeout | undefined;
  let onAbort: (() => void) | undefined;
  const stop = new Promise<"timeout" | "abort">((resolve) => {
    if (timeoutMs !== null) timer = setTimeout(() => resolve("timeout"), timeoutMs);
    onAbort = () => resolve("abort");
    signal?.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([run, stop]);
  } finally {
    clearTimeout(timer);
    if (onAbort) signal?.removeEventListener("abort", onAbort);
  }
}

function cancel(vitest: Vitest, collector: RunCollector, reason: CancelReason): void {
  vitest
    .cancelCurrentRun(reason)
    .catch((error: unknown) => collector.note(`cancelCurrentRun failed: ${describeError(error)}`));
}

/**
 * Closes an instance whose workers ignored cancellation, without waiting:
 * the close may hang too. A failure goes to the run log.
 */
export function abandon(vitest: Vitest, collector: RunCollector): void {
  vitest
    .close()
    .catch((error: unknown) =>
      collector.note(`close() of an abandoned instance failed: ${describeError(error)}`),
    );
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
    // Every project that ran the file: the error carries no project name.
    for (const ref of completed.filter((r) => r.path === rel)) {
      addErrors(ref, [toCheckError(error, collector.paths)]);
    }
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
    fileDurations: [...collector.modules.values()]
      .filter((m) => completedKeys.has(refKey(m.ref)) && m.durationMs !== null)
      .sort((a, b) => compareRefs(a.ref, b.ref))
      .map((m) => ({ testFile: m.ref, durationMs: m.durationMs ?? 0 })),
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
  const logFile = join(options.logDir, "vitest.log");
  writeFileSync(logFile, `${[...header, ...collector.log].join("\n")}\n`);
  collector.logFile = logFile;
  writeFileSync(
    join(options.logDir, "report.json"),
    `${JSON.stringify({ runId: options.runId, report }, null, 2)}\n`,
  );
}

function describeError(error: unknown): string {
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
}
