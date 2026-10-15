# 001-421: two test races under CI load

## `test/runners/node-test/run.test.ts`, "does not start files left in the queue when the deadline passes"

### What CI saw

Main CI run 38769103748 on 419359c1, Node 24.21.0 (the same version as this
host): `end: "timed-out"`, `results: []`, but `completedFiles` held
`edge/test/busy-loop.test.ts`; the case took 3046 ms. It was not a timeout of
the test: the 3046 ms is the 3000 ms deadline plus about 46 ms of teardown, and
the failure is the `toMatchObject` on `completedFiles`.

### Cause

A file counts as completed when its stream holds the wrapper's
`test:complete` and the final `test:summary` (`report.ts`). Two ways the busy
loop could get both:

1. **The deadline's SIGTERM flushes a whole stream.** Ruled out on this host.
   Node 24.21's `terminationHandler` (`internal/test_runner/harness.js`) emits
   `test:interrupted`, waits one `setImmediate`, runs `exitHandler(true)`
   (which calls `root.postRun`, the wrapper's cancellation and the summary)
   and calls `process.exit()` at once, so the reporter pipeline never writes
   what `postRun` pushed. 35 direct SIGTERMs of `node --test busy-loop` at
   2.5 to 3 s, idle and on CPUs 0-1 beside two busy loops, all left
   `enqueue, dequeue, interrupted` only; so did 10 with a preload that holds
   the parent's `exit` for 100 ms. Early deadlines (50 to 1000 ms) under load
   kill the runner before its handler is installed: empty stream, `signal
   SIGTERM`. None was ever completed.
2. **The busy loop's process ended before the deadline.** Then its parent
   reports the file failed with a whole stream (a completed file, no results,
   a file-level error), the worker starts `pass.test.ts` before the deadline,
   and the deadline kills that one: exactly `completedFiles: [busy-loop]`,
   `results: []`, about 3 s. A never-returning test ends only if its process
   dies (a child killed from outside, or one that failed to start under
   load); CI kept no stderr, so which one is not known.

So the product behaved correctly for what happened: the queued file did start,
because the file ahead of it finished first. The case assumed the busy loop is
still running at the deadline and never checked it.

### The bound

The case now reads its own premise and the meaning from `run.json`:

- the busy loop's stream is not completed, else it fails with the loop's
  exit and `stderr-0.log`, so a recurrence names its cause;
- `pass.test.ts` was never started: its `run.json` exit is `null` and no
  `stdout-1.log` exists (`startGroup` opens it at spawn);
- then the original `timed-out`, no completed files, no results.

30 of 30 on `taskset -c 0-1` beside two busy loops.
