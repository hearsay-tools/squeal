// The time `squeal ci record`'s own code takes in this process or thread
// (spec 018 D8, row 018-29): the evidence (`evidence.cjs`), the hook's
// reporter (`vitest-ci.cjs`) and the coverage provider's work in the Vitest
// process (`coverage.cjs`, `map-client.cjs`). Each thread loads its own copy
// of this module, so each has its own clock; `evidence.cjs` writes its total
// beside the evidence (`o`). `timed(fn)` adds the time of each outermost
// call, so a timed call inside another counts once; `add(ms)` adds time
// measured elsewhere (the records' worker's). It reads `performance.now` as
// this module found it, so a test's fake timers do not change it. Not timed:
// the daemon's recorder, the module-resolve hook's chain, V8's coverage in
// the test workers. Informational: no key, export or refusal reads it.
//
// A Worker started with `COUNTED_OUTSIDE` in its `workerData` has its whole
// busy time added to the clock of the thread that started it (`add`), so its
// own clock reads 0: each thread's time counts once (review of 0.1.428, B2).
"use strict";
const { performance } = require("node:perf_hooks");
const { isMainThread, workerData } = require("node:worker_threads");

/** A `workerData` key: this Worker's time is on the clock of the thread that started it. */
const COUNTED_OUTSIDE = "squealTimeCountedOutside";
const outside = !isMainThread && workerData?.[COUNTED_OUTSIDE] === true;

const now = performance.now.bind(performance);
let total = 0;
let inside = false;

/** `fn` with each outermost call's time added to the clock. */
function timed(fn) {
  return function (...args) {
    if (inside) return fn.apply(this, args);
    inside = true;
    const start = now();
    try {
      return fn.apply(this, args);
    } finally {
      inside = false;
      total += now() - start;
    }
  };
}

/** Adds `ms` measured elsewhere; anything but a positive finite number adds nothing. */
function add(ms) {
  if (Number.isFinite(ms) && ms > 0) total += ms;
}

/** The time on this thread's clock so far, in milliseconds; 0 when it is counted outside. */
function spent() {
  return outside ? 0 : total;
}

module.exports = { COUNTED_OUTSIDE, add, now, spent, timed };
