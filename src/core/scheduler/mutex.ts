import type { LockHolder } from "../types/index.js";

type Watcher = {
  readonly listener: (holder: LockHolder | null) => void;
  readonly failed: (error: unknown) => void;
};

/**
 * Runs tasks one at a time, in call order. A failed task rejects its own
 * caller and does not stop the tasks after it.
 *
 * Row 011-302: it keeps what the current task does and since when, which
 * only a watcher hears of. A holder is set when its task starts and cleared
 * when it settles, in the reactions the lock already had, so the order of
 * tasks and of their callers is the same with or without a watcher.
 */
export class Mutex {
  #tail: Promise<unknown> = Promise.resolve();
  #holder: LockHolder | null = null;
  readonly #watchers = new Set<Watcher>();
  readonly #now: () => number;
  readonly #free = () => this.#hold(null);

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  /** `task` once the tasks before it settled; `operation` says what it does, for a watcher. */
  run<T>(task: () => T | Promise<T>, operation: string | null = null): Promise<T> {
    const next = this.#tail.then(() => {
      // Kept with no watcher too: a request that starts watching mid-task hears this holder.
      this.#hold({ operation, since: this.#now() });
      return task();
    });
    this.#tail = next.then(this.#free, this.#free);
    return next;
  }

  /**
   * Tells `listener` the holder at once, then at each change, until the
   * returned function is called. A listener that throws is dropped and its
   * error goes to `failed`; the lock runs on.
   */
  watch(
    listener: (holder: LockHolder | null) => void,
    failed: (error: unknown) => void = () => {},
  ): () => void {
    const watcher = { listener, failed };
    this.#watchers.add(watcher);
    this.#tell(watcher, this.#holder);
    return () => void this.#watchers.delete(watcher);
  }

  #hold(holder: LockHolder | null): void {
    if (holder === null && this.#holder === null) return;
    this.#holder = holder;
    for (const watcher of this.#watchers) this.#tell(watcher, holder);
  }

  #tell(watcher: Watcher, holder: LockHolder | null): void {
    try {
      watcher.listener(holder);
    } catch (error) {
      this.#watchers.delete(watcher);
      watcher.failed(error);
    }
  }
}
