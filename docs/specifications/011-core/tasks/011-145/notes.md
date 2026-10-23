# Row 011-145: focused checks in the daemon (worker notes)

Wave 26, brief W3. Spec 011 C4, C5, C14 and C15 as amended 2026-10-23;
design `tasks/011-135/design.md` R2 (sections 2.2 and 8). These notes are
the residue for row 011-146 (R3) and for the reviewer.

## What landed

| Commit | What |
| --- | --- |
| `29a365aef` | `focuses` forwarded: `createRecoveringRunner` option, fast Vitest and pytest runners, `RunnerAdapter.focusesFile?`, the composite, `afterEachRun`, `withSlowInstance` |
| `c3b29d8ed` | pytest adapter: a file given texts records no observed path; a run of only such files records nothing |
| `7bf32922b` | pytest validity case: a run of focused files only (the key-format alarm) |
| `8f7a88352` | the `focus` request: wire, desk, front desk, handler, `Scheduler.focus?`, `daemon.ts` |
| `144797614` | the scheduler's focused tier, its record and the focused meta row |
| `a3a4a8b83` | the rest of the done-when tests, real Vitest included |

## Seam map

The request:

1. The CLI (row 011-146) sends `{ type: "focus", testFiles, texts, withinMs }`.
2. `daemon/protocol.ts` parses it; `desk.ts` and `front-desk.ts` post it to the main thread, as `promote`.
3. `handlers.ts` answers `{ ok: true, type: "focus" }` at once and calls `requestFocus`. With no `requestFocus` it answers `this daemon cannot focus`. A daemon from before this row answers `unknown request type "focus"`.
4. `daemon.ts` `#requestFocus` waits for the start, then calls `scheduler.focus`.
5. `Scheduler.focus` (`scheduler.ts`) adds an entry to `RunQueue.focused` (`focused-entries.ts`) for each file `mayFocus` accepts, then cuts tiers as `promote` does.

The tier:

1. `selectTier` (`tiers.ts`) asks `selectFocusedTier` (`focused.ts`) first.
2. `selectFocusedTier` takes the waiting entries in request order, one lane, up to `runner.tierSize` files. It drops an entry whose file is not listed, blocked, unkeyed, slow, not focusing, or has a result at its current key.
3. `startFocusedTier` writes each file's entry in the meta row with `endedAt` null, builds a `Tier` of kind `"focused"` with `focus`, and calls `RunQueue.tierSelected(false)`.
4. `executeTier` passes `tier.focus` as `RunOptions.checks`.
5. `TierRecords.record` (`record.ts`) sends a focused tier to `#focused`: the stability check, the install check and the cancel check outside the lock, then `recordFocusedTier` (`focused-record.ts`) under it.
6. `recordFocusedTier` writes one closed `runs` row and each file's final entry, and re-queues a discarded or cancelled entry while its deadline holds.
7. `#requeue` (`scheduler.ts`) sends a tier that was never recorded to `requeueFocusedTier`: its entries wait again.

What else reads the entries:

- `TierYields`: `#decide` never cuts a focused tier; `waitedFor` counts a focused entry as work of its lane, as a promoted file.
- `busyLanes` (`slots.ts`): a focused entry is first-group work of its lane.
- `scheduler.ts` `#hasWork`, `#editPending`, `#fastIdle` and `#freeLaneQueued` see waiting entries, so `idle()` waits for them.

The meta row: `focused-row.ts`, key `focusedMetaKey(worktreeId)`, registered in `WORKTREE_META_ROWS.focused`.

## Wrappers forwarded

`focusesFile` goes through each runner wrapper the daemon builds:

- `createRecoveringRunner` (`daemon/runner.ts`): the new `focuses` option, set on the fast Vitest runner (`daemon.ts`) and the pytest runner (`pytest-runners.ts`). The slow Vitest runner and node:test do not focus.
- the composite (`composite-runner.ts`): it answers from the file's owner. The helper `focusesFile(runner, ref)` is exported from there.
- `afterEachRun` (`escaped.ts`) and `withSlowInstance` (`slow-instance.ts`): one forwarding line each.
- `IdleGc.track` spreads the runner, so it needs nothing.

`test/daemon/focuses-file.test.ts` checks all of them: Vitest fast yes, pytest yes, node:test no, slow no, unknown project no.

The test harness `recording` runner (`test/scheduler/helpers.ts`) does not copy `focuses`. `focused-vitest.test.ts` sets it on `h.runner`.

## Decisions the spec did not settle

1. **A closed run row, written at the end.** A focused tier has no `runs` row while it runs. At its end it writes one row, started and finished in one transaction. So the prune removes its log with the row, and no reader of open runs counts its files running. While it runs, the meta entry with `endedAt` null is the only record. Limit: a daemon crash during a focused run leaves its log directory with no row.
2. **Fire and forget.** `focus` answers at once, as `promote`.
3. **A file must be listed at the request.** `mayFocus` needs the file in the ledger, as `promote` needs a queued file. A test file created just before the wait can miss its entry if the listing has not caught up. The real-Vitest test waits for the file's key first. R3 resolves the wait's paths from the listing, so it sends only listed files. If R3 must cover a brand-new file, it can wait for the file's key before it sends `focus`.
4. **The backlog's turn (`turnFirst`).** A focused tier counts as a first-group tier. When the turn is due, it goes before the focused tier only when a second-group fast file can start in a free lane and quiet does not hold it. Otherwise the focused tier runs and does not wait for a turn that cannot be used.
5. **A focused tier yields to nothing.** Only a supersession cancels it; that run then ends `discarded`, because its inputs changed.
6. **Re-queue.** A `discarded` or `cancelled` entry waits again at the file's new key while its deadline holds. A request for a file that already waits merges the texts and keeps the later deadline.
7. **Ends.** `discarded` comes first: when the install moved, when the runner withheld the run, or when an input changed (the reason names up to three paths). Then `completed` for a completed file, `cancelled` for a stop's or hold's cancel, `crashed` when the run completed without the file, else the run's end.
8. **Bounds.** The row keeps 20 files, oldest dropped first. An entry keeps 50 checks and counts the rest in `more`. A file that failed to load adds its file-level check as `fail`.
9. **Observed paths.** The pytest adapter records none for a file given texts (`c3b29d8ed`). Limit: a focused run's observed growth is not stability-checked; only the closure snapshot is.
10. **No stored duration.** The selected checks' durations are only in the meta entry.

## Hand-off to row 011-146 (R3)

- Read the row with `readFocused(store, worktreeId)` from `src/core/scheduler/focused-row.ts`. Each `FocusedRun` holds `testFile`, `key`, `revision`, `texts`, `runId`, `logDir`, `startedAt`, `endedAt` (null while running), `end`, `reason`, `collected`, `matched`, `checks` (`FocusedCheck`: `check`, `outcome`, `durationMs`, `summary`, `location`, `fingerprint`) and `more`.
- An entry applies while its `key` is still the file's key. It is never a result, a known failure, a transition, a checkpoint or a duration.
- The focused run's `runs` row exists only after its end, and it is closed. Do not look for an open run of a focused tier.
- The daemon gives no entry to a slow file or to a file whose runner runs whole files only. The CLI decides what it tells the user for those ("runs whole files only") from policy: the slow `include` patterns and the runner kind. `RunnerAdapter.focusesFile?(ref) ?? focuses === true` is the daemon's own test.
- The tests send `promote` and `focus` together, as design section 8 says a named wait with `--check` does.

## Brief corrections

- The brief cites `research/probes/issue-64/fixture/`. The fixture is at `docs/specifications/011-core/research/probes/issue-64/fixture/` (coordinator, 2026-10-23). `test/scheduler/focused-vitest.test.ts` writes its own file in the shape of `test/parity.test.ts` there (30 checks of 400 ms, two new failing checks in the `NEW-ASSERTIONS` slot), so no test depends on a docs directory.
- Files outside the board row's list, granted by the coordinator: `src/core/daemon/{runner,daemon,composite-runner,escaped,slow-instance,pytest-runners}.ts`, `src/core/types/{runner,scheduler}.ts`. In `daemon.ts`, only the `focuses: true` line, the `requestFocus` line in `#openDesk` and `#requestFocus`.
- W4 (011-163) edits the drain methods of `scheduler.ts`. This row edits `focus()`, `#freeLaneQueued`, `#focused`, `#hasWork`, `#editPending`, `#fastIdle` and `#requeue` there. The two sets do not overlap.

## Type changes (all additive)

- `RunnerAdapter.focusesFile?(testFile): boolean` (`types/runner.ts`).
- `Scheduler.focus?(testFiles, texts, withinMs): Promise<void>` (`types/scheduler.ts`).
- `FocusRequest` and `FocusResponse` in the request and response unions (`types/daemon.ts`).
- `WORKTREE_META_ROWS.focused` (`types/store.ts`).
- `TierKind` gains `"focused"`; `Tier.focus?: readonly FocusedFile[]` (`scheduler/tiers.ts`).
- New: `FocusedRun`, `FocusedCheck`, `FocusedEnd` (`scheduler/focused-row.ts`), `FocusEntry` (`scheduler/focused-entries.ts`), `FocusedEnded` (`scheduler/focused-record.ts`).

## Tests

| File | Covers |
| --- | --- |
| `test/scheduler/focused.test.ts` | 1: a 200 s tier yields; only the texts run; nothing stored; two row writes; the own run leads, stores, and its new failure re-runs once. 2: a tier of 20 s does not yield. 3: a result at the key drops the entry. 4: a changed input discards the run; it runs again at the new key, or not past the deadline |
| `test/scheduler/focused-turn.test.ts` | 5: the backlog's turn after four first-group tiers, focused ones included. 6: a slow file and a whole-files-only file get no entry |
| `test/scheduler/focused-vitest.test.ts` | real Vitest, issue-64 shape: the focused red is in the meta row before the file's own run starts |
| `test/daemon/focus.test.ts` | the request's parse, the handler, both desks, the error, the unknown type |
| `test/daemon/focuses-file.test.ts` | `focusesFile` through every wrapper |
| `test/runners/pytest/focused.test.ts` | a focused pytest run records no observed path |
