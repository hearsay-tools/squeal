# 011-179: the validity comparison runs its drivers at once and removes each work directory as it ends

Worker 0995985a, wave 31 W10, from `cand/w31` at 5c8610e0d (0.1.292 the last release), 2026-10-24. Shape: repair (test). Changed: `test/keys/validity/sides.ts`, `compare.ts`, `self-test.ts`, and a new `sides.test.ts`. Unchanged: `driver.ts`, the harness, the cases, `pytest.test.ts`, `compare-refs.ts`, `src/`.

The brief names `test/keys/validity/harness/sides.ts` and `harness/compare.ts`. Those paths do not exist; the files are `test/keys/validity/sides.ts` and `compare.ts`, one directory up.

## 1. Where the time went

A scratch probe called `compareTrees` as `pytest.test.ts:34` does (this checkout against itself, the `str(pytest.__version__)` overlay, the 19 `adapter:pytest` cases), kept the work directory, and read each phase's end from its files' times. At 5c8610e0d, load 25 to 30:

| Phase | Ends at |
|---|---|
| Both driver bundles | 1.8 s |
| The baseline's run (one driver, 19 cases in turn) | 37.7 s |
| The candidate's run | 69.4 s |
| The three decisions, in turn | 69.8, 70.1, 70.5 s |
| The comparison | 72.4 s |

*Read from the work directory's file times.*

The two runs are 95% of the time. The decisions run only the `accept` kind (`decideCase`), so here each is a driver's start and exit.

The work directory held 13,231 files and 195 MB. Each pytest case's scratch is about 5 MB, mostly `cache/pycache`, the bytecode the run writes under the case's own cache directory. The two synced Python environments are 9 MB.

## 2. The change

| Where | What |
|---|---|
| `sides.ts` | `invocation` builds a driver's arguments and environment once. `execute` keeps its signature and stays synchronous, for `compare-refs.ts`. `launch` is the same driver through `spawn`, as a promise. A driver's cases file is now `<label>.cases.json`, so drivers of one side do not share it. |
| `sides.ts` | `runSide` deals a side's cases round robin into `SHARDS` (2) shares and runs one driver per share at once. A share's case `j` writes under `run-<k>/<j>`; when all shares end, each moves to `run/<i>`, `i` its place in the cases, the layout `storedFor` and `compare-refs.ts` read. |
| `sides.ts` | `allEnded` waits for every driver before it throws the first failure, so no driver still writes in a work directory that the removal deletes. |
| `compare.ts` | Both sides' runs at once (4 drivers), then the three decisions at once. The merge of decisions into outputs, the verdicts and the coverage are unchanged. |
| `self-test.ts` | Each comparison's directory (`run-N`) is removed asynchronously as the comparison ends, while the next test runs. The `afterAll` hook waits for those removals, removes the rest (the release tree), and has its own timeout, `REMOVAL` (120 s), in place of Vitest's 10 s. |
| `sides.test.ts` | `allEnded` throws the first failure only after every driver has ended, and returns values in the order given. With `Promise.all` in its place, the first test fails (`expected [ 'first' ] to deeply equal [ 'first', 'third', 'second' ]`). |

The bound is fixed: 4 run drivers at once per comparison, each with its pytest or Vitest children, then 3 decision drivers. Each driver still runs its cases in turn, in one process, so the deadline case's held timer (row 011-142) stays local to its case. `HOME` stays one directory per comparison: no driver wrote into it (the kept work directory had no `home`).

## 3. The line-34 test alone, before and after

The test ran alone (`-t "passes a runtime change that every case runs"`) in a detached checkout of 5c8610e0d ("before") or d41601e45 ("after"), `node_modules` linked, so edits and Squeal's runs in this worktree did not change it. Each ran at nice 10, as Squeal runs a test worker. Busy loops at nice 10, unpinned, raised the load: their number was 50 minus the host's runnable processes (10 one-second samples of `procs_running`, the loops excluded), set before each run and held during it, 60 s ahead of it so the one-minute average follows.

| Run | Start (local) | Load (1 min, min to max) | Loops | Test |
|---|---|---|---|---|
| before | 14:37:05 | 39.2 to 45.9 | 24 | 100,013 ms |
| before | 14:44:51 | 45.5 to 54.9 | 42 | 136,399 ms |
| before | 14:50:09 | 35.1 to 48.2 | 40 | 116,477 ms |
| after | 14:53:24 | 49.2 to 51.7 | 40 | 45,584 ms |
| before | 14:55:27 | 49.0 to 54.3 | 40 | 127,565 ms |
| after | 14:58:54 | 48.0 to 48.7 | 37 | 41,840 ms |
| after | 14:41:57 | 28.3 to 30.1 | 24 | 27,392 ms |

*Read from Vitest's verbose output and the load samples.*

At load about 50 the test took 100 to 136 s before and 42 to 46 s after, about 0.35 of its time, against a 150 s half of `FULL`. The ratio is the figure to carry: this host did not reproduce W8's 266 s or the reviewer's 631 s. At 0.35, 631 s becomes about 220 s, inside `FULL` but over its half. Two runs are left out of the table: a run at 14:47:20 started with no loops, because the one-minute average still read 53 from the run before it; and a run with nice-0 loops (W8's method in 011-142 section 2) was stopped after 9 minutes, because 40 nice-0 loops leave a nice-10 process about 7% of a core and slowed the other coordinators' Squeal runs.

The whole file at d41601e45, pinned to cores 16 to 23 beside 24 nice-10 loops on them (4 runnable per core, as a load of 96 on 24 cores): 4 of 4 tests passed, the line-34 test in 57,731 ms, the file in 89.0 s. Unloaded (load 6 to 22): the line-34 test in 14,289 ms, the file in 25.9 s. Squeal's own run of the validity files in this worktree passed at revision 13 (d41601e45).

## 4. The same outputs

The probe ran once per checkout and comparison, recording every case's outputs, keys, `reported` lines, each alarm, the uncovered lines and `failures`:

| Comparison | Cases | Differ after normalising | Alarms, uncovered, failures | Time before → after |
|---|---|---|---|---|
| The full corpus against v0.1.292, `compare.test.ts`'s overlay | 83 | 0 | equal (0 uncovered, 0 failures) | 49.2 s → 17.5 s |
| The line-34 comparison | 19 | 0 | equal (only `pytest` fired, 0 uncovered) | 72.4 s → 13.8 s |

*Read from the probe's records; load 6 to 30.*

Normalising removed text that changes with each run: the comparison's work directory, the pytest config's `hash` (it covers the Python path, which lies in the work directory), a case's scratch path (`run/<i>` before, `run-<k>/<j>` after, inside one Vitest case's error wording) and Vite's random temp names. Before normalising, 17 of 83 cases differed, all in those fields. Both sides agreed in every run.

## 5. The removal

The 195 MB, 13,231-file work directory of section 1 was copied four times and removed with the hook's two ways, pinned to cores 22 and 23 beside 7 nice-10 loops (4 runnable per core):

| Removal | Time |
|---|---|
| `rmSync` (the hook before) | 555 ms, 561 ms |
| `fs.promises.rm` (the hook and each comparison now) | 772 ms, 757 ms |
| `fs.promises.rm`, unloaded | 380 ms |

*Read from the timer's output.*

CPU load alone does not explain the hook timeouts of 011-142 section 5 (more than 10 s at load 59 to 99). Disk contention from parallel test runs on the same disk is the likely cause, and this probe does not reproduce it. The change covers both cases. The large removals leave the hook: a comparison's directory goes while the next test runs. The hook waits for what is left with a 120 s timeout, 12 times the 10 s that failed. In the pinned whole-file run, the `afterAll` hook took 161 ms (from a reporter's hook events). In the unloaded run, one `squeal-validity-*` directory existed after `beforeAll` and none after `afterAll`.

## 6. Decisions

- Two drivers per side, fixed. More would cut the time further on an idle host and add load on a busy one.
- `driver.ts` is unchanged (outside this row). The move from `run-<k>/<j>` to `run/<i>` keeps the layout that `storedFor` and `compare-refs.ts` read.
- `execute` stays synchronous, so `compare-refs.ts` (outside this row) needs no change. `launch`, `allEnded`, `runSide` and `REMOVAL` are new exports; no type changed.
- The removal is per comparison and asynchronous, not inside each test, so it adds nothing to a test's time.

## For whoever continues

- A Vitest worker that ends during a comparison leaves its drivers running: now up to 4 drivers and their pytest or Vitest children, before 1. Squeal's sweep stopped such processes in this worktree at revisions 8 and 9 (12:37 and 12:38 UTC), while the code was mid-edit and `compare.ts` still used `Promise.all`. It noted none at revision 13 (d41601e45) or later. Right after a passing run of `pytest.test.ts` and `compare.test.ts` (17 tests), no `squeal-validity-*` process was left. A driver that exits with its parent needs `driver.ts` to watch for it, outside this row.
- A case whose output depended on an earlier case in the same driver process would now see a different earlier case, at both sides alike. The outputs diff of section 4 shows none today.
- Further cuts, outside this row: `python.ts` syncs the two Pythons in turn; each pytest case writes about 5 MB of bytecode into its own cache.
- The scratch probes (`phases.repro.ts` with `record.ts`, `series.sh`, `rm.mjs`, `hooks.ts`, `diff.mjs`) lived in the worker's scratch folder and go with it. Sections 1, 3, 4 and 5 describe them well enough to write them again.

## 7. Repair round 1: a timed-out test's comparison (review w31b B1)

A Vitest test that times out stops waiting for its comparison; the comparison runs on. The candidate added a comparison's removal only when the comparison settled, so the file's last hook could find nothing to wait for and remove the work directory under live drivers.

- `compare()` now pushes one task per comparison before it can yield: the comparison, then the removal of its `run-N`, whichever way the comparison settles. The task rejects only when that removal fails. The hook waits for the tasks with `allEnded`, then removes the work directory. It keeps the `REMOVAL` bound, so a driver that never ends fails the hook and its directory stays. The wait covered only the tasks pushed before the hook began; review w31b-r2 B1 found the path past it, repaired in section 8.
- No kill on teardown. A hung driver is a failure to see, not one to clean up.
- `self-test.test.ts` is the regression. It mocks `trees.js` (the release's setup is a directory) and `compare.js` (one real driver through `prepare` and `launch` that waits 1 s, then writes scratch and its outputs). The test runs the real `comparisons()` under `it.fails` with a 100 ms timeout: Vitest's timeout is the expected failure. An `afterAll` registered before `comparisons()` runs after its hook (`sequence.hooks` is `stack` by default). It waits for the driver, then checks that the driver's directory was there when it ended and that the work directory is gone.
- Red and green: with the candidate's `self-test.ts`, the file failed with "the hook removed the driver's directory while it ran: expected { present: false } to deeply equal { present: true }"; with the repair it passed (1 expected fail, 1.5 s).
- No type changed; `Comparisons` and `comparisons()` keep their signatures.

## 8. Repair round 2: a timed-out test's next comparison (review w31b-r2 B1)

Worker 8cc099c7, wave 32 W14, from `cand/w31b` at 79f80c897, 2026-10-24. Changed: `self-test.ts`, `self-test.test.ts`.

A test that timed out runs on: when its first comparison ends, it starts its next one. Section 7's hook had already read the task list, so it removed the work directory under the second driver. `lock.test.ts` makes two comparisons in turn in two tests.

The rule now:

- When the file's last hook starts, it closes. A `compare()` after that throws "compare() after the file's last hook began, as a timed-out test's next comparison: it does not run". It throws before it reserves `run-N` or starts a driver, so no driver starts after the hook began.
- The hook waits with `allEnded` until the task list stops growing, then removes the work directory. With the closed flag the list cannot grow during the wait; the loop is the second guard the brief asked for, and costs one more `allEnded` over settled tasks.
- The `REMOVAL` bound (120 s) is unchanged: a driver that never ends still fails the hook and keeps its directory. No kill on teardown.
- A `compare()` from a test file's own `afterAll` would now throw. No validity test calls one from a hook.

`self-test.test.ts` has two suites, each with its own `comparisons()` and an observer hook registered before it, so the observer runs after its last hook. "one comparison" is section 7's case. "two comparisons in sequence" times out in its first comparison, then calls `compare()` again. The driver now holds 2 s (1 s before), so the hook has begun well before the first driver ends, even on a loaded host. Each driver records whether its script, its cases file and its side directory were there when it ended. The observer waits for every driver, removes the fixture, then checks: every driver kept its paths, the work directory was gone after the hook, and the second call was refused with the error above.

Red and green, in a scratch copy of 79f80c897 (`git archive` of `src/`, `test/`, `package.json`, `tsconfig.json`, `node_modules` linked, a config with only this file, `HOME`, `TMPDIR` and the XDG directories in the scratch, nice 10, `env -u PLUGIN_ROOT -u PLUGIN_DATA`), load about 4:

| `self-test.ts` | Result |
|---|---|
| 79f80c897's | "one comparison" passed; "two comparisons in sequence" failed: "the hook removed a driver's paths while it ran", the second driver's error `Cannot find module '…/squeal-validity-YTCzdb/run-1/candidate/dist/cli/driver.mjs'`; exit 1 |
| the repair | both passed, 2 expected fail, 4.4 s, three runs; the scratch `TMPDIR` empty after each; exit 0 |
| the repair without the closing flag (the loop only) | both drivers kept their paths, but "the hook let a comparison start after it began: expected 'ran' to match /does not run/"; 6.6 s; exit 1 |

*Read from Vitest's output.*

So the loop alone keeps the paths; the flag is what stops a driver from starting during teardown, and the test needs both. `sides.test.ts`'s rejection-order test is unchanged. No type changed; `Comparisons` and `comparisons()` keep their signatures.
