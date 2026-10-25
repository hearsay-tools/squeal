/**
 * Task 001-422: an `onBatch` failure `accepts` takes is retried as a
 * reconciliation pass of the batch's trigger, after `delayMs(0)`, then each
 * `delayMs(attempt)`, until a pass lands, fails otherwise (to `onError`) or
 * the feed closes. `ran` follows the retry that landed or failed otherwise.
 * Later batches wait behind it, as behind any batch.
 */
export interface BatchRetry {
  readonly accepts: (error: Error) => boolean;
  readonly delayMs: (attempt: number) => number;
  readonly ran: () => void;
}

/** One feed's retries of a failed batch; `close` ends a delay under way. */
export class BatchRetries {
  #wake: (() => void) | null = null;
  #closed = false;

  readonly #retry: BatchRetry | undefined;
  readonly #onError: (error: Error) => void;

  constructor(retry: BatchRetry | undefined, onError: (error: Error) => void) {
    this.#retry = retry;
    this.#onError = onError;
  }

  /**
   * `error` of a batch task: reported, or retried with `pass` while `retry`
   * accepts it. Resolves `null` once a retry landed, otherwise to the error
   * the task ended with: reported, or the last a close cut short (row
   * 011-198 R1).
   */
  async failed(error: Error, pass?: () => Promise<void>): Promise<Error | null> {
    const retry = this.#retry;
    if (pass === undefined || retry === undefined || !retry.accepts(error)) {
      this.#onError(error);
      return error;
    }
    let last = error;
    for (let attempt = 0; ; attempt++) {
      await this.#pause(retry.delayMs(attempt));
      if (this.#closed) return last;
      try {
        await pass();
        retry.ran();
        return null;
      } catch (again) {
        last = toError(again);
        if (retry.accepts(last)) continue;
        retry.ran();
        this.#onError(last);
        return last;
      }
    }
  }

  close(): void {
    this.#closed = true;
    this.#wake?.();
  }

  /** Waits `ms`, or until `close`. */
  #pause(ms: number): Promise<void> {
    if (ms <= 0 || this.#closed) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(() => this.#wake?.(), ms);
      this.#wake = () => {
        clearTimeout(timer);
        this.#wake = null;
        resolve();
      };
    });
  }
}

export function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
