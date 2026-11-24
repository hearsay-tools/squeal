import { afterEach } from "vitest";

/*
 * Review 0.1.629 B3: a helper that calls `afterEach` when its module is
 * evaluated registers it on the first test file that imports it. The `unit`
 * project keeps modules from one file to the next (`isolate: false`), so a
 * later file that imports the same helper gets no hook, and its cleanups
 * wait for the next file that has one. A helper defers its cleanups here
 * instead. This file is the `unit` project's setup file, which Vitest
 * evaluates again before each test file, so every file drains them after
 * each test. In the other projects each file evaluates this module fresh
 * through the helper that imports it, which registers the same hook.
 *
 * The cleanups live on `globalThis`: a helper kept from an earlier file and
 * the setup file evaluated for this one must share one list. This module
 * imports nothing from `src/`, so the setup file keys no test by product code.
 */

const KEY = Symbol.for("squeal.test.cleanups");

function cleanups(): (() => void)[] {
  const global = globalThis as { [KEY]?: (() => void)[] };
  global[KEY] ??= [];
  return global[KEY];
}

/** Runs `cleanup` after the current test, after the ones deferred later. */
export function deferCleanup(cleanup: () => void): void {
  cleanups().push(cleanup);
}

/** Runs every deferred cleanup, the latest first. A second call in the same hook finds none. */
export function drainCleanups(): void {
  for (const cleanup of cleanups().splice(0).reverse()) cleanup();
}

afterEach(drainCleanups);
