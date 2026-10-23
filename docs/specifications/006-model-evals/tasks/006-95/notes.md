# 006-95 notes: the run-cell S2 teardown test names the pid it finds alive

Wave 18 W3 (`011-core/tasks/wave-18.md`). Repair of `test/evals/run-cell.test.ts`, "tears down
the session, the daemon and the scratch when the runner is terminated (S2)".

## The failure

CI 39774152045, job Node 22 (3/3), cand/0.1.264 at b24b63250: `alive(pid)` was true at
`run-cell.test.ts:149`, in a test that took 330 ms. Line 148 joined the harness and daemon pids,
so the log did not say which pid it was.

## Which pid stayed alive

It could not be shown directly. CI kept no fake root, and the failure did not come back here: the
unchanged test passed 60 of 60 single-file runs beside a full suite (`flock`'d, `--maxWorkers=4`,
host load 8 to 38), with a trace that read each pid's state at the check. Every pid was already
gone at every check. So the notes name the pid by elimination and by a measured race.

The S2 test checks three pids: the fake harness's shell, logged twice, and the warm-up's fake
daemon.

- The shell logged itself twice. In `FAKE_HARNESS`'s `hang` branch, the background subshell wrote
  `$$`, which in a subshell is the parent shell's pid (POSIX), so the TERM-ignoring background
  process was never checked. Shown here: `sh -c 'echo $$; (echo $$)'` prints one pid twice.
- The fake daemon is not likely. The teardown waits for it until it is reaped:
  `stopDaemon` -> `stopDaemons` -> `waitForExit` polls `process.kill(pid, 0)`, which succeeds for a
  zombie too, so a daemon that `ps` still lists is waited for until it is gone, a stricter test
  than the test's own. The runner log shows it in every traced run:
  `daemon stopped (SIGTERM): stopped; [{"pid":…,"exitedMs":0,"signal":null}]`. A daemon that `ps`
  no longer lists is a zombie or gone. Its parent is init or a subreaper, never the runner, so a
  zombie daemon is reaped at once, not at the moment the test checks.
- So the pid was most likely the harness shell, misread: the one process whose reaping waits for
  the runner's exit, which is the moment the test checks (below).

## The cause

Two facts together.

1. The runner exits before it reaps its session. On SIGTERM the teardown kills the session's
   group (`killRunning`), stops the daemon and clears the scratch, and none of these steps need a
   turn of the event loop's poll phase when each process is already dead at its first check. Node
   reaps a child only in that phase, so the runner exits with the shell an unreaped zombie, and
   its new parent (init, or a subreaper) reaps it a moment later. In all 60 traced runs the runner
   log has `terminated by SIGTERM` and no `session end`: the session's `close` never fired. A
   watch of the shell every 1 ms from the SIGTERM, 6 runs, saw it the same way each time: `Z` with
   the runner as parent through the whole teardown, gone only once the runner itself was a zombie.
2. The test's `alive()` read such a zombie as alive. It sent signal 0 first, which succeeds for a
   zombie, then read `/proc/<pid>/stat` to see the state, and returned true when that read failed.
   When the new parent reaps the zombie between the two calls, the read fails and `alive()` says
   alive. The test checks right after the runner's `close`, which is when the reaping happens.

The race measured in isolation (`/tmp` probe, not committed: a shell starts 2000 short children and
reaps each with `wait`, while a checker calls `alive()` on each pid until it is gone; a misread is
a pid dead before the check, zombie or gone, that the check calls alive):

| `alive()` order | pids | misread |
| --- | --- | --- |
| signal 0, then `/proc` (old) | 2000 | 403 |
| `/proc`, then signal 0 (new) | 2000 | 0 |

## The fix

`test/evals/fake-cell.ts`:

- `alive()` reads `/proc/<pid>/stat` first: a zombie is dead, a missing entry is dead, and only
  where `/proc` cannot be read does signal 0 decide. Its callers (`kill-running.test.ts`,
  `fake-daemon.test.ts`) keep the same meaning.
- `readProcess(pid)` reads a process's state, parent, process group and command line, and
  `survivors(f, logs)` lists every logged pid still alive with them. Each pid check in
  `run-cell.test.ts` is now `expect(survivors(…)).toEqual([])`, so a failure prints the log, the
  pid, its process group, its state and its command line.
- The `hang` harness starts its background process as `sh -c '…'`, whose `$$` is its own pid, so
  both the shell and its TERM-ignoring child are logged and checked.
- `FAKE_STOP_MS`: a fake daemon that receives SIGTERM exits that many ms later. The S2 test sets
  300, so a teardown that signals the daemon and does not wait for it leaves it alive and the test
  fails. This is the test's proof that the teardown waits for the daemons. Shown by a mutation,
  reverted: a teardown that only ran `squeal stop` failed the S2 test, which printed
  `{ log: "daemons", pid: 3258538, pgid: 3258538, ppid: 1049, state: "S", args: "…/squeal.mjs
  daemon …/work" }`; without `FAKE_STOP_MS` the same teardown passed 3 of 3.
- A side effect: while the teardown waits those 300 ms it yields to the event loop, so the runner
  now reaps its shell before it exits, and the lifecycle runs beside the teardown more often (see
  below). The test passes either way.

No change to `evals/lib/session.mjs` or `evals/bin/run-cell.mjs`: the teardown kills and waits for
what the test checks. See "Seen, not fixed".

## Seen, not fixed

For a later row; not needed for this test, and each is a runner behaviour change.

- After SIGTERM the lifecycle keeps running beside the teardown whenever the teardown yields to the
  event loop: the killed session's `close` resolves `runSession`, and the lifecycle goes on to
  `squeal status`, `groundTruth` (`npx vitest run`, then `node --test`), the daemon stop and the
  grade. `killRunning` waits only for the groups running when it was called, so a ground-truth
  run started after it is not killed. `stopCellLeftovers` catches `npx vitest` (its command line
  names `out/`), not `node --test scripts/…` (its command line names no cell path). With a real
  Squeal, a `squeal status` that starts a daemon after the teardown's stop would leave it running
  too. A fix: the signal handler stops the lifecycle from starting processes, for example a flag
  `runBounded` reads to refuse new sessions once `killRunning` has run.
- The runner exits with its session's shell unreaped (above). Harmless, as init reaps it, but a
  `killRunning` that also waits until `runBounded` has settled for each group would reap it
  before exit.

## Checks

At 42f54551b, 2026-10-23:

- `test/evals/run-cell.test.ts`, 10 of 10 single-file runs (8 of 8 tests each) beside one full
  suite, which ran through all ten; host load 10 to 37.
- The full suite beside them, `flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run
  --maxWorkers=4`: 933 files passed, 2 skipped; 7891 tests passed, 10 skipped; exit 0; 1146 s.
- `npm run lint`: no fixes applied. `npm run typecheck`: clean.
- `squeal run --all --wait`: completed at revision 13, no known failures, 915 test files current,
  exit 0.
