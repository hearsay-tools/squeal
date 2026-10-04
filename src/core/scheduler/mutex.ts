/**
 * Runs tasks one at a time, in call order. A failed task rejects its own
 * caller and does not stop the tasks after it.
 */
export class Mutex {
  #tail: Promise<unknown> = Promise.resolve();

  run<T>(task: () => T | Promise<T>): Promise<T> {
    const next = this.#tail.then(task);
    this.#tail = next.catch(() => {});
    return next;
  }
}
