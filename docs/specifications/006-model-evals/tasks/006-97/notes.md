# 006-97 notes: a terminated eval runner starts no process after its teardown began

Wave 19 W2 (`011-core/tasks/wave-19.md`). From 006-95's "Seen, not fixed".

## The fault, shown

On SIGTERM the teardown kills the session's group and then waits for the daemon. The killed
session's `close` resolves `runSession` during that wait, and the lifecycle goes on as if the
session had ended by itself. The S2 test (`run-cell.test.ts`, "tears down the session, the daemon
and the scratch when the runner is terminated") now checks what starts after the signal. At
f9e09794e, before the fix, all five new checks failed in one run:

- `runner.log`: `terminated by SIGTERM`, then `session end {"signal":"SIGKILL",...}` 170 ms later,
  then no refusal.
- Squeal commands after the signal: `stop` (the teardown's), `status`, `status` (the
  lifecycle's).
- `npx` (the ground truth's Vitest) started once; the node:test probe started once.
- At the runner's exit two cell processes were alive. The output cut their command lines; the
  probe's log names one, and the `node --test` that ran it is the likely other. `runBounded`
  starts each command detached in its own group, so the runner's exit leaves such a group.

## The change

`evals/lib/session.mjs`:

- `killRunning` sets a module flag first. `runBounded` reads it: a start after it spawns nothing,
  logs `the teardown has begun: <command> <first arg> not started`, and resolves
  `{ exit: null, signal: null, timedOut: false, spawnError: "stopping" }`. `stopping()` exports
  the flag. `runTurns` already throws on a `spawnError` ("the session could not start"), and the
  grader reads a `spawnError` as "could not start", so a refused session or ground truth never
  reads as a pass.
- `killRunning` waits, up to its 5 s, until each killed group has no live process and its
  `runBounded` has settled. Settled means Node reaped the group's leader, and whatever its end
  resumed (here the lifecycle, up to its first refused start) has run. This makes the S2 race the
  same every time. It also closes 006-95's second note: the runner reaps its session's shell
  before it exits.

`evals/bin/run-cell.mjs`:

- `refuseAfterTeardown(what)` throws `the teardown has begun: <what> not started` once
  `stopping()` is true. `sh` calls it, so every `git`, `codex` and `squeal` call does. The
  teardown's own `squeal stop` passes `{ teardown: true }` through `stopDaemon`. One call sits
  before the grade's synchronous tail, the harness's `--version` and `grade.mjs`, since no wait
  sits between them. The judge's runner is wrapped, so a judge call after it is refused too.
- The lifecycle's throw ends in its `catch` (`cell failed: the teardown has begun: squeal status
  not started`). The main path then awaits the same teardown. `signalled` keeps the first signal's
  code, and both exits use it, so the exit stays 128 + n whichever continuation runs first.

The lifecycle's process starts before its first `await` (pin, fixture, service, Codex plugin
setup) cannot race a signal: Node runs the handler only at a turn of the event loop.

## Decisions the spec did not settle

- A refused start returns a record, not a rejection. Callers keep one shape, and `runSession`'s
  load sampler is cleared as on any other end.
- `spawnError: "stopping"` is lowercase, apart from the errno codes it sits beside.
- The flag is module state with no reset. `killRunning` is only the runner's teardown, and Vitest
  isolates each test file's modules. `kill-running.test.ts` says its tests run in order.

## Seen, not fixed

For a later row; each is outside this row's files or the done-when.

- A judge call in flight at the signal is not killed. `claudeRunner` (`evals/lib/judge.mjs`)
  spawns `claude` without a process group that `killRunning` tracks. Its command line names no
  cell path, so `stopCellLeftovers` misses it, and it outlives the runner. Only a later judge call
  is refused. A fix: `claudeRunner` takes a spawn, or runs through `runBounded`.
- A signal during a synchronous call (`squeal run --all --wait` in the warm-up, `status --wait
  300000`, `sh`'s 600 s bound) is handled only when the call returns. Nothing is left alive, as
  the child has ended, but the runner answers SIGTERM late.
- A refused ground truth still writes `truth.json` and `truth.node.txt` (refused records, no
  secret), possibly after the teardown's secret scan.

## Checks

At 04c04cabb, 2026-10-23:

- Red first: the five checks above failed at f9e09794e. With the old `session.mjs` restored under
  the new `run-cell.mjs` (whose guard then never fires), the S2 test and both new
  `kill-running.test.ts` checks failed; restored.
- `test/evals/run-cell.test.ts`, 10 of 10 single-file runs (8 of 8 tests each) beside one locked
  full suite (`flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4`,
  started 02:58:47Z), which ran through all ten; host load 10.4 to 20.3.
- `npm run lint`: no fixes applied. `npm run typecheck`: clean.
- Squeal at revision 11: the 73 `test/evals` files current, no known failures.
