# 020-29 and 020-30 worker notes (2026-11-12)

Brief: `tasks/wave-11.md`, section "020-29 and 020-30". Shape: repair.

## 020-29: no inspector watch in what a no-provider worker starts

Commit `bad1d6136`. `installWatch` (`src/runners/vitest/ci-runtime/inspector.cjs`)
still reads its owner's `<raw>/inspector/<owner>.no-provider` file (owner:
`process.ppid` on a main thread, `process.pid` on a thread). On a main
thread it now also writes or removes the file for its own pid (`tell`,
which `watchWorkers` uses too). So each process and thread a worker starts
reads its parent's file, at any depth. A process that watches removes a
file that an earlier process with the same pid left in the same raw
directory.

Tests (`test/runners/vitest/ci-inspector-watch.test.ts`): the two Vitest
process cases now also start, from the forked worker, a child, the child's
own child and a thread, and from the thread worker, a child. All of them
watch with a provider and none of them watch without one. A third case
covers removal of an earlier file with the same pid.

Limits that remain (not in this row's ownership):

- A process started through one that loads no Node hook (a shell, for
  example) finds no file and watches, as before the fix.
- A Vitest CLI started below a no-provider worker never calls `installWatch`
  (`vitest-ci.cjs` skips it in a Vitest CLI process). So it passes nothing
  on, and its own workers watch. A change there belongs to the owner of
  `vitest-ci.cjs`.
- Logs from deeper processes have an owner other than the top Vitest
  process, so `readWatch` never reads them. A watch there costs hook
  installation only.

## 020-30: keep-busy names the holder

Commit `786adfed3`. The cause seen on Node 26 was the test's own timer.
The case started a 400 ms release timer before the gate ran. The gate's
first busy try blocks 250 ms (`BUSY_SLICE_MS`) before `giveUp` reads the
holder. With more than 150 ms of setup under load, the timer fired in the
`await sleep(0)` after that try, so the gate read no holder. Now the case
starts the timer from `onBusy`, after the busy note named the holder. Every
case also waits (`visibleHolder`, up to 5 s) until `lockHolders` sees this
process hold the lock before the gate starts.

### Repeat runs (`node_modules/.bin/vitest run test/code/gate/keep-busy.test.ts`, one at a time)

| Node | Runs | Result | One-minute load at start |
| --- | --- | --- | --- |
| 24.22.1 | 1 to 15 (12:00:44Z to 12:25:34Z) | 15 pass | 18.8 to 22.9 |
| 24.22.1 | 1 to 12 (13:03:33Z to 13:05:09Z) | 12 pass | 67.9 to 77.4 |
| 24.22.1 | 13 (13:05:20Z) | FAIL | 72.2 |
| 26.13.0 | none | not run | the coordinator said to stop at the first failure |

Before 13:03Z, the first set waited for load below 24 and paused when the
load rose. At 13:03Z the coordinator said to run without that gate.

Run 13 failed in another case, "counts a moved file with the files to run
again once the bound runs out":

```text
-   "the store is busy (held by pid 587774 (node ... forks.js)); waiting up to 0.6 s to keep 2 completed test files: test/a.test.ts, test/b.test.ts",
+   "the store is busy (the holder is not known); waiting up to 0.6 s to keep 2 completed test files: test/a.test.ts, test/b.test.ts",
    "2 completed test files were not kept in the stores: the store stayed busy for 0.6 s (held by pid 587774 (node ... forks.js)), and 1 of them changed during the wait; the next run will run them again",
```

In this case the lock is held for the whole wait, until `finally`. The
test's read saw the holder, and the gate's later `spent` read saw it too.
Only the gate's first read (`holderOf` in `src/core/code/gate/keep-write.ts`)
missed it. `/proc/locks` had 241 to 369 lines (16 to 24 KB). The kernel
returns it one page per `read()`, and other processes' locks come and go
between reads, so one entry can be skipped (the limit that
`lock-holders.ts` describes). A test change cannot remove this miss.

Ways to close it, both outside this row:

1. In `keep-write.ts` `holderOf` (spec 021 row 021-20): when the store
   refused a write and one read names no holder, read again a few times.
   The store refused the write, so a holder exists.
2. Accept "the holder is not known" in the gate's notes, as the board row
   allows. This makes the test weaker: it would no longer prove that the
   gate names the holder.
