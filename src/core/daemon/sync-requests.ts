/**
 * The daemon's sync requests in flight, by the socket's request id (review
 * wave-13r B2, task 001-226). The socket remembers 32 and tells the main
 * thread which it drops (`forgetSync`); a forget aborts that request's
 * signal, and its answer releases what it holds at once, even while the
 * runner part it waits for is stalled.
 */
export class SyncRequests {
  readonly #live = new Map<string, AbortController>();

  /** In flight now. */
  get size(): number {
    return this.#live.size;
  }

  /** Runs `answer` with a signal that `forget(id)` aborts until it settles. */
  async run<T>(id: string, answer: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    this.#live.set(id, controller);
    try {
      return await answer(controller.signal);
    } finally {
      if (this.#live.get(id) === controller) this.#live.delete(id);
    }
  }

  /** Aborts `id`'s answer; an unknown id, or one settled or forgotten already, is nothing. */
  forget(id: string): void {
    this.#live.get(id)?.abort();
    this.#live.delete(id);
  }
}
