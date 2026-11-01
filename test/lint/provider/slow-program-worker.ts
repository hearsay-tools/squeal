import fs from "node:fs";

/*
 * The ESLint worker on a host where building TypeScript's program is slow
 * (row 017-18): each read of TypeScript's `lib.es5.d.ts`, which every
 * program build makes, sleeps first. It sleeps, so it makes no CPU load.
 * Set before the worker's observer, which wraps it and so still names the
 * code that reads.
 */

/** Keep equal to `SLOW_PROGRAM_MS` in `program-build.test.ts`; importing this entry would run it. */
const SLOW_PROGRAM_MS = 2_000;

const { readFileSync } = fs;
const sleep = new Int32Array(new SharedArrayBuffer(4));
fs.readFileSync = function (this: unknown, ...args: unknown[]) {
  if (String(args[0]).endsWith("/lib.es5.d.ts")) Atomics.wait(sleep, 0, 0, SLOW_PROGRAM_MS);
  return Reflect.apply(readFileSync, this, args);
} as typeof fs.readFileSync;
await import("../../../src/core/lint/provider/worker.js");
