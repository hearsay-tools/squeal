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
  /** The end of each started file not yet ended or named, and the file's key. */
  readonly #open = new Map<() => void, string>();
  #closed = false;

  constructor(options: ProgressOptions) {
    this.#options = options;
  }

  /**
   * For `runner`'s adapter: `ref` started. What it returns ends it, so it
   * is not named after; a second call does nothing. A run that ends ends
   * its files with it (`runEnded`), and the end of the runs ends them all
   * (`close`).
   */
  started(runner: TestFileEvidence["runner"], ref: TestFileRef): () => void {
    const key = keyOf(runner, ref);
    this.#started.add(key);
    const { overran, durations, budgetSeconds, since } = this.#options;
    if (this.#closed || overran === undefined) return () => {};
    const storedSeconds = durations?.(ref) ?? null;
    const limit = Math.max(storedSeconds ?? 0, overrunFloor(budgetSeconds));
    const at = performance.now();
    const end = () => {
      clearTimeout(timer);
      this.#open.delete(end);
    };
    const timer = setTimeout(() => {
      this.#open.delete(end);
      const now = performance.now();
      // Node may fire the timer a fraction of a millisecond before
      // `performance.now()` reaches the limit (CI run 43349478847): it
      // fired because the limit passed, so it never reads under it.
      const seconds = Math.max(Math.floor(limit), Math.floor((now - at) / 1000));
      // The file started inside the budget, so the budget used is never less
      // than its own seconds (row 020-47, review 0.1.464-r3 S1).
      const usedSeconds = Math.max(seconds, Math.floor((now - since) / 1000));
      overran({ runner, path: ref.path, seconds, storedSeconds, usedSeconds, budgetSeconds });
    }, limit * 1000);
    timer.unref();
    this.#open.set(end, key);
    return end;
  }

  /**
   * `runner`'s run of `refs` ended, in any way: each of them not yet ended
   * ends now. A Vitest worker that dies leaves its file with no module end
   * while the other runners' runs go on (review 0.1.464 B1); their files
   * stay open. `wasStarted` still tells these files.
   */
  runEnded(runner: TestFileEvidence["runner"], refs: readonly TestFileRef[]): void {
    const keys = new Set(refs.map((ref) => keyOf(runner, ref)));
    for (const [end, key] of [...this.#open]) if (keys.has(key)) end();
  }

  /** Whether `runner` told `ref` started. */
  wasStarted(runner: TestFileEvidence["runner"], ref: TestFileRef): boolean {
    return this.#started.has(keyOf(runner, ref));
  }

  /** The runs ended: no file is named from here on. */
  close(): void {
    this.#closed = true;
    for (const end of [...this.#open.keys()]) end();
  }
}

const keyOf = (runner: TestFileEvidence["runner"], ref: TestFileRef) =>
  `${runner}\u0000${testFileId(ref)}`;
