# 001-400: a tier's stop misses an unmarked orphan whose parent, the run's fork, is still exiting

Worker notes, 2026-10-15. Spec 001 D12, read with `tasks/001-395/notes.md`. Done with 001-393 in the same files. Vitest 5.0.3, Node 24.21.0, a 24-CPU host at load 25 to 95 (other coordinators' runs), every run pinned to 2 CPUs beside 2 busy loops.

## What the scan sees while a fork exits

*Verified by experiment*: `phases.mjs` in this folder. A Node child at `nice` 10 holds a heap of N MB, spawns a sleeper, and exits after 300 ms. The probe polls the child's stat, flags, environ and thread count, and the sleeper's ppid. Each line below is one state change; the last states of each run are shown.

- **Leader first (`Z`, 2 threads).** The leader shows `Z` while another thread frees the memory, and the sleeper still names the fork. This lasted 0.5 to 1.7 s at 300 to 600 MB. `statOf` already returned `null` for `Z`, so the fork was out of the snapshot. The sleeper was then not a descendant, and was taken as an orphan with an unnamed parent: 001-395's window.
- **Leader last (`R`, `PF_EXITING`, 1 thread).** The leader itself frees the memory: state `R`, flag `PF_EXITING` (0x4 in stat field 9), environ unreadable (`EACCES`), and the sleeper still names the fork. This lasted **0.55 s at 300 MB and 1.08 s at 600 MB**. `statOf` returned the fork, so the sleeper was its descendant, and `#markOf` read no mark, so the fork was not stopped either. This is the miss.
- Without a large heap, both windows are a few milliseconds (001-395's table).
- `#workersGone` ended its wait when `statOf` turned `null`, at the start of the first window, or at the 1 s grace. Neither waited the second window out.

## The fix

`src/core/daemon/terminate.ts` and `src/core/daemon/escaped.ts`:

1. **`statOf` leaves out a process whose exit has begun**, `PF_EXITING` as well as `Z` and `X` (`lifeOf` reads both). The snapshot never links through a dying process, so its unmarked children in the daemon's group count as orphans, as they will be once its last thread is gone. `terminate` neither names nor signals a dying process, which could not run its handler anyway.
2. **`#workersGone` waits until the fork is gone, every thread of it** (`exited`: pid free or reused, or a zombie whose `task` lists the leader alone). Its children are then the reaper's at the scan, which closes 001-395's unnamed-parent window, except when the exit straddles the grace.
   - It finds the daemon's children with `childrenOf` (`/proc/<daemon>/task/<tid>/children`), which lists the dying too.
   - A child that is already exiting reads no mark, so it is waited for whatever its lane.
3. **The bound** is the grace, 1 s from the start of the wait, as D12 says. At the bound:
   - a fork still running is stopped with the first round, as one still there was before;
   - a fork still exiting is no link to the daemon, by (1), so its children are taken in the first round, named with the fork's pid and no command line, a form 001-395's pattern already accepts;
   - in both cases the next round runs only once what the first stopped is gone, as (4) describes.
4. **Each round waits, up to the grace, until what it stopped is gone, every thread**, before the next scan. Before, the next scan ran as soon as `terminate` returned, so a killed fork still in its exit kept its children as descendants. In the common case this wait is one stat read per process: what `terminate` waited for is already gone.

Worst case, added to a tier's stop: up to 1 s per round for a process that will not finish exiting, 3 rounds at most. Past that, a child still under an exiting process is left to the daemon's exit stop, which takes group members whether or not they are descendants.

## The reproduction

`repro.sh <tree> <runs> <heap MB> [log dir]` copies `escaped.test.ts` to `test/daemon/escaped-heap.repro.ts`, outside the suite's include, and runs it with Vitest on `taskset -c 0-1` beside 2 busy loops. In the copy, the fixture's test holds a touched 400 MB `Buffer`, so the fork's exit runs long. The before tree is `git archive` of 956cba88 with `node_modules` linked. `arms.sh` alternates the two trees run by run, so both see the same host load.

| arm | host load | before (956cba88) | after |
|---|---|---|---|
| sequential | 57 to 94 / 44 to 75 | 8 of 12 failed (4 "both sleepers gone after the tier not met", 4 reason not kept) | 0 of 12 |
| before alone, logs kept | 28 to 52 | 1 of 8 failed ("not met") | |
| alternating pairs | 28 to 52 | 3 of 10 failed ("not met") | 0 of 10 |
| **all** | | **12 of 30 failed, 8 of them the orphan left running** | **0 of 22** |

- "Not met" is the miss: `plain`, the unmarked orphan, still alive 10 s after the tier.
- The 4 failures of the first arm had no reason kept; the script did not keep logs then. At that load they could be the miss or the test's own timeouts.
- In the alternating pairs, 3 of 10 against 0 of 10 is a gap of 30 points: large, unconfirmed (one-sided Fisher p ≈ 0.11). All runs pooled, 12 of 30 against 0 of 22 gives p ≈ 0.0004, and 8 of 30 orphan misses against 0 of 22 gives p ≈ 0.008. The pooled arms ran at different loads, which is why the pairs were taken.
- The rate rises with host load, as 001-395 found: 4 to 8 of 12 at load 57 to 94, 1 to 3 of 10 at 28 to 52.

Which path the after runs took: 6 more after runs with `SQ400_NOTES` set, which appends each stop's note to a file. Host load 12 to 22, 6 of 6 passed.

- **5 of 6: the wait saw the fork gone.** Both sleepers name the reaper: `(parent 1049 /usr/lib/systemd/systemd --user …, 4.0 s old, SIGTERM)` and the deaf one `(… 3.7 s old, SIGKILL after 1 s)`.
- **1 of 6: the bound.** The fork was still exiting at the grace, and both sleepers were stopped in the first round, named `(parent 1503223, 3.1 s old, SIGTERM)` and `(parent 1503223, 2.8 s old, SIGKILL after 1 s)`, where 1503223 is the fork. Before the fix, this is the run that left `plain` running.

## `escaped.test.ts`, 50 runs

`loop.sh <tree> 50 <log dir>` with `CPUS=2-3`: the whole file, its 3 tests, 50 times on CPUs 2 and 3 beside 2 busy loops pinned there. It ran beside the reproduction, which had CPUs 0 and 1. Host load 17 to 60. **50 of 50 passed.**

## Proposed D12 wording

In "What tests leave running", replacing "and Vitest resolves a run before its workers exit, so the daemon's own children carrying it get 1 s to go first":

> and Vitest resolves a run before its workers exit, so the daemon's own children carrying it, or exiting, get 1 s to be gone, every thread of theirs, so that what they started is the reaper's at the scan (tasks 001-395, 001-400). A process whose exit has begun (a zombie, or `PF_EXITING`) is no link to the daemon: its children in the daemon's group count as orphans. What the wait leaves is stopped with the first round, and each round waits up to 1 s for what it stopped to be gone before the next scan.

## For the next worker

- `escaped.ts` is 407 lines, over the styleguide's ~300; it was 380 before this row. The module-level process-table helpers (`snapshot`, `strangersOf`, `lineOf`, `descendantsOf`, `gone`, `key`) would split out cleanly beside `lifeOf`, `exited` and `childrenOf` in `terminate.ts`. That is for a quality scan, not this row.
- No committed test reproduces the miss without contention. Holding a fork in its kernel-side exit takes a large heap and a starved CPU; `repro.sh` is the check, and `escaped.test.ts` is the guard that it stays fixed.
