# 011-183: an edit made while the daemon replaces its watcher is lost until the idle pass

Worker fa53fd07, coordinator 04a258b0, from main at e65bfa813, 2026-10-24. Shape: slice. Seam: `test/daemon/hold.test.ts` case 2 and `editRecorded`. The coordinator agreed to the watcher fix and its test (request 7bcc3093, decision (a)).

## The cause

The change feed lost the edit while the chokidar backend replaced its watcher, and only the idle pass found it, 30 s later. Case 2 waits 30 s.

1. Case 2's hold cancels the fixture's first Vitest run. Vitest then writes its results cache, `node_modules/.vite/vitest/<hash>/results.json`, into the fixture root. The fixture has no `node_modules` of its own (Vitest resolves from the repository's), so this is its first ignored directory. It appears about 100 to 300 ms before the edit: the wrapper starts the command once the cancel settled, and the test edits once the command's pid is recorded.
2. `ChangeFeed.onDebounced` (`src/core/watcher/change-feed.ts`) sees an ignored directory the spec does not exclude and calls `rebuildSpec`. The new spec excludes `node_modules`. `chokidarBackend.update` (`src/core/watcher/chokidar-backend.ts`) opens a new watcher (W2) for a spec that excludes more, awaits its `ready`, and closes the old one (W1).
3. chokidar 5.0.0 (`node_modules/chokidar/handler.js`, `_handleFile`) attaches each watcher's listener to a path when that watcher's scan reaches the path. A file's change listener awaits `stat(file)` and then returns at once when its watcher is closed (`if (this.fsw.closed) return;`).
4. If the edit's event reaches W1 while W2 still scans `src/`, only W1's listener hears it, and it starts its `stat`. If W2 finishes and W1 closes before that `stat` returns, W1 drops the event. W2 attached after the event, so it never reports it.
5. Before this row `rebuildSpec` answered true only when a path was no longer excluded, so a rebuild that excluded more ran no reconciliation pass. The next pass was the idle one, `armIdle`'s 30 s after the last hint or batch. The `node_modules` batch was the last one, so that pass came about 30 s after the edit, at case 2's bound.

The window is the last fs operations of W2's scan, so it needs a descheduled threadpool thread on a loaded host. The failure fits it. Main CI 40107613445, attempt 1, Node 22 (2/3): case 2 failed after 92,314 ms at `editRecorded`, "the edit's revision not met in 30000 ms". That is about 2 s to the edit, 30 s of wait, and 60 s for the daemon's stop (below). The diagnosis showed the daemon serving and the hold already ended, which a lost event explains: nothing in the daemon was stuck.

## Evidence

- **The directory appears before the edit.** Case 2 with the fixture listed at each step: at `ready` the root holds no `node_modules`; when the command's entry appears it holds `node_modules/.vite/vitest/da39a3ee5e6b4b0d3255bfef95601890afd80709/results.json`; the edit follows within about 20 ms.
- **The loss, forced.** `probe/race.ts` drives the real change feed and chokidar on a scratch repository. It wraps `fs/promises` (`syncBuiltinESMExports`): W2's `lstat` of `src/math.ts` makes the edit and returns 30 ms later, and a watcher's `stat` of that file returns 150 ms late. Results on e65bfa813:
  - `armed`: swap begins at 564 ms, edit at 567, W1's listener `stat` begins at 568, swap done (W2 ready, W1 closed) at 600. No batch for the edit within 3 s.
  - `armed` with `WAIT_MS=33000`: swap done at 661 ms; the edit's only batch is the idle pass's `interval` batch at 30,677 ms, 30.0 s later.
  - `control` (edit after the swap): the edit's `watch` batch 110 ms after it.
  - `armed` with the fix: the edit's `watch` batch 13 to 16 ms after the swap.
- **Unforced, it did not reproduce here.** None of 32 case 2 runs before the fix failed: 5 plain, 3 pinned to one CPU (`taskset -c 0`), 11 with 0 to 2,200 ms between `ready` and the hold, 6 with the daemon paused (SIGSTOP for 800 ms, 0 to 200 ms after the wrapper's kill), 4 on Node 22.23.3, and 3 traced. At the feed level, 52 swaps with the edit at offsets of 0 to 370 ms, 40 of them beside writes into the tree, lost none. The last ten swaps took 2 to 14 ms each.

## Ruled out, with evidence

- **The scheduler lock.** Temporary trace lines in `src` (reverted, never committed) in 3 runs: the edit's `watch` batch took the lock in under 1 ms and committed its revision 16 to 27 ms later. `Scheduler.commandHold` takes no lock, and the hold changes neither the feed nor the stat cache.
- **`refreshInstall` under the lock.** Vitest's cache creates `node_modules/` in the root, which the install stamp reads. But `entriesPart` (`src/core/scheduler/install-stamp.ts`) reads a `node_modules` holding only dot entries as missing, so the stamp does not move. The trace showed no `refreshInstall`.
- **A stuck feed or a hung git.** A stuck feed records no revision at all. A lost event recovers at the idle pass, which the probe showed at 30.0 s. The CI diagnosis cannot tell these apart (no later read), but nothing in the daemon's notes or stderr pointed at a stuck pass.

## The fix

`rebuildSpec` (`change-feed.ts`) answers true whenever it updated the watch, so `onDebounced` runs its existing `reconcileNow("watch")` after every spec change, as it did only after one that narrowed the exclusions. The caller's `widened` is now `rewatched`. Commit c75ecc73e, with `test/watcher/rewatch.test.ts`: a Linux backend whose `update` writes `src/a.ts` and drops that file's hints from then on, as the swap did; after `build/` appears, the feed must deliver a batch with `src/a.ts` at its new size. It fails on e65bfa813's `change-feed.ts` ("condition not met in 10000 ms": the test file at its final text, run with that one file put back in a held worktree) and passes with the fix in about 1 s.

Decision the spec did not settle: reconcile after every watch change, not only after a backend replaced its watcher. The feed does not know which backend update replaces a watch. The other update path, `watcher.add` with `ignoreInitial`, also cannot report a change made between the spec's build and the add.

The pass reconciles what the watch could not report. The edit is found by its re-stat (the stat cache) and by git status. It is a `watch` batch, so it does not read the merge hold's index as an `interval` pass does.

### Cost

One `reconcileNow("watch")` pass, measured with `probe/cost.ts`: the real feed with a backend that watches nothing, read-only, with every tracked file (`git ls-files`) as the stat cache. That is probably more paths than a daemon's cache holds (files outside every closure, docs among them, count here), so it is an upper bound for that step. Five passes each:

| Tree | Tracked | Passes (ms) | Median | Load (1 min) |
| --- | --- | --- | --- | --- |
| this worktree | 7,398 | 531, 744, 676, 716, 670 | 676 | 27.0 |
| this worktree, again | 7,398 | 468, 449, 462, 499, 341 | 462 | 25.8 |
| main checkout (21 exclusions, nested worktrees) | 7,397 | 719, 448, 690, 655, 711 | 690 | 27.0 |
| `cezar` | 2,883 | 143, 101, 131, 119, 133 | 131 | 27.3 |

The scheduler's part of that batch is not measured. With nothing changed it compares stats and hashes nothing. A pass costs about the same as one idle pass. The swap it follows already re-scans the whole tree.

Events that change the spec, and so now run a pass:

- A new directory that git lists as ignored (`git ls-files --others --ignored --exclude-standard --directory`): `dist/`, `coverage/`, or `node_modules/.vite` in a project without `node_modules`. A directory below an ignored one that git does not list is recorded once (`UnlistedDirs`) and rebuilds nothing again. One inside an excluded directory makes no event at all, so a project whose `node_modules` exists sees no pass from Vitest's cache.
- A change of `.gitignore`, or of a `.git` entry (a nested repository or worktree created or removed), that changes the listing (`SPEC_INPUTS`).

Not: `setExtraFiles`, which ignores its rebuild's answer, and the start and idle passes, which reconcile anyway.

## The test

`hold.test.ts` keeps case 2 on the watcher path (the coordinator's decision): with the fix it is the end-to-end guard of this bug. One change, commit 35c9ae89e: the held tests are released in a describe-level `afterEach`, before the suite's own `afterEach` stops the daemons. The release was a suite cleanup, which runs after the stop, and a daemon's stop waits for the held test's tier. So each of the four tests spent 60 s in its stop, until `stopProcess`'s SIGKILL. Case 2 now takes 12 to 16 s here, down from 72 s. The file took 301 s on CI.

Case 2, 20 runs in a row at c75ecc73e plus the release, each inside `squeal hold` so that Squeal's own runs did not run beside it: `env -u PLUGIN_ROOT -u PLUGIN_DATA npx vitest run test/daemon/hold.test.ts -t "2:"`. All 20 passed, in 12 to 16 s each. The load average before each run (1, 5 and 15 min):

| Run | Load | Run | Load |
| --- | --- | --- | --- |
| 1 | 21.11 19.77 21.29 | 11 | 22.73 20.59 21.35 |
| 2 | 20.57 19.72 21.24 | 12 | 21.42 20.41 21.28 |
| 3 | 21.25 19.92 21.29 | 13 | 23.84 21.01 21.46 |
| 4 | 19.30 19.55 21.15 | 14 | 22.25 20.80 21.38 |
| 5 | 17.80 19.18 21.00 | 15 | 21.15 20.61 21.31 |
| 6 | 18.61 19.29 21.01 | 16 | 18.50 20.04 21.11 |
| 7 | 20.28 19.61 21.09 | 17 | 18.49 19.96 21.07 |
| 8 | 21.67 19.94 21.18 | 18 | 17.72 19.74 20.99 |
| 9 | 23.06 20.31 21.28 | 19 | 15.34 19.12 20.76 |
| 10 | 25.16 20.93 21.47 | 20 | 15.07 18.91 20.67 |

The 1-minute load went above 24 only around runs 9 and 10. The row's "beside load above 24" therefore holds for those runs only, and CI on the candidate is the other check. The runs do not exercise the race itself, which did not reproduce unforced. `rewatch.test.ts` and `probe/race.ts` do.

## For whoever continues

- **Spec text.** Spec 001 D2 names the reconciliation passes: the daemon's start, every 30 s when idle, and a backend error or dropped events. This row adds "after every change of the watch spec". That is an amendment for `status.md`.
- **A comment not in this row.** `chokidar-backend.ts`'s "the change feed reconciles after exclusions shrink" is still true but now partial: the feed reconciles after every update.
- **The daemon's stop.** SIGTERM waits for the tier in flight. A test that leaves a long test running pays `stopProcess`'s 60 s. I did not check whether other daemon tests leave held tests running at their stop.
- **Case 1** has the same edit-near-swap timing and is covered by the same fix. Cases 3 and 5 make no edit during a swap.
- **The window is wider than the hold.** Any edit made while a new ignored directory appears in a watched project was exposed: a build writing `dist/` while the agent edits, for example. The hold test only made the timing regular.
- **Seam map.** The edit's path is chokidar's listener, then `Debouncer` (100 ms quiet, 500 ms at most), then the feed's one-at-a-time queue (`enqueue`), then `Scheduler.handleBatch` under its lock, then `reconcileBatch`. `armIdle` is pushed back by every hint and every queued task. chokidar shares one `fs.watch` per path across watchers (`FsWatchInstances`); a watcher's close removes only its own listeners.
- **The trace lines** used for "Ruled out" are in no commit. They were appends to a scratch file in `Scheduler.#handleBatch`, around the pump's `refreshInstall`, in `commandHold`, in the adapter's `environment`, `#start` and `#recreate`, and before `reconcileBatch`'s transaction.
