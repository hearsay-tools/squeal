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

  /** `error` of a batch task: reported, or retried with `pass` while `retry` accepts it. */
  async failed(error: Error, pass?: () => Promise<void>): Promise<void> {
    const retry = this.#retry;
    if (pass === undefined || retry === undefined || !retry.accepts(error)) {
      this.#onError(error);
      return;
    }
    for (let attempt = 0; ; attempt++) {
      await this.#pause(retry.delayMs(attempt));
      if (this.#closed) return;
      try {
        await pass();
        retry.ran();
        return;
      } catch (again) {
        const failure = toError(again);
        if (retry.accepts(failure)) continue;
        retry.ran();
        this.#onError(failure);
        return;
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
