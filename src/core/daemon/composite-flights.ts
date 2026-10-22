import type { RunnerAdapter, RunOptions, RunReport, TestFileRef } from "../types/index.js";

/**
 * The parts in flight of each member, and the members a reload retired
 * (row 011-78). A removed member's parts stop on its own signal, joined to
 * the run's `stop`, so its node:test or pytest processes end as at a
 * `squeal stop` (C9); a retired member closes once its last part ends.
 */
export class Flights {
  readonly #running = new Map<RunnerAdapter, Set<AbortController>>();
  readonly #removed = new WeakSet<RunnerAdapter>();
  /** Every member a reload retired, removed or replaced: none starts a part again. */
  readonly #left = new WeakSet<RunnerAdapter>();
  /** Retired members not closed yet: each waits for its parts in flight. */
  readonly #retired = new Set<RunnerAdapter>();
  readonly #closing: Promise<void>[] = [];

  removed(adapter: RunnerAdapter): boolean {
    return this.#removed.has(adapter);
  }

  left(adapter: RunnerAdapter): boolean {
    return this.#left.has(adapter);
  }

  stop(adapter: RunnerAdapter): void {
    this.#removed.add(adapter);
    for (const controller of this.#running.get(adapter) ?? []) controller.abort("stop");
  }

  retire(adapter: RunnerAdapter): void {
    this.#left.add(adapter);
    this.#retired.add(adapter);
    if (!this.#running.has(adapter)) this.#closeRetired(adapter);
  }

  async run(
    adapter: RunnerAdapter,
    testFiles: readonly TestFileRef[],
    options: RunOptions,
  ): Promise<RunReport> {
    const controller = new AbortController();
    const running = this.#running.get(adapter) ?? new Set();
    this.#running.set(adapter, running.add(controller));
    const stop =
      options.stop === undefined
        ? controller.signal
        : AbortSignal.any([options.stop, controller.signal]);
    try {
      const report = await runPart(adapter, testFiles, { ...options, stop });
      return this.removed(adapter) ? withheld(testFiles, report.durationMs) : report;
    } finally {
      running.delete(controller);
      if (running.size === 0) {
        this.#running.delete(adapter);
        if (this.#retired.has(adapter)) this.#closeRetired(adapter);
      }
    }
  }

  /** Closes the retired members still running, and waits for every retired close. */
  async close(): Promise<void> {
    for (const adapter of this.#retired) this.#closeRetired(adapter);
    await Promise.all(this.#closing);
  }

  #closeRetired(adapter: RunnerAdapter): void {
    this.#retired.delete(adapter);
    // A leaver's close has nothing left to undo for the daemon, so a failure of it is dropped.
    this.#closing.push(adapter.close().catch(() => {}));
  }
}

/**
 * The report of a removed project's part (011 C10): nothing it ran is
 * stored. Its files are withheld, so a file the ledger still holds queues
 * again until the reload's listing forgets it, and one already forgotten
 * is `gone`.
 */
export function withheld(testFiles: readonly TestFileRef[], durationMs: number): RunReport {
  return {
    end: "completed",
    durationMs,
    completedFiles: [],
    results: [],
    fileErrors: [],
    failure: null,
    withheld: testFiles,
  };
}

/** One adapter's part of a run. A rejection is a crash of that part only (001 D12). */
async function runPart(
  adapter: RunnerAdapter,
  testFiles: readonly TestFileRef[],
  options: RunOptions,
): Promise<RunReport> {
  const started = Date.now();
  try {
    return await adapter.run(testFiles, options);
  } catch (error) {
    return {
      end: "crashed",
      durationMs: Date.now() - started,
      completedFiles: [],
      results: [],
      fileErrors: [],
      failure: error instanceof Error ? error.message : String(error),
    };
  }
}
