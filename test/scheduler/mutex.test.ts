import { describe, expect, it } from "vitest";
import { Mutex } from "../../src/core/scheduler/mutex.js";
import type { LockHolder } from "../../src/core/types/scheduler.js";

/*
 * Row 011-302 (gh-154): the scheduler's lock keeps what its current task
 * does and since when, so a group request waiting for it can say what
 * holds it. Only a watcher hears of it; the order of tasks and of their
 * callers is the one the lock had before.
 */

/** The lock before row 011-302, as `mutex.ts` had it: the reference order. */
class PlainMutex {
  #tail: Promise<unknown> = Promise.resolve();
  run<T>(task: () => T | Promise<T>): Promise<T> {
    const next = this.#tail.then(task);
    this.#tail = next.catch(() => {});
    return next;
  }
}

/** Three tasks, sync, async and failing, their callers and outside microtasks, as one log. */
async function interleaving(lock: { run<T>(task: () => T | Promise<T>): Promise<T> }) {
  const log: string[] = [];
  const tick = (n: number): Promise<void> =>
    n === 0 ? Promise.resolve() : Promise.resolve().then(() => tick(n - 1));
  const a = lock.run(() => log.push("a")).then(() => log.push("after a"));
  const b = lock
    .run(async () => {
      log.push("b starts");
      await tick(2);
      log.push("b ends");
    })
    .then(() => log.push("after b"));
  const c = lock
    .run(() => {
      log.push("c");
      throw new Error("c failed");
    })
    .catch(() => log.push("after c"));
  const d = lock.run(() => log.push("d")).then(() => log.push("after d"));
  for (let i = 0; i < 12; i++) {
    await Promise.resolve();
    log.push(`tick ${i}`);
  }
  await Promise.all([a, b, c, d]);
  return log;
}

describe("the scheduler's lock (row 011-302)", () => {
  it("runs tasks and resumes their callers in the order the plain lock did", async () => {
    const plain = await interleaving(new PlainMutex());
    expect(await interleaving(new Mutex())).toEqual(plain);
    const watched = new Mutex();
    const heard: (LockHolder | null)[] = [];
    watched.watch((holder) => heard.push(holder));
    expect(await interleaving(watched)).toEqual(plain);
    expect(heard.length).toBeGreaterThan(1);
  });

  it("tells a watcher at once, then each holder with its operation and start, and null between", async () => {
    let now = 1_000;
    const lock = new Mutex(() => now);
    const heard: (LockHolder | null)[] = [];
    const stop = lock.watch((holder) => heard.push(holder));
    expect(heard).toEqual([null]);
    let release = () => {};
    const first = lock.run(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
      "applying revision 412",
    );
    const second = lock.run(() => "done");
    await Promise.resolve();
    expect(heard).toEqual([null, { operation: "applying revision 412", since: 1_000 }]);
    now = 49_000;
    release();
    await first;
    expect(await second).toBe("done");
    expect(heard).toEqual([
      null,
      { operation: "applying revision 412", since: 1_000 },
      null,
      { operation: null, since: 49_000 },
      null,
    ]);
    stop();
    await lock.run(() => {}, "after the watch");
    expect(heard).toHaveLength(5);
  });

  it("drops a watcher that throws, hands its error over, and runs the task", async () => {
    const lock = new Mutex();
    const errors: unknown[] = [];
    const broken = new Error("cannot post");
    lock.watch(
      (holder) => {
        if (holder !== null) throw broken;
      },
      (error) => errors.push(error),
    );
    expect(await lock.run(() => "ran", "a task")).toBe("ran");
    expect(await lock.run(() => "ran again")).toBe("ran again");
    expect(errors).toEqual([broken]);
  });
});
