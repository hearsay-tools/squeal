# 011-245: status names a test's process left running after a cut Vitest run

Wave 51 W2, slice. Baseline `0885eec11`. gh-101; 013 `research/issue-101.md`, findings 2, 3 and 5.

## Cause

When the Vitest adapter cancels a run and the running test does not end within the 1 s grace, `execute`'s second cancel is Vitest's forced pool cancel. It kills each worker process and nothing else (research finding 1). A process that a test starts in a group and env of its own lives on. The daemon's sweep (011 C13) cannot find it, because it has no `SQUEAL_DAEMON_CHILD` mark and is not in the daemon's group. So no note and no status line named it.

A walk of the worker's descendants at the forced cancel alone does not find the research's holder either. Its leader (`sh -c 'node holder & … exit 0'`) exits at once, so the holder's parent is the user's reaper (pid 1049) before any cancel (research finding 3). It is no longer below the worker when Squeal looks.

What still ties it to the run: the recorder's spawn wrapper (`src/runners/observe/spawn.cjs`, `injected`) writes `SQUEAL_OBSERVE` into every env that a test's spawn passes, also an env of its own (`env: { PATH }`). The value holds the instance's own `out` directory and `started: true`. The holder inherits it from its leader. Observe is on by default (`observe.runtimeInputs: true`). The daemon mark does not ride that way, which is why the sweep misses the holder.

## The change

The human chose "Report it": Squeal names the process and stops nothing it did not stop before.

- `src/core/daemon/outlived.ts` (new). `heldByRun(ties, since, table, self)` reads, from one process table, every process started since the run began that the run's workers started. The workers are the daemon's own children since the run began that carry the instance's mark, or every such child when the instance has no mark. The workers themselves are left out. Three ties count:
  1. a descendant of a worker;
  2. a member of a session or process group whose id is a worker's or a descendant's pid (the kernel does not reuse a pid while a session or group still uses it as its id);
  3. on Linux, a process whose `SQUEAL_OBSERVE` has this instance's `out` and `started: true`.

  An env Squeal cannot read (another user, `EACCES`, a process gone) is no tie. A failed table read finds nothing. `heldByRun` never rejects. `outlivedNote(outlived, runId, table)` writes the note for those still running. `HOST` is `/proc` on Linux, one `ps -A -o pid=,ppid=,pgid=,stat=,lstart=` on macOS (`psRows` parses it; no env tie, no session id), and an empty table elsewhere.
  `tiesOf(env, markVariable)` reads the ties from the env the runner gave its workers. `cutReading(markVariable, table)` is one run's reading: `beforeForce`, which keeps what `heldByRun` found and never rejects, and `note(runId)`, after the sweep. The `ps` calls have a 2 s timeout.
- `src/core/types/runner.ts`: additive `RunOptions.beforeForce?: (env) => Promise<void>`, awaited by a runner right before it kills a cancelled run's workers past the cancel's grace, with the env it gave them.
- `src/runners/vitest/run.ts`. Right before the forced cancel, and only then, `execute` awaits `beforeForce` with `vitest.config.env`, where the adapter's `createVitest` `env` option lands (the daemon mark `CHILD_VARIABLE` and the recorder's `SQUEAL_OBSERVE`). It waits at most `BEFORE_FORCE_MS` = 500 ms, then makes the forced cancel whatever the hook does. A hook that throws at once or rejects is written to the run log as `beforeForce: <error>` and changes nothing of the run. Nothing else in `execute` changed: a run that ends by itself or in the first grace never calls the hook.
- `src/runners/vitest/adapter.ts`: one line passes `options.beforeForce` to `execute` (by agreement with coordinator 04a258b0).
- `src/core/daemon/escaped.ts`. `afterEachRun` gives each run a `cutReading` and puts its `beforeForce` in the run's options. After its sweep, it writes `reading.note(runId)` through its `note` callback, with no `stopped` field. The callback's type is now `RunNote`, with an optional `stopped`, and a fourth parameter `table` (default the host's) lets a test time the scan. `daemon.ts`'s `({ text, stopped }) => this.#note(text, stopped)` is unchanged. Every runner wrapper between them passes the options on (composite and its flights, the recovering runner, the slow instance, the idle GC).

**Why the reading is in the daemon, not the adapter.** The first version (`b0ac71b32`) read the host inside `execute` and carried the result in `RunReport.outlived`. `test/keys/key-format.test.ts` then failed: "VITEST_ADAPTER_VERSION: changed lines no case runs", every line of the reading, because it was in the Vitest adapter's bundle and no validity case ran a forced cancel. Its macOS and other-platform lines could never run on a Linux CI. Moving the adapter version would re-key every Vitest check. So the adapter got only the hook (the coordinator's approval, 2026-10-26), `RunReport.outlived` and its composite join were reverted, and one validity case now runs the forced path.

The note, as the coordinator approved it (2026-10-26):

```text
1 process a test started is still running after Squeal stopped its run <runId>; Squeal did not stop the process: <pid> <command> (parent <ppid> <parent command>). `kill <pid>` stops it.
2 processes tests started are still running after Squeal stopped their run <runId>; Squeal did not stop the processes: <entry>; <entry>. `kill <pid> <pid>` stops them.
```

Commands are cut at 120 characters, as the sweep's are. The parent is read when the note is written, so it is usually the reaper. The note is stored like the sweep's notes: a `DaemonNote` in the worktree's `meta` notes. It is printed under `Notes:` by `status --full` and `--notes` (`notesLines`, `src/core/status/status-detail.ts`, unchanged), counted on plain status's `More:` line, and listed in `status --json` `daemonNotes`. It has no `stopped` field, so status does not fold it into the sweep's "stopped N processes" lines. No new status line and no structured JSON field (coordinator, Q3).

## Tests

- `test/runners/vitest/outlived.test.ts` (Linux, real processes): this row's own fixture, built from the research's shapes and not from its probe. A test starts a SIGTERM-ignoring holder (`holder.cjs`, a random token in its argv, a 60 s self-expiry) with `env: { PATH }`, `detached: true`, through a `sh` leader that exits at once. The fixture runs through the real adapter, wrapped by `afterEachRun` with a real `EscapedChildren` of a random token, so the sweep runs too, and with a table that times the scan.
  - block (`Atomics.wait`, which uses no CPU), cut by a supersession: one note names the holder's pid and command; the holder is still alive after the sweep; the scan ran.
  - slow teardown (SIGTERM to the group, 2 s, then SIGKILL), cut by a stop: the same.
  - cooperative teardown (SIGKILL to the group at once): no note, no scan, the holder is gone.
  - observe off, the holder is the worker's own detached child, blocked: found through the walk and named.

  Each test kills the holder it started in `onTestFinished`, only while the pid's command line still has the token, and then deletes its directory.
- `test/daemon/outlived.test.ts`: a fake table for each tie (marked workers, descendants, group and session members, recorder settings of this instance with `started`, another instance's, a thread's without `started`, an unreadable env, processes older than the run, a table that cannot be read); the note's exact text for one and for two processes, and `null` for none or for a reused pid; `psRows` with a zombie; `execute`, which awaits the hook zero times for a run that ends by itself or in the first grace and once at a forced cancel, with the instance's env; a hook that throws at once, rejects or never ends leaves the execution equal to one with no hook, the first two logged, the third cut after 500 ms; `cutReading`, which notes nothing before its hook ran and never rejects on a broken table; `afterEachRun`, which puts the hook in the run's options and writes the note after the sweep's note, with no `stopped`.
- `test/keys/validity/cases/adapter/vitest.ts`: "a run whose test blocks past the first grace is cut by the forced cancel and completes nothing (row 011-245)". Its test writes `$STARTED`, then `Atomics.wait` for 5 s; the cancel is `yield`. Both trees store nothing for it, so the alarm stays quiet, and the inserted `execute` lines and `adapter.ts`'s call run in it.

The sweep's tests are unchanged and pass: `escaped.test.ts`, `escaped-overlap.test.ts`, `escaped-run-mark.test.ts`, `escaped-identity.test.ts`, `low-priority.test.ts`, `child-env.test.ts`, `beside-backlog.test.ts`, `focuses-file.test.ts`, and the cancel tests `cancel-cause.test.ts` and `cancel-grace.test.ts` (Squeal, revision 18, 12 files current, no known failures; again in the final verdict below).

## Evidence

- Discriminating check, observe off for the block shape (a temporary change, reverted; first design): `0 found`, nothing named. So the recorder's settings are the tie that finds the research's holder; the walk and the group tie cannot.
- Deliberate break, `outlivedNote` always `null` (reverted; first design): 5 tests failed (both note tests in `test/daemon/outlived.test.ts` and the three naming cases of the adapter test), 9 passed.
- The alarm: with the validity case removed (a temporary change, reverted), Squeal's run of `key-format.test.ts` at revision 48 failed with exactly one uncovered line, `src/runners/vitest/run.ts:126`, the first inserted line of the forced path. With the case, it passed at revisions 42 and 49, no version moved.
- Scan time, through the test's timing table (the table's list to its last env read): 12 forced cancels (block, slow teardown and direct, in 3 direct runs of the adapter test and 1 Squeal background run of the same file) took 13, 14, 15, 15, 16, 17, 17, 17, 17, 18, 19 and 20 ms, median 17 ms. Load 5.9 to 7.1 (one-minute), about 15 to 16 (five-minute), on 24 CPUs, about 410 processes. The first design's run-log readings of the same 12 cancels, at a load of 14.2 to 18.8: 16 to 52 ms, median 19 ms. The bound: the forced cancel waits at most 500 ms for the hook (`BEFORE_FORCE_MS`), about 25 times the measured median; a `ps` on macOS is killed after 2 s.
- What the validity case adds to `key-format.test.ts` (`-t "moves only when"`, both trees, direct runs at a one-minute load of 4.8 to 7.6): with the case 8.35 s and 8.66 s; without it 9.37 s and 8.46 s, and the test then fails. The difference is inside the noise; the case's own path is the 1 s grace and the forced cancel at each tree.
- No holder was left after the runs: `ps -eo pid,args -ww | grep squeal-011-245` printed nothing. A first version of the test left holders (its `afterEach` deleted the ready file before `onTestFinished` read the pid). I killed those by pid after I checked the token in their command lines; the test now kills and then deletes in one `onTestFinished`.

## Limits

- Observe off (`observe.runtimeInputs: false`), or a recorder that is missing: a holder whose leader exited before the forced cancel is not found. The walk and the session or group tie find only what is still below a worker, or in a session or group that a live worker or descendant leads.
- macOS: no env tie and no session id. Only a holder still below a worker, or in a group a worker or descendant leads, is found. `ps` is tested only through `psRows` with a fake table; no macOS host was here.
- A threads-pool test's direct child with an env of its own and observe off is a child of the daemon itself, so it counts as no worker's descendant. 011 C13 already lists "a thread worker's child without the token" as not covered.
- A run that settles in the first grace reads nothing, also when its teardown leaves a holder: that is a leak without a cut, out of this row.
- Overlapping lanes: the sweep stops the daemon group's orphans only when the last run in flight ends. Such an orphan of a cut run can be named first and then stopped by a later sweep. It is rare, and it kills nothing new.
- A reading failure on the daemon side is silent, as the sweep's are (`.catch(() => null)`): `heldByRun` reads an unreadable table as nothing, and `afterEachRun` has no log of its own. Only a hook that throws or rejects into `execute` is logged, in the run log.
- A hook slower than 500 ms goes on after the forced cancel. Its walk then finds less, since the workers are gone; the recorder-settings tie still holds. The note uses what it kept when the sweep ends.
- `plugins/claude-code/dist` is not rebuilt (not this row's); the bundles drift until integration rebuilds them.

## Commits

- `0fd3e760d` feat(011-245): RunReport.outlived, joined by the composite (by agreement with coordinator 04a258b0); reverted by `8afa2ec3d`
- `b0ac71b32` feat(011-245): name a test's process left running after a forced cancel (gh-101)
- `2ada3dd3a` docs(011-245): notes, cause, evidence, limits and commits
- `b01021511` refactor(011-245): read a cut run's processes in the daemon, through RunOptions.beforeForce
- `276d1b228` feat(011-245): the Vitest adapter passes RunOptions.beforeForce to execute (by agreement with coordinator 04a258b0)
- `8afa2ec3d` Revert "feat(011-245): RunReport.outlived, joined by the composite" (by agreement with coordinator 04a258b0)
