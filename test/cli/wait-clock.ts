/*
 * A wait measures `waitedMs` on `performance.now()` from its own start; a
 * timer counts whole milliseconds of libuv's loop clock from when it was set,
 * so it can fire up to a millisecond before its `ms` have passed on
 * `performance.now()` (task 001-334: 299.38 against a 300 ms timer). A test
 * holding a wait past a timer's work compares both ends on one clock.
 */

/** Runs `fn` after `ms`; `at` is when it returned, on `performance.now()`, and `Infinity` until then. */
export function later(ms: number, fn: () => void): { readonly at: number } {
  const ran = { at: Number.POSITIVE_INFINITY };
  setTimeout(() => {
    fn();
    ran.at = performance.now();
  }, ms);
  return ran;
}

/**
 * Runs `wait` and returns its result with `endedBy`, on `performance.now()`:
 * the call plus `waitedMs`, which the wait counts from a start after the call,
 * so the wait ended no earlier. Build its arguments before, outside the clock.
 */
export async function timed<T extends { readonly waitedMs: number }>(
  wait: () => Promise<T>,
): Promise<{ wait: T; endedBy: number }> {
  const called = performance.now();
  const ended = await wait();
  return { wait: ended, endedBy: called + ended.waitedMs };
}
