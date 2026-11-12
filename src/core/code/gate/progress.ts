import { testFileId } from "../../keys/reverse-index.js";
import type { RelativePath } from "../../types/common.js";
import type { TestFileRef } from "../../types/keys.js";
import type { TestFileEvidence } from "./types.js";

/*
 * Spec 020 row 020-43 (#196): which selected files started, and each file
 * that runs past its estimate, named once while the gate runs. The runners
 * tell each file's start and end (`fileStarted` of the gate's adapters):
 * Vitest as a worker starts to collect it (`onTestModuleQueued`), node:test
 * as its process starts. Before, the gate wrote nothing between its first
 * lines and its report, and a file that held the budget had no name.
 */

/** A file that ran past its estimate and still runs, told once (row 020-43). */
export interface Overrun {
  readonly runner: TestFileEvidence["runner"];
  readonly path: RelativePath;
  /** Whole seconds it has run. */
  readonly seconds: number;
  /** Its stored seconds, the estimate it ran past; `null` when the stores hold none. */
  readonly storedSeconds: number | null;
  /** Whole seconds of the budget used so far. */
  readonly usedSeconds: number;
  readonly budgetSeconds: number;
}

/**
 * The least time a file runs before it is named, whatever its estimate: 10
 * s, or a twentieth of the budget when that is more (30 s of 600). A file of
 * a few seconds that runs a little over its stored time holds no budget
 * worth a line.
 */
export function overrunFloor(budgetSeconds: number): number {
  return Math.max(10, budgetSeconds / 20);
}

export interface ProgressOptions {
  readonly budgetSeconds: number;
  /** `performance.now()` when the budget started. */
  readonly since: number;
  /** A file's stored seconds, `null` when none is stored; absent when there is no store. */
  readonly durations?: ((ref: TestFileRef) => number | null) | undefined;
  /** Told each file that runs past its estimate, once; absent, none is told. */
  readonly overran?: ((file: Overrun) => void) | undefined;
}

/**
 * The gate's files as they start and end. A file is named once when it
 * has run past its estimate, its stored seconds, and past `overrunFloor`;
 * with no stored seconds, past the floor alone.
 */
export class FileProgress {
  readonly #options: ProgressOptions;
  readonly #started = new Set<string>();
  readonly #timers = new Set<NodeJS.Timeout>();
  #closed = false;

  constructor(options: ProgressOptions) {
    this.#options = options;
  }

  /**
   * For `runner`'s adapter: `ref` started. What it returns ends it, so it
   * is not named after; a run that ends ends its files with it (`close`).
   */
  started(runner: TestFileEvidence["runner"], ref: TestFileRef): () => void {
    this.#started.add(keyOf(runner, ref));
    const { overran, durations, budgetSeconds, since } = this.#options;
    if (this.#closed || overran === undefined) return () => {};
    const storedSeconds = durations?.(ref) ?? null;
    const limit = Math.max(storedSeconds ?? 0, overrunFloor(budgetSeconds));
    const at = performance.now();
    const timer = setTimeout(() => {
      this.#timers.delete(timer);
      const now = performance.now();
      const seconds = Math.floor((now - at) / 1000);
      const usedSeconds = Math.floor((now - since) / 1000);
      overran({ runner, path: ref.path, seconds, storedSeconds, usedSeconds, budgetSeconds });
    }, limit * 1000);
    timer.unref();
    this.#timers.add(timer);
    return () => {
      clearTimeout(timer);
      this.#timers.delete(timer);
    };
  }

  /** Whether `runner` told `ref` started. */
  wasStarted(runner: TestFileEvidence["runner"], ref: TestFileRef): boolean {
    return this.#started.has(keyOf(runner, ref));
  }

  /** The runs ended: no file is named from here on. */
  close(): void {
    this.#closed = true;
    for (const timer of this.#timers) clearTimeout(timer);
    this.#timers.clear();
  }
}

const keyOf = (runner: TestFileEvidence["runner"], ref: TestFileRef) =>
  `${runner}\u0000${testFileId(ref)}`;
