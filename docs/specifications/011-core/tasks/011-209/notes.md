# 011-209 notes: a wait shows the work in flight

Worker edfd6b78, wave 44 W2, 2026-10-26. Commits `ab4fd440c` (F1), `df0bf126a` (F2, F3, rule C, unlisted), `13b8f3c67` (F4, the agreed `scheduler.ts` call) `7f1d44a9b` (`YieldHistory`, no behaviour change), and the repairs `32e472239` and `1f726bc69` (see "Found by the affected checks"). Brief: section W2 of `tasks/wave-44.md`. Evidence: `research/issue-91.md` F1 to F4. The line texts were agreed with the coordinator in request 96b33632 (accepted as written, with rule C for the restart note). The `scheduler.ts` call was agreed in request dd6ee382 (option a, with a 2 s bound on the count write).

## What changed

1. **F1.** The running line reads the tier's yield standing that the daemon published, as the queued line does. Both lines now give the same suffix and the same step.
2. **F2.** The daemon keeps its last yield per worktree (`TierYields.#last`): time, what it yielded to, the rule, the cut files, and the cut run's id, start and end. It keeps it until a later tier that holds a cut file ends. A daemon restart keeps none, because status ignores a predecessor's row (`at` before the daemon's start).
3. **F3.** Queued lines in the yield's lane name the kept yield after the tier's reason. So the `cut` reason now says which yield it means.
4. **F4.** A running line of a several-file tier says how many of its files ended, once the runner has named one. The daemon writes the count at most once per 2 s per worktree (see "The count write").
5. **Unlisted.** The line of an unlisted revision names the run its runner part waits for: the open run of the file's lane, its start and its ended count.
6. **Rule C.** In a named wait, the first tier a daemon started in a fast lane says that no yield before the daemon's start is kept.

## Line forms

Example clock: the tier starts 16:15:46, the yield cuts it at 16:15:47, its run ends 16:15:48, the restarted tier starts 16:15:48, the daemon started 16:15:40.

F1, the running line while a promoted file waits:

- yields: `4 in the vitest tier of 4 test files running since 16:15:46; the tier yields: test/s1.test.ts, ...` (no step text)
- does not yield: `4 in the vitest tier of 4 test files running since 16:15:46; the tier does not yield: its estimated remainder was 12 s, not over 30 s: test/s1.test.ts, ...; no command runs them sooner (a running tier that does not yield is waited for)`
- nothing published (nothing waits for the tier, or an older daemon): unchanged, `...; no command runs them sooner (a running tier is not interrupted)`
- a one-file run: `running since 16:15:46 in the vitest lane; the run yields`

F4, the ended count, after `running since ...`:

- `4 in the vitest tier of 4 test files running since 16:15:46, 1 of them ended; ...`
- Shown only once the runner named a file ended. A runner that names none (node:test, pytest) shows nothing, not a false 0. A run of one file shows no count.

F2 and F3, the kept yield. A suffix after the reason, before the step. It is in the class line and the `--json` reason, not in the verdict line's short reason:

- cut run ended: `; a yield at 16:15:47 cut 4 files after 2 s of their run (to a promoted file; estimated remainder 199 s, over 30 s)`
- past the estimate: `(to an edit's work; 30 s past its estimate)`
- to the runner part: `(to the runner part; ...)`
- one file: `cut 1 file after 2 s of its run`
- cut run still stopping: `; a yield at 16:15:47 cut 4 files; their run since 16:15:46 is still stopping (to a promoted file; ...)`
- the restarted tier: `4 in the vitest tier of 4 test files running since 16:15:48; a yield at 16:15:47 cut 4 files after 2 s of their run (to a promoted file; estimated remainder 199 s, over 30 s): test/s1.test.ts, ...; no command runs them sooner (a running tier is not interrupted)`
- F3, queued: `2 queued, promoted, behind the vitest tier of 4 test files running since 16:15:48; the tier does not yield: it holds a file a yield already cut at its key; a yield at 16:15:47 cut 4 files after 2 s of their run (to a promoted file; estimated remainder 199 s, over 30 s): f: f/f.test.ts, ...; no command runs them sooner (a running tier that does not yield is waited for)`

Which lines name it: running lines of any tier other than the cut run, and every queued line in the cut files' lane, except a queued line behind the cut run itself. The cut run's own standing already says `; the tier yields`.

Rule C, the restart note (named waits only, not status's `Outstanding:` block):

- `4 in the vitest tier of 4 test files running since 16:15:48; no yield kept since the daemon started at 16:15:40: test/s1.test.ts, ...`
- Shown on a running line of a several-file tier in a fast lane only while no tier of that lane has ended in this daemon and the daemon keeps no yield. That is, on the first tier the daemon started in that lane. After a tier of the lane ended, any later yield is one this daemon keeps, so the note says nothing new. A fresh start and a successor behave the same.
- An older daemon publishes no `lanes` key, so a newer status shows the note on every several-file tier of an older daemon. The note is still true there: an older daemon keeps no yield.

Unlisted:

- `revision 5 not listed yet, because the runner part waits for the run in flight (the vitest tier of 4 test files running since 16:15:46, 1 of them ended), each of its calls bounded at 666 s` (`; the run yields` stays after it)
- one-file run: `(running since 16:15:46 in the vitest lane)`
- no open run in the file's lane: unchanged.

## The count write (request dd6ee382)

The daemon learns of a file's end from the runner's callback (`RunOptions.fileEnded`), outside the scheduler's lock. `Scheduler.#fileEnded` calls `TierYields.fileEnded`, which writes the `yields` row with the new count at most once per 2 s per worktree (`ENDED_WRITE_MS`). A file end inside that window writes nothing. The next allowed write, or any other write of the row (a yield standing, the first tier end in a lane, a change of the kept yield), carries the newest count. There is no timer and no trailing write: a count waits for the next allowed file-end write or another write of the row, with no bound on how far it lags (review 0.1.331 N1). A 1,000-file tier therefore makes at most one extra write per 2 s, not 1,000.

The callback runs past any busy slice, so the write runs in a zero busy slice (`withBusySliceSync(0, ...)`): a busy store fails it at once and it is skipped, and the daemon's event loop is never held for it. A tier's end does not write the row for its count alone: status reads the counts of open runs only, so the next write drops the count.

## The `yields` row

The `yields` row of a worktree (row 011-51) keeps its `{ at, tiers }` and gains additive keys: `ended` (count by run id), `last` (the kept yield) and `lanes` (one file of the first tier that ended, by the daemon's lane name). The row is deleted only when all four are empty. Status matches lanes by its own rule (`laneFor` with `runnerLaneOf`) on the published files, never by the daemon's lane names. The real composite runner names lanes as status does (`vitest`, `node-test`, `pytest`), but the scheduler test runner names none (`""`), and nothing else ties the two names together. For the same reason, the row's `last.lane` is the daemon's name, while a standing's `lastYield.lane` is the line's lane as status words it.

## Decisions the spec did not settle

- The cut run's end is when the daemon recorded it (`TierYields.ended`, under the scheduler's lock), not the runner's own end. So "after N s of their run" is an upper bound on the discarded run time. Under a held lock it can read a few seconds high.
- A yield records what it yielded to by calling `waitedFor` again with the same clock reading and the same rank. That costs one more queue scan per yield, which is rare (once per file and key). `#decide` is unchanged.
- `waitedFor` now names its work kinds (`edit`, `promoted`, `runner`) instead of one `work`. A focused entry counts as `promoted`. The yield decisions read only `null`, `recheck` and `named`, so they did not change.
- The kept yield shows on queued lines too, not only behind a tier: a cut file queued with no tier in flight still reads why it waits again.
- An unlisted group whose files are in different lanes reads in one line (`groupId` in `standing-groups.ts`, not this row's, does not read `run`), and that line names the first file's run. One revision blocks every lane, so such a group is rare. A later row can add `run` to the group id.

## Type changes, all additive

- `LastYield` and `WaitedRun` (`src/core/types/standing.ts`).
- `Standing` `running` gains `yields?`, `ended?`, `lastYield?`, `yieldsSince?`. `queued` gains `lastYield?`. `unlisted` gains `run?`.
- `NamedFileEntry` (`src/cli/named-file-lines.ts`) gains `ended?` and `lastYield?` (the named wait's `--json` `testFiles[]`).
- `TierYields.fileEnded(context, tier)`, `publishedYieldRow` and `writeYieldRow` (`yields.ts`) are new; `YieldRow`, `NO_YIELD_ROW`, `yieldRowText` and `readYieldRow` (`yield-row.ts`); `YieldHistory` and `ENDED_WRITE_MS` (`yield-history.ts`, the constant re-exported from `yields.ts`).
- No `schemaVersion` raise. No header changes: `evals/lib/squeal-text.mjs` reads none of these lines.

## Found by the affected checks

- `test/daemon/busy-tier.test.ts` failed: the event loop stalled 5.26 s, 2.3 s into the test's 12 s hold of the write lock, when the slow file ended. The count write waited the store's 5 s busy timeout. Fixed by the zero busy slice (`32e472239`). The test passes again.
- `test/store/worktree-meta.test.ts` (001-254) failed: the registry names `scheduler/yields` as the row's owner, and the key's prefix may appear in quotes or backticks only in `core/types/store.ts`. `yieldsMetaKey`, `writeYieldRow`, `publishedYieldRow` and `publishedYields` are in `yields.ts`; `yield-row.ts` keeps `yieldRowText` and `readYieldRow`.
- `test/cli/next-step-pending.test.ts` gh-40 A: its fixture daemon has a 27-file tier running and no `yields` row, so rule C read it as the daemon's first tier and added the note. The fixture now publishes that a tier of the lane ended (`1f726bc69`), so the case stays about tier membership.
- The four bundle tests (`test/harness/plugin.test.ts`, `codex/plugin.test.ts`, `opencode/package.test.ts`, `pi/package.test.ts`) fail on drift, as expected: this row changes sources and does not run `npm run build`. The coordinator rebuilds at integration.

## For the next worker

- The yield cases need a daemon that cancels its tiers when it stops: `scheduler.close()` waits for the tiers in flight, so a test that emulates a restart with a held run calls `close({ cancel: true })`.
- `tier-yields-kept.test.ts` holds 200 s tiers in the fixture and waits on cuts. It takes about 2 s alone, but each edit in its closure re-keys and restarts it.
- Complexity: `nextStep` (31) and the `standingsOf` callback (42) were over 20 before this row. This row moved its new branches into `tier-text.ts` and `standing-yields.ts`, so neither count rose.
- File sizes: `yields.ts` is 520 lines (493 before). What status reads beside the standings (the last yield, the lanes, the ended counts) is in `YieldHistory` (`yield-history.ts`), and the row's text and parse in `yield-row.ts`; the key and its store access stay in `yields.ts` for the registry. `next-step.ts` is 331 (305 before).

## Seam map

- `src/core/scheduler/yields.ts`: `TierYields.check` records the yield (`YieldHistory.yielded`); `ended` passes the tier's end to `YieldHistory.ended`; `fileEnded` writes the count when `YieldHistory.fileEnded` says it is due; `#publish` writes the row through `writeYieldRow`. Also `yieldsMetaKey`, `publishedYieldRow` and `publishedYields`.
- `src/core/scheduler/yield-history.ts`: `YieldHistory` keeps the last yield, the lanes and the counts, and applies the 2 s bound.
- `src/core/scheduler/yield-row.ts`: the row's text (`yieldRowText`) and parse (`readYieldRow`), with validation of every key.
- `src/core/status/standing-yields.ts`: `withYieldFacts` adds the row's facts to a running, queued or unlisted standing; `standing.ts` calls it once per pending file.
- `src/core/status/tier-text.ts`: `runText`, `waitedRunText`, `keptYieldText`, `noKeptYieldText`, and `laneText` (moved here from `next-step.ts`, which re-exports it).
- `src/core/scheduler/scheduler.ts` `#fileEnded`: the one agreed call.

## Tests

- `test/scheduler/tier-yields-running.test.ts`: F1, both standings.
- `test/scheduler/tier-yields-kept.test.ts`: F2 (the restarted tier's line and `--json`), F3 (the `cut` reason names the yield), the yield goes once the restarted tier ends, and a restart keeps none and its first tier says so.
- `test/scheduler/tier-yields-first-tier.test.ts`: rule C, the note on the first tier and not on the next.
- `test/status/yield-lines.test.ts`: every line form above.
- `test/cli/status-wait-unlisted-run.test.ts`: the unlisted line from a store state.
- `test/scheduler/tier-yields-ended-count.test.ts`: F4 from the runner's file ends, and the 2 s bound.
