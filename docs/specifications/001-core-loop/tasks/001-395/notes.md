# 001-395: escaped.test's parent-name pattern allows a parent that already exited

Worker notes, 2026-10-15. Spec 001 D12 (what a test leaves running, task 001-212's parent in the note). Vitest 5.0.3, Node 24.21.0, a 24-CPU host at load 4 to 15, runs pinned with `taskset -c 0-1`.

## The failure

`test/daemon/escaped.test.ts`, "stops a test's detached sleeper and its orphan when the tier ends, not its own child", failed branch CI twice with the same shape:

- cand/0.1.185, Node 22, run 38665405302 attempt 1: `46819 … (parent 46782, 1.6 s old, SIGTERM, …); 46820 … (parent 1 /sbin/init, 1.7 s old, SIGKILL after 1 s, …)`.
- main 0.1.186, Node 24, run 38674706746: `48000 … (parent 47972, 1.6 s old, SIGTERM, …); 48001 … (parent 1 /sbin/init, 1.7 s old, SIGKILL after 1 s, …)`.

Both sleepers are children of the test's Vitest fork. The first was named moments before the second: the first still names the fork, without its command line, and the second already names the reaper. The pattern required a name after every parent pid.

## Cause

*Read in source code* and *verified by experiment* (`window.mjs` in this folder).

- `terminate` (`src/core/daemon/terminate.ts`) names a parent only when `/proc/<ppid>/cmdline` reads non-empty and the child still has the same ppid after the read. Otherwise it prints the pid alone. The note is right: the pid was the parent at the scan, and its line could not be read as that parent's. **No product change.**
- A Node process is multi-threaded. When it exits, its leader thread shows `Z` in `/proc/<pid>/stat` while its other threads are still dying. Its children are moved to the reaper only when the last thread exits, so until then they still name its pid as their ppid. Its `cmdline` reads empty, because its memory is already released.
- `EscapedChildren.#workersGone` (`src/core/daemon/escaped.ts`) waits up to the grace for the lane's fork to go. It judges this with `statOf`, which returns `null` for `Z`. So the wait ends when the leader turns `Z`, which is exactly when that window opens, and the snapshot and `terminate` run inside it. The sleepers' age of 1.6 s, the 1.5 s the test waits plus about 0.1 s, says the wait did end early.
- `window.mjs` spawns a Node child that spawns a detached sleeper and exits after 300 ms. It polls the child's stat and the sleeper's ppid in a tight loop. It counts how often the sleeper still named the exiting child while the child's `cmdline` read `""`, and how long the window lasted. Every row is `taskset -c 0-1`:

  | child's nice | busy loops on the 2 CPUs | unnamed parent seen | window p50 / p90 / max |
  |---|---|---|---|
  | 0 | 0 | 54/60 | 3.1 / 7.1 / 10.9 ms |
  | 10 | 0 | 58/60 | 2.7 / 4.2 / 8.1 ms |
  | 0 | 2 | 48/150 (9/30, 20/60, 19/60) | 0 / 9 to 11 / 16 ms |
  | 10 | 2 | 70/150 (20/30, 23/60, 27/60) | 0 to 5.8 / 7 to 12 / 16 ms |

  The window is a few milliseconds at any priority. `#workersGone` polls every 25 ms and stops at its start, so a scan that lands inside it is not rare.
- **Reproduced locally**: 20 runs of the test alone, unchanged, on `taskset -c 0-1` gave 1 failure with the CI shape: `(parent 1603430, 1.7 s old, SIGTERM, …)` beside `(parent 1049 /usr/lib/systemd/systemd --user, …)`. A deterministic reproduction through the daemon was not found. Holding a Node process's leader as a zombie while its threads live needs a thread blocked in uninterruptible sleep, which a fixture cannot arrange portably. The pattern was checked instead against both CI notes verbatim: the old one rejects both, the new one accepts both.

## The fix (test only)

- The fixture writes its own pid, the fork's, beside the sleepers' pids.
- The pattern's parent is `(?:<fork pid>|\d+ [^,]+)`. The fork may be named or not, because the stop can read it exiting. Any other parent is a reaper that lives on and must be named, as in `parent 1 /sbin/init`. The pattern still rejects a nameless parent other than the fork, a pid that merely starts with the fork's digits, and an unnamed `parent 1`.
- Keeping the parent alive in the fixture was not possible. The parent is Vitest's fork, which Vitest stops when the file ends, and the daemon's stop runs after that.

## Does 001-378's nice 10 widen the window?

Before 001-378, only a slow lane's processes were lowered. Now a fast lane's fork is found by the 250 ms poll and runs at `nice` 10, and in this test it runs about 1.5 s, so it is lowered. The daemon scans at its own priority.

It does not create the race: the window opens at `nice` 0 too (54/60 in the probe without busy loops), and `#workersGone` ends at its start whatever the priority. It plausibly makes both failures more frequent, unconfirmed:

- **The probe** (table above). With 2 busy loops, the unnamed parent was seen 70/150 at `nice` 10 against 48/150 at `nice` 0. That is 15 points more often, p ≈ 0.01 by a two-proportion test, but the 150 trials come from three runs at different host loads and are not independent: a large gap, unconfirmed. The window's length did not grow (p90 7 to 12 ms against 9 to 11 ms).
- **Through the daemon.** 17 runs of the test, alternating `TEST_NICE` 10 and 0 (patched in `src` for the measurement and restored; script `arms.sh`), on `taskset -c 0-1` beside 2 busy loops. All 17 passed. In every run the fork had exited before the scan and both sleepers named the reaper. The sleepers' age when stopped, which is when the tier's stop ran:
  - `nice` 10: 4.9, 5.2, 6.2, 6.3, 6.5, 7.2, 8.1, 8.6, 8.8 s (median 6.5 s, 9 runs);
  - `nice` 0: 2.5, 2.6, 2.6, 2.6, 2.6, 2.7, 2.9, 2.9 s (median 2.6 s, 8 runs).

  At `nice` 10 the fork does the test's work, and its own exit, at a tenth of a busy loop's weight. Under contention its tier ends about 4 s later. The first failure needs the scan to land in the few milliseconds of the fork's exit, and the second needs the fork to take more than the 1 s grace to exit. A lowered fork makes the second likelier, as the age of 2.8 s in that failure suggests. This measurement did not separate the first.
- **History.** Both CI failures are on 0.1.185 or later, the first release with every lane at `nice` 10. That is consistent with a widening, not proof of one.

## A second failure, not this row's: an orphan the tier's stop misses

Seen 3 times in 117 local runs on 2 CPUs (2 of 40 at host load, 1 of 20 beside 2 busy loops, 0 of 17 in the arms), never in CI so far: `both sleepers gone after the tier not met in 10000 ms`. The diagnostic print (uncommitted) showed:

```
detached gone; plain S, ppid 1049 (systemd --user), pgrp = the daemon's; spawner gone
notes: ["stopped 1 process a test left running after its tier: <detached> … (parent <fork>, 2.8 s old, SIGTERM, run …)"]
```

- The age of 2.8 s says `#workersGone` waited its whole grace of 1 s and the fork had still not gone.
- At the scan, `plain`, the unmarked orphan in the daemon's group, was still a descendant of the daemon through the fork. `#find` takes a group member as an orphan only when it is not a descendant, so it was not taken.
- The fork itself, a lane carrier started since the run's mark, was not stopped or named either. Its environ most likely read empty because it was exiting, so it carried no mark the stop could read.
- `plain` was moved to the reaper after the scan. A later tier's stop does not reach it (it started before that tier's `alone` mark), so it runs until the daemon exits.

This is D12's stop missing a process, not a wrong note, so it was left alone here. A proposed follow-up row: *"A tier's stop misses an unmarked orphan whose parent, the run's fork, is still exiting at the scan."* Two candidate fixes:

1. `#workersGone` counts a fork as gone only when `/proc/<pid>` is absent, or its leader is `Z` and no process names it as ppid. This would also close the unnamed-parent window above.
2. The stop takes the unmarked descendants of a lane child that is exiting (`Z`, or its environ unreadable) as the run's.

The done-when would be a fixture whose fork outlives the grace, for example a fork that ignores SIGTERM for 1.5 s: its orphan is stopped by the tier's stop.

## Checks

- Before the fix: the test alone, 20 runs on `taskset -c 0-1`, gave 19 passes and 1 failure with the CI shape.
- After the fix (16a90ceb): the whole file, 20 runs on `taskset -c 0-1`, gave **20 passes**. The test alone, 40 runs, gave 38 passes. The 2 failures were the second failure above, before the pattern is checked.
- No run after the fix read the fork unnamed and passed through the new branch of the pattern. Vitest prints no console output for a passing test, so the first count of those was empty, and the file-logged arms ran under busy loops, where the fork always exited before the scan. The branch is covered by checking the pattern against both CI notes verbatim.
- `npm run lint`: clean (1231 files). `npm run typecheck`: clean.
- `squeal run --all --wait` (Squeal 0.1.168, which exits 0 either way): checkpoint completed at revision 60, `Known failures: 0`, 594 test files current.
