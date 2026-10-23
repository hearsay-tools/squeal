# 006-98 notes: a judge call running at the runner's termination ends with it

Wave 20 W2 (`011-core/tasks/wave-20.md`). From 006-97's "Seen, not fixed".

## The fault, shown

`claudeRunner` (`evals/lib/judge.mjs`) spawned `claude` with a plain `spawn`: in the runner's own
process group, outside the groups `killRunning` tracks. Its command line names no cell path, so
`stopCellLeftovers` missed it too. A new `run-cell.test.ts` test ("kills a judge call running
when the runner is terminated") runs a cell to its judge, whose fake `claude` hangs, and sends
SIGTERM. At 56c542f86, before the fix, the runner exited 143 with both judge processes alive,
reparented to the host's subreaper (ppid 1049): the shell and its child, each ignoring SIGTERM.

The fake: `fake-cell.ts`'s harness script logs a judge call's pid to `log/judge` when its `HOME`
is a `squeal-judge-*` scratch (`judgeEnv`). `FAKE_JUDGE=hang` keeps it running. The first judge
call of a cell is `claude --version` (`calibratedIdentity`), so no calibration file is needed.

## The change

- `runBounded` (`evals/lib/session.mjs`) takes `input`: written to stdin, which is otherwise
  closed as before.
- `claudeRunner` runs its call through `runBounded`: detached, in a group of its own, tracked by
  `killRunning`. Its timeout is `runBounded`'s: SIGTERM to the group, `graceMs` (new, 10 s)
  later SIGKILL. Before, it sent SIGKILL to the `claude` process alone, which left its children.
  After the teardown has begun it starts nothing: `status` null, `stderr` "the teardown has
  begun: ...". A command that cannot start gives `status` null and "`<command>` could not start:
  `<code>`" in `stderr`. The scratch is removed when the call settles, so before `killRunning`
  returns.
- `groundTruth` writes neither `truth.json` nor `truth.node.txt` once the teardown has begun
  (006-97's third item). It returns the records.
- `stopOnSignal()` (`session.mjs`), installed once: on SIGINT, SIGTERM or SIGHUP, SIGKILL to
  every group `runBounded` runs, a synchronous wait until none is live (5 s at most), then exit
  128 + n. A group still live at 5 s is named on stderr, and the script exits anyway.
  `judge-calibrate.mjs`, `regrade.mjs` (with `--judge` only) and `run-baseline.mjs` call it
  (coordinator decision B, request f15f0a70; SIGHUP, decision A, request 5d9a129b).
- `evals/lib/index.d.mts`: `runBounded`'s `input?` and `claudeRunner`'s `graceMs?`, both
  optional (coordinator request dd200ec4). `stopOnSignal` is exported by `session.mjs` alone,
  not through `index.mjs`, as `stopping` is, so `index.d.mts` does not declare it.

## Why the judge scripts needed a handler

A judge call in its own session no longer gets a terminal's Ctrl-C (SIGINT) or, when the
terminal closes, its SIGHUP. Before this row the call sat in the script's foreground group, so
either signal ended both. Without a handler, the call now outlived its script with no timeout,
as its timer died with the script. `stopOnSignal` answers the three signals `run-cell` answers.

## Why `stopOnSignal` does not await `killRunning`

The coordinator's contract named `killRunning`. Awaiting it lets a killed call's continuation run
before the exit. A killed call's end resolves its promise, and the script's next calls are all
refused at once. `regrade --judge` would then write error verdicts into the results, and
`judge-calibrate` a failed calibration file, which `ensureCalibrated` never retries. Shown red:
with an awaiting handler, the test's `.then()` after the killed call wrote its file before the
exit. `stopOnSignal` uses the same flag and SIGKILL as `killRunning` (`killGroups`, shared), but
it waits with `Atomics.wait` and does not yield to the event loop. The killed leader stays an
unreaped zombie, which `groupLive` does not count, and the process exits from the handler.

Not tested: the 5 s bound with a group still live. SIGKILL cannot be ignored, so only a process
in uninterruptible sleep (D state) outlives it, and a test cannot make one reliably. Read the
code: the loop breaks at the deadline, names each live group, and exits.

## Checks against the coordinator's contract

1. One helper, `stopOnSignal`, with a unit test in `kill-running.test.ts`. A child process installs
   it twice (one listener per signal) and starts a `runBounded` shell. The shell and its child
   ignore SIGINT, SIGTERM and SIGHUP. Then SIGTERM (exit 143), SIGINT (exit 130) and SIGHUP (exit
   129): no logged process alive, no live group, and the killed call's `.then()` wrote nothing.
2. Called in the three scripts; only their imports and the call changed. No `evals/bin` script
   was run.
3. `run-cell.mjs` does not call `stopOnSignal` (`grep`), so only its own handler is installed
   there.
4. `run-baseline.mjs` starts each cell (`run-cell.mjs`) and `judge-calibrate.mjs` with a plain
   `spawn`, `stdio: "inherit"`, not detached: in its own process group. That did not change, so a
   terminal's Ctrl-C still reaches each cell, which runs its own teardown. The handler runs
   `run-baseline`'s own teardown, killing its judge calls, before it exits. Before this row it
   died at once on Ctrl-C and its cells did the same as now. SIGTERM sent to `run-baseline`
   alone still reaches none of its cells, before and after: they run on.

## Decisions the spec did not settle

- `regrade.mjs` installs the handler only with `--judge`: without it no judge call starts, and
  its Ctrl-C stays as it was.
- A judge's timeout now ends its whole group, with a 10 s grace after SIGTERM, where it sent
  SIGKILL to `claude` alone at once.
- The bound's stderr line names the signal and the group: `SIGTERM: process group <pgid> still
  live 5000 ms after SIGKILL`.

## Seen, not fixed

- A signal during a synchronous call in `run-cell.mjs` (`squeal run --all --wait` in the warm-up,
  `status --wait 300000`, `sh`'s 600 s bound, all `spawnSync`) is handled only when the call
  returns. Nothing is left alive, as the child has ended, but the runner answers SIGTERM late.
  The fix moves `sh` to an async spawn through `runBounded` across `run-cell.mjs`, which this row
  does not own. Not small.
- SIGTERM sent to `run-baseline.mjs` alone (not its process group) leaves its cells and a running
  `judge-calibrate.mjs` child going, as before this row. A later row could forward the signal to
  its children.

## Checks

At 366905b9d, 2026-10-23:

- Red first. The `run-cell.test.ts` test failed at 56c542f86: both judge processes outlived the
  runner. All three `judge-kill.test.ts` tests failed against the old `claudeRunner`. The ground
  truth test and both `stopOnSignal` tests failed with the guard removed and an awaiting handler.
  Each file was restored. The red run of the old `claudeRunner` left its fake judges running.
  They were found by their `PIDS` variable and killed.
- `run-cell.test.ts`, `kill-running.test.ts` and `judge-kill.test.ts`: 10 of 10 single runs
  (18 of 18 tests each) at 560f2a3aa, host load 10.5 to 5.6. No locked full suite beside them.
- `test/evals/judge-*.test.ts`, `judge-isolation.test.ts` included: 6 files, 56 tests passed at
  6c8ab9b02.
- `npm run lint`: no fixes applied. `npm run typecheck`: clean.
- `squeal run --all --wait`: checkpoint completed at revision 27, no known failures, all 923 test
  files current (848 already current, 75 run now), exit 0.
- No fake judge or cell process alive after the runs (a `/proc` scan for `PIDS=` and `FAKE_LOG=`).
