# The revert-restore current PASS seen again after 001-264

Research task 001-343 for spec 001, 2026-10-13. The coordinator's landing gate for 001-335 (`/tmp/sq-int-335`, main 47ec9ee5 plus two scheduler-test commits, 0.1.151, `npx vitest run --maxWorkers=4`, host load about 80, 936.86 s, 1 failed of 466 files) read `[ 'current pass', 'current pass' ]` at `test/integration/revert-restore.test.ts:195`. The file passed 5 of 5 alone straight after. The gate's store is gone. Its log was not at the path the brief names; the copy at `/tmp/sq335-gate.log` (39 lines) holds only the assertion. Linux 6.8, 24 CPUs, Node 24.21.0, Vitest 5.0.3, Vite 8.3.2. Experiments ran on scratch copies of this branch outside every worktree, one with `sources.ts` as before this row (`unfixed`, 5fadbea8) and one as at 97350b49 (`fixed`). An earlier researcher on this row (cezar run 53a4ec09) found the in-flight gap and committed 9dcec7f8 and f0fafaed before its session failed on a model error. Its scratch data was deleted. The numbers this file cites from it are read from that session's log, not re-run, and are tagged so. Probes: `probes/revert-restore-pass-2/` (throwaway).

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Which sequence stores a PASS line 195 reads as the armed run's? | Two sequences. **Route A**: the watcher sees one write of `test/reverting.test.ts` as two revisions, its truncation and then its bytes. The armed run starts at the empty file's key and loads the bytes. It is dropped correctly. The second revision re-keys the file, and an unarmed run of it passes and is stored current. Line 195 reads that pass. **Route B**: a runner-part `invalidate` lands while the run's transform of `src/mod.ts` is in flight. The run is kept with the reverted bytes' result. Line 195 can see route B only through 001-182's unobserved precondition. | verified by experiment |
| 2 | Is it a real stale current PASS? | Route A is a test artefact: the stored pass is the restored bytes' own, what a fresh run gives. Route B is a real D6 defect, independent of this test: a result from bytes no key names is stored current. 9dcec7f8 closes it for one load. 97350b49 closes the case where a second load of the module in the same run replaced the stamp. | verified by experiment |
| 3 | Which route was the gate's? | Not determined, because the store is gone. Route A needs only a split write under load and gives the exact sighting. Route B needs a `src/mod.ts` revision at or below `at` landing in a 2 to 43 ms window, which was never observed in 001-182's 151 runs or here. Route A is the likelier. | inferred |
| 4 | How rare? | Route A: the test-file write split by itself once in 210 repetitions (load 11 to 104), and that once line 195 passed. Forced, it fails line 195 7 of 8 times. Route B unfixed: 3 kept armed runs in 188 under starvation (load 67 to 137), all stored current pass, none at line 195 (earlier session). Here, 0 in-flight windows in 144 starved repetitions; the 4 windows seen, all with the module cached, were dropped. Line 195 failed 0 times in 210. | verified by experiment; read in the earlier session's log |
| 5 | Is 9dcec7f8 right, and does it cost a valid run or time? | Its test is red 3 of 3 with its `sources.ts` change reverted and green 3 of 3 with it. It had a gap, fixed in 97350b49. It cannot drop a run whose bytes are still on disk. It can drop a run needlessly only where cached modules already could. Its loop costs 0.3 to 2.3 ms of a 27 to 155 ms end check at 2,000 to 5,000 modules. | verified by experiment; read in source code |

## Findings

### 1. Route A: a split write of the test file re-runs it unarmed

The test plants an attempt when the run loaded `old` and no revision after `at` names `src/mod.ts` (`revert-restore.test.ts` before 85a86212). It does not check how many revisions name the test file. `writeFileSync` truncates and then writes. The watcher's batch closes after 100 ms quiet (`WATCHER_TIMINGS.quietMs`, D2). A writer stalled for more than 100 ms between the two therefore makes two revisions, the empty file's and the bytes'. *Read in source code, f0fafaed.*

Instrumented, with the split forced (`SQ_PROBE_TRUNC_MS=0`, load 69.5 at the start; `results/out-trunc.txt`, times in ms from the write):

```text
160  revision 1: test/reverting.test.ts → e69de29 (empty)
189  run bc0e0342 starts at revision 1's key
315  the bytes written                 501  revision 2: test/reverting.test.ts → 54fb6cc
7518 stamp src/mod.ts 74ee262e (the reverted bytes; the worker loaded the file 7 s late)
7574 run-end: ran [src/mod.ts], completed [] → dropped, `unknown` at revision 1's key
7817 run b708ac08 at revision 2's key, ARM gone: the test returns early
8824 run-end: completed, pass → stored current at revision 2
```

The armed run is dropped as 001-146 and 001-264 intend. The pass line 195 reads is b708ac08's, a run of the restored bytes with no `ARM`, the same as `freshRun` would give. Nothing stale is stored. *Verified by experiment.*

Made deterministic (`SQ_PROBE_GATE=1`): a setup file holds the truncation's run until the bytes' revision has landed, then lets it load the test file. On the test as it was, line 195 failed 7 of 8 times (load 31.9 to 42.6, `results/out-gate-old.txt`). In each failure, the current pass came from the unarmed run at revision 2. The eighth run heard a touch of the test file and stored nothing. On the test as fixed in 85a86212, which plants only when one revision names the test file and none the module, attempt 1 is not planted, attempt 2 is planted, and line 195 passed 3 of 3 (`results/out-gate-new.txt`). *Verified by experiment.*

How often the write splits by itself: once in 210 repetitions here. 66 ran beside this branch's full suite and two other coordinators' suites (load 35 to 60, `results/L1-*.txt`), and 144 ran 6 at a time pinned to 4 CPUs beside 8 busy loops pinned there (load 11 to 104, `results/H1-*.txt`). The one split (H1, fixed copy, repetition 6c3abbb0 attempt 3) did not fail line 195: its run started after the second revision, so the armed run was at the bytes' own key and nothing re-ran it. The earlier session timed `open(O_TRUNC)` and the write after it, 20,000 times each at load about 100. The open alone took over 100 ms 12 times. With 4 `fsync` loops beside it on the same ext4 `/tmp`, where the gate's fixtures were, the whole write took over 100 ms 328 times. The write after the open never took over 3.8 ms. *Read in the earlier session's log.* Whether a stall inside the open falls before or after the truncation's event is not determined. The gate's load (about 80) and journal pressure from a full suite of daemons are the conditions where it can. *Inferred.*

### 2. Route B: an invalidate while the run's transform is in flight

001-264 keeps, at a mid-run `invalidate`, the stamp of every module with a cached transform (`SourceStamps.hold`). Vite 8.3.2's `doTransform` caches its result only if `timestamp > mod.lastInvalidationTimestamp` (`node_modules/vite/dist/node/chunks/node.js:20027`). It still returns the result to the caller. An `invalidateModule` while the transform is in flight therefore leaves the module uncached for good, and the run executes it. `hold` found nothing cached, and the end check's loop over cached modules found nothing either. The run was kept, and its result stored under a key that does not name `src/mod.ts`. *Read in source code; verified by experiment.*

The earlier session's instrumented log of one kept armed run (repetition 598790e3, load 77 to 69, times from the stamp): `+0 stamp src/mod.ts 74ee262e`, `+5 invalidate [src/mod.ts]` with `hold` seeing the module uncached, `+13` transforms dropped, `+36` restored, then `run-end ran [] completed [reverting.test.ts]` and `apply pass`. In its starvation rounds (8 copies pinned to 2 to 4 CPUs beside busy loops), 3 of 188 armed runs were kept this way, and all 3 were stored as current pass. None failed line 195: each kept run was in an attempt where a revision named `src/mod.ts`, so the attempt was not planted, and the next attempt replaced the state. *Read in the earlier session's log.*

Here, two sets on both copies (`unfixed` before 9dcec7f8, `fixed` at 97350b49), same test as it was:

| Set | Copy | Repetitions | Load (1-min, at start) | Armed runs | Mid-window `src/mod.ts` invalidates | In flight | Kept | Line 195 failed |
|---|---|---|---|---|---|---|---|---|
| L1: 2 copies per variant beside 3 full suites | unfixed | 34 | 35 to 60 | 34 | 0 | 0 | 0 | 0 |
| L1 | fixed | 32 | 35 to 60 | 32 | 0 | 0 | 0 | 0 |
| H1: 6 copies pinned to 4 CPUs beside 8 pinned busy loops | unfixed | 72 | 11 to 93 | 72 | 0 | 0 | 0 | 0 |
| H1 | fixed | 72 | 14 to 104 | 76 | 4 | 0 | 0 | 0 |

L1 and H1 count the repetitions that reached line 195's dump. In L1, 2 more failed at `freshRun` (exit 1) at 22:36:57 while the worktree's `node_modules` was being reinstalled (Recommendation 4), and the 94 started after it could not load Vitest; none is counted. The 4 windows in H1 `fixed` came from a revision naming `src/mod.ts` (the watcher split the module's revert from its restore), with the module cached: 001-264's case, all dropped. No in-flight window occurred in 144 starved repetitions, so route B's rate here is below about 2 % per armed run (3 in 148, 95 %). The earlier session saw it 3 times in 188 under heavier starvation (2 CPUs, 12 busy loops). *Verified by experiment.*

The adapter test 9dcec7f8 added (`overlap.test.ts`, "drops a file whose run read bytes a mid-run invalidate dropped while their transform was in flight") holds the transform in a plugin until the driver has invalidated. With 9dcec7f8's `sources.ts` change reverted, it failed 3 of 3 (`expected [ { project: '', …(1) } ] to deeply equal []`: the file completed). With the change, it passed 3 of 3, beside its twin where the bytes are unchanged and the run completes. *Verified by experiment.*

### 3. A gap in 9dcec7f8, fixed in 97350b49

9dcec7f8 compares every stamp in the container's map loaded since the run began. But the map holds one stamp per module ID, and a module dropped in flight is never cached. The next load of that ID in the same run, for example a second test file importing the module after the restore, reads the file again, and `#stamp` replaces the in-flight read's stamp with the restored bytes. The end check then compared only those. The adapter test 97350b49 adds runs a second file that imports the module after the restore. It failed 3 of 3 on 9dcec7f8: both files completed, the first with its FAIL from the reverted bytes. 97350b49 keeps a replaced stamp whose hash differs from the new read, or whose file is gone, for the run's end check. The end check compares it and lets it go. The test then passed 3 of 3, and all 8 tests of `overlap.test.ts` passed 3 of 3. Key format 9 is re-pinned (d4ddc13d, unreleased). *Verified by experiment.*

### 4. What the added checks cost

**False drops.** Both added checks compare a stamp with the disk as the cached-module check does. A stat equal to the stamp's skips the hash. Equal bytes keep the run. So a run whose bytes are still on disk is never dropped (the twin test, and the 001-264 twin). A changed file drops the run when the stamp was read since it began, whether the run or a runner-part call read it. The cached-module loop already does the same for every cached module, so no run is newly dropped that a cached read would have kept. The new case is a module whose transform failed (a syntax error), then was fixed during a run. Then `mayHaveRun` drops the files that reach it, or every file of the run if none does. That costs one re-run and never stores a stale result. Across the 186 end checks of `test/runners/vitest` (28 files, 165 tests, all passing), the 9dcec7f8 loop added a check 7 times: `test/bad.test.ts` and `test/syntax.test.ts` twice (failed transforms, bytes unchanged, kept), and `src/mod.ts` 4 times (the 001-264 and 001-343 tests) (`results/adapter-suite-loop.json`). *Verified by experiment; read in source code.*

**Time.** The loop visits every stamp of every container once, and adds a check only for an uncached read since the run began. A test file loading 200, 2,000 and 5,000 modules, three runs each (`end-check-cost.test.ts.txt`, `timing.patch`):

| Modules | Loop | Whole end check, first run / unchanged rerun |
|---|---|---|
| 200 | 0.09 to 0.12 ms | not timed |
| 2,000 | 0.33 to 0.66 ms | 98.6 / 27.4 to 28.9 ms |
| 5,000 | 0.52 to 2.31 ms | 154.7 / 68.9 to 73.9 ms |

The loop added no check in any of these runs: every raw sample records `added: 0`. The timing patch measures 9dcec7f8's stamp scan only, not 97350b49's `#replaced` loop. So these samples support the observed scan times above, not a bound on every end check, and none had an uncached addition or a replacement-heavy run. *Verified by experiment, load 10 to 17.*

By source inspection (review 001-353, `reviews/wave-13bi.md` N1), the work the two fixes add to an end check is O(S + R): S is the stamps retained across the active containers, R the reads replaced since the previous end check. The added checks share the end check's one stat and at most one hash per file. Changed repeated loads of a module can grow R; a reload with an equal hash adds no entry. Both collections are filtered by the run's load time, and the end check clears the replacement list. *Read in source code.*

## Recommendation for Squeal

1. Land 97350b49, d4ddc13d and 85a86212 with 9dcec7f8 and f0fafaed as this row. Route B is a real stale result. The two fixes are small, local to `SourceStamps`, and test-first. The measured stamp scan took under 3 ms at 5,000 modules; those runs had no uncached additions, so they do not bound replacement-heavy work, whose added cost is O(S + R) as above.
2. Keep line 195's assertion. 85a86212 only stops a split attempt from counting as planted, the way a `src/mod.ts` revision already did. The test then spends another attempt, as 001-182 recommendation 3 already noted for split restores.
3. No product row for route A. Squeal behaved as specified: the run of the empty file's key was dropped, and the bytes' key got a run of its own.
4. Probe-isolation note for the coordinator: at 22:36:42 this worktree's root `node_modules` was removed and reinstalled, and the tracked `test/fixtures/node-test/*/node_modules` symlinks were deleted, by no command of this session. The coordinator reports it host-wide. The suite then running was stopped, the fixtures restored, and the suite re-run.

## Open questions

- Whether the gate failed through route A or route B. A repeat sighting needs the store kept. `make-probe.py`'s dump before line 195 is the template.
- How often a `writeFileSync` splits into two revisions at the gate's load. 66 repetitions at load 35 to 60 never split. The earlier session's stall timings show stalls over 100 ms around the truncating `open`, but not on which side of the truncation's event.
- Whether any path other than a mid-run `invalidate` leaves a module uncached after a run read it. Vite's `_pendingRequests` path (`node.js:19871-19877`) aborts a pending transform and starts another when its module was invalidated since it began. What the first caller then receives was not read or probed.

## Sources

- `src/runners/vitest/sources.ts` (`SourceStamps.#stamp`, `hold`, `stale`), `src/runners/vitest/adapter.ts:265-298` (`#invalidate`), `:381-455` (`run`), `src/runners/vitest/moved.ts` (`mayHaveRun`), `src/core/watcher/debounce.ts`, `src/core/types/watcher.ts:12-13`, `src/core/scheduler/scheduler.ts` (`#fly`), all at f0fafaed; `test/integration/revert-restore.test.ts`, `test/runners/vitest/overlap.test.ts`.
- Vite 8.3.2 `node_modules/vite/dist/node/chunks/node.js:19867-19880` (`transformRequest`, pending requests), `:20027` and `:20075` (cache only if not invalidated since), `:36444-36460` (`invalidateModule`).
- `research/revert-restore-pass.md` (001-182); board rows 001-264, 001-343.
- The earlier session's log: `.ai/cezar/runs/53a4ec09-f81d-4314-8a09-3dac727bcda4.ndjson` (local to this host, not in the repository).
- Gate log: `/tmp/sq335-gate.log` (local to this host).
- Probes: `probes/revert-restore-pass-2/` (`README.md`, `instrument.py`, `make-probe.py`, `analyze.py`, `rounds.sh`, `end-check-cost.test.ts.txt`, `timing.patch`, `results/`).
