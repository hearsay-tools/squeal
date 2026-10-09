/** A call inside a lane of `Gate`. */
export interface Hold {
  /**
   * Leaves the lane's hold, runs `fn` alone (`Gate.exclusive`), then takes
   * the hold again. Leaving first means two lanes asking at once queue
   * instead of each waiting for the other.
   */
  exclusive<T>(fn: () => Promise<T>): Promise<T>;
}

/**
 * Task 001-150 (spec 001 D5 as amended): what the Vitest adapter excludes.
 * Two lanes, each one call at a time: `run` for runs, `part` for the runner
 * part (`invalidate`, `affected`, `closure`, `enumerate`, `testFiles`,
 * `environment`). A call of one lane overlaps a call of the other. An
 * `exclusive` section (a start, a recreate, a close, dropping a broken or
 * hung instance) waits until no lane is inside a call and holds both lanes
 * until it returns; sections queue in the order asked.
 */
export class Gate {
  #runs: Promise<unknown> = Promise.resolve();
  #part: Promise<unknown> = Promise.resolve();
  /** Calls inside a lane, outside any `exclusive`. */
  #holders = 0;
  #idle: (() => void)[] = [];
  /** Sections asked and not yet returned; while any, no call enters a lane. */
  #sections = 0;
  #clear: Promise<void> = Promise.resolve();
  #cleared = () => {};
  #turn: Promise<void> = Promise.resolve();

  run<T>(fn: (hold: Hold) => Promise<T>): Promise<T> {
    const next = this.#runs.then(() => this.#hold(fn));
    this.#runs = next.catch(() => {});
    return next;
  }

  part<T>(fn: (hold: Hold) => Promise<T>): Promise<T> {
    const next = this.#part.then(() => this.#hold(fn));
    this.#part = next.catch(() => {});
    return next;
  }

  async exclusive<T>(fn: () => Promise<T>): Promise<T> {
    if (this.#sections++ === 0) {
      this.#clear = new Promise((resolve) => {
        this.#cleared = resolve;
      });
    }
    const turn = this.#turn;
    let done = () => {};
    this.#turn = new Promise((resolve) => {
      done = resolve;
    });
    try {
      await turn;
      while (this.#holders > 0) await new Promise<void>((resolve) => this.#idle.push(resolve));
      return await fn();
    } finally {
      done();
      if (--this.#sections === 0) this.#cleared();
    }
  }

  async #hold<T>(fn: (hold: Hold) => Promise<T>): Promise<T> {
    await this.#enter();
    const hold: Hold = {
      exclusive: async (section) => {
        this.#leave();
        try {
          return await this.exclusive(section);
        } finally {
          await this.#enter();
        }
      },
    };
    try {
      return await fn(hold);
    } finally {
      this.#leave();
    }
  }

  async #enter(): Promise<void> {
    while (this.#sections > 0) await this.#clear;
    this.#holders++;
  }

  #leave(): void {
    if (--this.#holders > 0) return;
    for (const resolve of this.#idle.splice(0)) resolve();
  }
}
