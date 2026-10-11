# The revert-restore current PASS seen once in a full gate

Research task 001-182 for spec 001, 2026-10-11, from `reviews/wave-13h.md` Verification. In that review's single full gate (78f51e6, `--maxWorkers=4`, 915 s), `test/integration/revert-restore.test.ts:195` read `[ 'current pass', 'current pass' ]` for `test/reverting.test.ts` after a run had loaded the reverted `src/mod.ts` and no revision named it. Linux 6.8, 24 CPUs, Node 24.21.0, Vitest 5.0.3, Vite 8.3.2. Experiments ran on an instrumented copy of `dfee8c70` (this branch's base) in a scratch directory outside every worktree. `src/runners/vitest/sources.ts` and `moved.ts` are byte-identical at 78f51e6 and `dfee8c70` (`git diff 78f51e6 HEAD` is empty for both), and `adapter.ts` differs only in the optimizer note (001-181) and the version constant's file. Probe: `probes/revert-restore-pass/` (throwaway). Every repetition records the load average beside it.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Which sequence stores the armed run's PASS as current? | One sequence: a runner-part `invalidate` that names `src/mod.ts` lands while the run holds the reverted bytes. Its pre-check finds the bytes unchanged, so nothing is logged. It then hard-invalidates the transform, and the run's own check after it ends sees neither a cached module nor a logged move. The run is kept, and its result is stored under a key that lacks `src/mod.ts`. Deterministic at the adapter. In the daemon, every forced split attempt stored it. | verified by experiment; read in source code |
| 2 | Can that sequence fail line 195, which needs no revision after `at` to name `src/mod.ts`? | Only if a revision numbered at or below `at` names `src/mod.ts` and its runner part lands inside the next armed run's revert window, which lasted 2 to 43 ms in all 190 unforced attempts. That needs a split earlier attempt whose restore batch commits between `settle` returning and the next `at` read. It was never seen in 57 repetitions with a split. In 37 of the 57, the late restore batch joined the next attempt's write, above `at`, so that attempt was not planted. | verified by experiment; inferred |
| 3 | Does anything else keep or re-run the armed run? | Nothing found. An armed run with no mid-window `invalidate` was dropped every time (see the counts below). A dropped file stays `unknown` until its key moves (`Ledger.markUnknown`). The touch that follows a folded revert only flags the instance for replacement. Vite's own watcher is closed (`watch: false`), and the baseline lists before `ready`, so `settle(root, -1)` cannot pass with the first run still to come. | verified by experiment; read in source code |
| 4 | How rare is the gate's failure? | Not reproduced: 0 in 151 instrumented repetitions, 94 of the test as it is and 57 with a forced split. Load at a repetition's start ranged from 3.8 to 47.2, and the host peaked at 71.2 during the gates. 16 of the repetitions ran inside 2 full gates. By the rule of three, the failure is below about 2 % per run (3 in 151, 95 %) at these loads. 13h did not record its gate's load. | verified by experiment |
| 5 | Is it a real stale current PASS? | The mechanism is real and stores a wrong current result: the adapter probe stores FAIL from the reverted bytes for a file whose fresh run passes. The gate's own sighting cannot be tied to it, because its run records are gone and the needed precondition was never observed. | verified by experiment |

## Findings

### 1. The run's own check loses a stamp a mid-run invalidate drops

`SourceStamps` (001-146) stamps each project file in Vite's `load` hook. After a run, `stale(vitest, loadedSince)` checks every *cached* module loaded since the run began, and names a file whose bytes on disk differ from its stamp (`sources.ts:136-210`). A runner-part `invalidate` during the run (001-150) first calls `stale()` to log what moved (`adapter.ts:283-285`), then `vitest.invalidateFile` for each changed path (`adapter.ts:288`). *Read in source code, `dfee8c70`.*

If that `invalidate` lands after the run read the reverted bytes and before the test file restores them, the pre-check compares the stamp to a disk that still holds the same bytes, so it logs nothing. `invalidateFile` then hard-invalidates the module: `invalidationState` becomes the string `HARD_INVALIDATED`, so `cachedTransform` returns `null` and `cachedModules` skips it. The end check has nothing to compare, `#moved` is empty, and `ran` is `[]`. The run's report keeps the file. The scheduler stores it, because the file's inputs (`snap`, the test file, `vitest.config.ts`) do not include `src/mod.ts`. The revision during the run (`Tier.changes`) therefore never matches an input. *Verified by experiment.*

Instrumented log of the first forced-split attempt (`out-split`, load 12.1, times in ms from the daemon's first event):

```text
544  armed (attempt 1)          548  stamp src/mod.ts hash 74ee26… (the reverted bytes)
664  batch → revision 2 names src/mod.ts
665  invalidate [src/mod.ts change] running=true
666  stale(): src/mod.ts cached, moved=null       667  stale(): src/mod.ts HARD_INVALIDATED
2054 restored                   2058 stale(loadedSince): checks [], pending [] → ran []
2058 run-end completed [test/reverting.test.ts]   2076 fly: duringRun [src/mod.ts], inputs lack it
store: results key c66d33… outcome pass, run b9fa23b5 (the armed run), current at that revision
```

The adapter-level probe makes it deterministic (`midrun-182.test.ts.txt`, fixture `basic`). The test file reverts `src/mod.ts`, imports it by a computed specifier, writes a marker, and waits for a go file. The driver then calls `adapter.invalidate([{ path: "src/mod.ts", kind: "change" }])`, writes the go file, and the test restores the module and asserts `which === "new"`:

```text
{"midRun":true, "completed":[{"path":"test/held.test.ts"}], "outcomes":["fail"], "failure":null}   × red
{"midRun":false, "completed":[], …"changed on disk after this run loaded it"…}                      ✓
```

A fresh run of `held.test.ts` against the restored disk passes. The kept report is a FAIL that no fresh run gives, which is 001-146's incident shape. It failed the same way all 5 times it ran: alone, twice beside `test/integration` at `--maxWorkers=4` (load 9.8 and 12.3), and once in each full gate. *Verified by experiment.*

The gap needs both of these: (a) the run loads the file without the test file's closure holding it (a computed `import()`), because otherwise the D5 stability check discards the run through `Tier.changes`; (b) a revision names the file while the run holds the bytes it read, and the bytes move again before the run ends. For example, a rebase whose pick restores a file a test loaded by computed import after `checkout` reverted it, when the watcher split the two. *Inferred from the code paths above.*

### 2. The integration test, repeated

Each repetition is one copy of the test with probe logging (`rr-probe.test.ts.txt`). Every adapter call, stamp, stale check, batch and tier record of its daemon is logged, and so are the test's armed, restored and attempt events. At the end, the repetition dumps the store's revisions, runs, results and known states. `analyze2.py` sorts every armed run as kept or dropped, records whether a `change` invalidation of `src/mod.ts` landed in its revert window, and finds late `src/mod.ts` revisions numbered at or below the next attempt's `at`.

| Set | Concurrency | Repetitions | Load (1-min, at start) | Attempts | Armed runs | Kept | Kept without mid-window invalidate | Line 195 failed |
|---|---|---|---|---|---|---|---|---|
| E1: test as is | 4 copies beside `test/integration`, `--maxWorkers=4`, 21 rounds; 1 alone | 85 | 8.7 to 20.5 | all 1 | 85 | 0 | 0 | 0 |
| E2: attempt 1 holds the reverted bytes 1.5 s (forced split) | 4 copies beside `test/integration`, 12 rounds | 48 | 5.2 to 11.9 | 2 or 3 | 131 | 48 (every split attempt) | 0 | 0 |
| E3: full gate | 4 + 4 copies of E1 and E2 in the whole suite of 376 files, `--maxWorkers=4`, 2 gates (540 s, 445 s) | 16 | 3.8 to 47.2 (host peak 71.2) | 1 (unforced) or 2 to 3 (forced) | 27 | 8 (every split attempt) | 0 | 0 |
| Singles | one file alone (E1's and E2's variants) | 2 | 9.5 to 12.1 | 1 or 3 | 4 | 1 (split) | 0 | 0 |

*Verified by experiment.*

Across all sets, 247 armed runs, a run was kept exactly when a mid-window `change` invalidation landed: 57 of 57, and none otherwise. No unsplit armed run was kept. The revert window of an unforced attempt lasted 2 to 43 ms. `settle()` often returned before the watcher's batch for the restore the run had written: in 37 of 57 split repetitions, the restore's revision carried the next attempt's `reverting.test.ts` write too. That attempt was then not planted, though its run was correctly dropped, so the test spends an extra attempt. No such late revision was ever numbered at or below the next `at`. *Verified by experiment.*

13h does not record its gate's load, only the background Squeal's (47 to 75) earlier in that session. Here no unforced attempt split on its own at loads from 3.8 to 47.2. Forcing the split stands in for what more load does to the window between the two writes.

## Recommendation for Squeal

1. Fix the gap as its own row. It is a real stale result independent of the test, and it is cheap to close in the adapter. Proposed row:

   > **001-NNN (next free) a run's read stamps outlive a runner-part invalidate during it.** `/worker`, shape: repair. Brief: `research/revert-restore-pass.md` Finding 1. While a run is in flight, `VitestAdapter.#invalidate` (and anything else that drops a transform the run may have read) keeps the stamps of the modules it drops for that run's end check, and the end check compares each one against the disk as it compares a cached module's. A run that read bytes no longer on disk is not completed (001-146), whether or not its transform is still cached. Own `src/runners/vitest/sources.ts`, `src/runners/vitest/adapter.ts`, `test/runners/vitest/sources.test.ts`. Done when: the `midrun-182` probe passes as a test and is red before; a mid-run invalidate whose bytes end where the run read them still completes; 001-146's, 001-150's and 001-159's tests pass; lint, typecheck and the full suite are green.

   A coarser alternative: mark every file a mid-run `change` invalidates as moved for that run. This drops some runs needlessly (a file changed and changed back to what the run read) and never misses one.

2. Keep line 195 as it is. With the fix, line 195 no longer depends on whether a stray runner part lands in the window. Without the fix, the one route found to a failure there is this gap.

3. If the test needs work, make `settle` also wait for the watcher's batch of the run's own writes. This is optional and cuts wasted attempts. For example, wait until a revision or a touch covers `src/mod.ts` after the restore. It does not change the verdict.

## Open questions

- Whether 13h's failure came through Finding 1. Its store and run log were deleted with the scratch directory, and the precondition (a late `src/mod.ts` revision at or below `at`) was not observed in 151 repetitions. A repeat sighting needs the store kept: the probe's dump on failure is the template.
- No unforced attempt split on its own, even at load 47 inside a gate. So how often the watcher splits at the 13h gate's unknown load, the first step of question 2's route, is still unmeasured. Raising the load on purpose would have disturbed 001-258 on the same host.
- Not investigated, because it is outside this topic: gate 2 failed `test/e2e/lifecycle.test.ts` "a bad squeal.config.json, claude-code" by a 45 s daemon-ready timeout. Both gates' other failures are the instrumentation's: plugin `dist` drift, `key-format`, and the red `midrun-182` probe.

## Sources

- `src/runners/vitest/sources.ts` (`SourceStamps.stale`, `cachedModules`), `src/runners/vitest/adapter.ts:256-296` (`invalidate`, `#invalidate`), `:366-447` (`run`), `src/runners/vitest/stale.ts:301` (`cachedTransform`), `src/runners/vitest/moved.ts`, `src/core/scheduler/tiers.ts` (`recordTier`), `src/core/scheduler/scheduler.ts` (`#fly`), `src/core/scheduler/ledger.ts` (`markUnknown`), all at `dfee8c70`.
- Vitest 5.0.3 `node_modules/vitest/dist/chunks/index.DpLw24bj.js:9466, 9730, 20650` (`server.watch = null`, the watcher closed when `watch` is off).
- `test/integration/revert-restore.test.ts` (unchanged since `f2a59664`), `test/e2e/support.ts` (`POLL_MS = 150`).
- `reviews/wave-13h.md` Verification; `tasks/001-146/notes.md`.
- Probes: `probes/revert-restore-pass/` (`instrument.patch`, `probe-log.ts.txt`, `rr-probe.test.ts.txt`, `rr-split.test.ts.txt`, `midrun-182.test.ts.txt`, `rounds.sh`, `gates.sh`, `analyze.py`, `analyze2.py`, `results/`).
