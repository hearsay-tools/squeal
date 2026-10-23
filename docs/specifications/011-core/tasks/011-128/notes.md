# 011-128: a busy record's withhold history follows a merge hold that began during its wait

Wave 23 W2, worker 55ec9b29, from `int/w22` at 016013a6b (0.1.275 candidate). Shape: repair of review `reviews/0.1.273-r2.md` N2.

## Answer

A record that a busy store held back no longer counts a completion-barrier withhold, or clears one, for a file that a merge hold begun during the wait keeps out of storage. The count changes once, when the write lands, and only for the files the hold leaves free at that try. C9: "that withhold counts toward no withhold limit."

N2 was real in both directions. `test/scheduler/busy-withhold.test.ts` failed with 016013a6b's `scheduler.ts`:

| Case | Before (016013a6b) | After |
|---|---|---|
| 1. The held run was touched. After the hold, a touch withholds the file at the same key. | The held file had a "runs once more" note, so its count was taken. The withhold after the hold was then its second: `unknown` one run early. | No note while held. The withhold after the hold is its first: it runs once more and is current (3 runs). |
| 2. A touched run was withheld first. The run once more, untouched, is held during its wait. After the hold, a touch. | The held run cleared the count, so the withhold after the hold was a first: 4 runs, one run late. | The count stands. The withhold after the hold is the second in a row: `unknown`, 3 runs, one "stays unknown" note. |
| 3. A tier of 3. Two files are touched beside the file the hold takes. | The note named all three files and both paths. | The note names only the 2 free files and `src/strings.ts`. Each is counted once over the retry: it runs once more after the hold and is current. |

## What changed

`src/core/scheduler/scheduler.ts`:
- `#prepare` keeps the environment re-key, the observations, the hold it saw (`held`, `setupsHeld`) and the files a cancel cut short (`unfinished`). It no longer runs the barrier and no longer touches `Withholds`. `heldSetups` reads the run's own `startupFailure`, which the barrier never changed.
- `#barrier(ended, prepared, held)`, new, is called by `#write` at each try, after `#heldNow`. It runs `barredByTouch` over the files the current hold leaves free. It takes the first/exhausted split from `Withholds.peek` and builds the notes from that split. It returns `count`, which records the barred files and clears the other free files.
- `#write` calls `barrier.count()` after `context.store.transaction` returns. A try that throws (busy or other) changes no count. A slot's write that landed returns `#written` on a retry, so it does not count again.
- `PreparedRecord` (internal) loses `ranReport` and `withheld`. Its `again` is renamed `unfinished` and holds only the files a cancel cut short. `#heldNow` takes the `EndedRun`.

`src/core/scheduler/stability.ts`, by coordinator agreement (request a47ba652): `Withholds.peek(files)` gives the split `record` makes and records nothing. `record` reuses it. This method is the only type change, and it is additive.

## Tests

- New: `test/scheduler/busy-withhold.test.ts`, cases 1 to 3 above. Case 3 also mocks `rekeyEnvironments` and `prepareObserved` through the real functions (`vi.mock`). Each was called once per run report although the first record was tried twice: the re-key and the observations stay prepared once.
- New: `test/scheduler/withholds.test.ts`. `peek` records nothing, and its split equals what a later `record` returns. A cleared file, or one at a new key, peeks as a first withhold.
- Moved: `busyFirstWrite` moved from `busy-merge.test.ts` to `test/scheduler/busy-fixture.ts` as `busyWrite(store, during, nth = 1)`, with `busyWaits`. `nth` counts only a write's outer transaction, not the savepoints that `recordTier` opens inside it.

The merge hold starts no tier in any lane (`#onHold`). So in case 3 the free withheld files run once more only after the hold ends, beside the held file.

## Decisions the spec did not settle

- A record whose write fails with another error, or fails busy at its last try after the close, now counts no withhold. Before, the preparation had already counted it. Its files queue again by the old path, so a withhold at the same key next time is their first. The run stored nothing, so the earlier count was the inconsistent one.
- The barrier's report, and with it an exhausted file's `unknown` reason, now names only the paths that barred the free files at the landing try. This matches a record that saw the hold at its preparation.
- Not changed: when a held setup file's startup failure keeps files from starting, those files (`notStarted`) are not merge-held files under `heldFiles`. They can still be barred and counted when their inputs were touched. A record that saw the hold at its preparation counted them in the same way before this row, so this is not specific to the busy wait. It is a candidate row if C9's "merge-held withhold" is to cover them too.

## Proposed for the spec (spec text is not mine)

C9 already states the rule. A sentence for C7's D8 paragraph, after 011-126's "A tier's record that gives up keeps the run's results, as prepared, and is tried again at its turn": "Its completion barrier runs again at each try over the files the merge hold then leaves free, and their withhold counts move only once the write lands (row 011-128)."

## For row 011-131

The record path now also has `#barrier`, between `#heldNow` and `#write` (about 30 lines). `scheduler.ts` is 1,449 lines, against 1,452 before.

## Verification

- `npm run lint`: "Checked 1840 files in 1036ms. No fixes applied."
- `npm run typecheck`: `tsc --noEmit`, no output.
- `squeal run --all --wait`: checkpoint 820be900 completed at revision 17 (ecd253cb1). All 935 test files current, 8,801 checks passed, 7 skipped, 6 known failures, exit 1:
  - 4 bundle drift checks ("cli/squeal.mjs differs from the build"), which the brief excepts: no `npm run build` in this row.
  - `test/harness/opencode-dispose.test.ts`, "the plugin killed the held Stop at +2231, at or after its idle deadline (+2000)". Squeal's baseline run saw it at revision 0, before any edit of mine. It is outside this row's files. A load retry is pending.
  - `test/daemon/busy-edit.test.ts`, "the heartbeat … expected 3042 to be less than or equal to 1000", at 4.03 load per CPU. This is load, not this row. At load 51 to 64 on 24 CPUs, two direct runs with this row's files gave one fail (4,017 ms) and one pass. Two direct runs with 016013a6b's `scheduler.ts` and `stability.ts` gave one fail (3,791 ms) and one pass. Squeal also records an earlier FAIL to PASS at the same inputs (2026-10-22). A load retry is pending.
  - `test/status/why-unknown-standing.test.ts` timed out at 5 s at load 94.88. Its load retry then passed.
- Direct runs, `npx vitest run`: the busy tests, `busy-withhold`, `withholds`, `withheld-retry`, `withheld-touch`, `barrier`, the five `merge-hold*` files and `test/daemon/busy-tier.test.ts` gave 16 files and 45 tests passed in 43 s. Load was about 48, above 8, so `busy-tier`'s timing checks were skipped. `test/daemon/busy-edit.test.ts`, `test/daemon/busy-store.test.ts` and `test/keys/validity` gave 8 files and 42 tests passed.
