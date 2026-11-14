# Row 020-64 notes (worker 23f02de1, 2026-11-14)

## Verdict: a test race, not a keeper defect

`keep-early.test.ts` "does not write a file whose input moved after a busy store refused it" failed once on CI 43620018937 (Node 22, shard 1/3, 225 ms): the file was kept.

The order that keeps the file:

1. `ran(A)` queues A and starts an early pass. The pass's opening check reads A's inputs: unchanged.
2. The pass is slow under CI load (it opens the store, creates the code store, writes the coverage record). The test's `sleep(100)` ends first.
3. The test moves the input and releases the hold, in one synchronous step.
4. The pass reaches its results write. The store is free, so the write lands at once.

The store never refused a write, so no input check was owed (`InputCheck.owed` is false). The opening check had passed. D17.5 keeps that file: "a run handed back after a failure is checked again … before its next write", and "each queued file's keyed inputs are checked again after every busy pause and before its write". Here there was no handback and no pause. The test assumed that the first write came before 100 ms. Under load it did not.

Evidence:
- Deterministic reproduction (a scratch test, now the third case of `keep-early-moved.test.ts`). `head()` blocks the pass after its opening check. The test moves the input, releases the hold, then lets `head()` return. Result: 1 row at `KEY_A`, which is the CI outcome.
- The refusal path cannot keep a moved file when the holder is in the same process. The hold is a `DatabaseSync` on the test's thread, and a busy try is a synchronous SQLite wait. So the hold cannot end while a try waits. After a refusal, `paused` calls `check.owe()`. Each later `keepFile` then reads the inputs before each write, in the next early pass and in `flush`'s last pass. A run handed back after a busy refusal keeps `checked: true`, so the next pass's opening check skips it. The owed check in `keepFile` covers it instead.
- Mutation check: with `InputCheck.holds` forced to `true`, case 1 fails (`kept`), and the other cases pass.

## A narrow gap found on the way (not the CI cause; parent asked)

A try waits inside SQLite for up to its busy slice: 20 ms in an early pass (`EARLY_SLICE_MS`), 250 ms in the last pass (`BUSY_SLICE_MS`). When another process holds the lock, an input can move during that wait. If the lock then frees within the slice, the write lands with no check after that wait. The check comes before the try, not after the in-store wait. The daemon's own writes have the same in-slice gap. The window is at most one slice. The stored result is still at the key of the bytes the run read and that the check confirmed.

To close it, a try would become: write at once (busy timeout 0), else wait for the lock without writing (an empty `BEGIN IMMEDIATE` with the slice), then check the inputs again, then write at once. That needs a new `Tried` kind ("freed") through `sliced()`, which `keep-seen.ts` (not owned) also uses. It also needs a rule so that a lock that frees and is taken again counts toward the 30 s bound and the busy note. Without that rule the loop has no bound.

Request e01086a8 to the parent gave two options. A (default): no product change; amend D17.5 to name the window. B: close it in this row. The parent's reply was "Decision: A. No product change in this row." It also asked for a sentence on why the window is safe, and filed no row for now. The daemon's writes have the same in-slice wait. Closing the gap there or here would need a bounded retry rule: a lock that frees and is taken again must count toward the bound.

## Spec text (D17.5, option A; amended in `spec.md` by the parent's agreement)

> Amended 2026-11-14 (row 020-64, CI 43620018937): the check that follows a pause is the one before the next try. Once a write did not land, each try of a queued file's write is preceded by a read of its inputs and of the merge hold, in that pass and in every later one. A file whose writes were never refused is checked once, at its pass's opening check, before its writes. An input that moves after that check is not seen before the write. A try itself may wait inside the store for at most its busy slice (20 ms while the runs go on, 250 ms after the report). An input that moves during that slice is not seen before that write. That is safe: the run read the bytes that give the file its key, so a result written during that slice is still true at its key (D17.3, row 020-59), and a gate on the moved bytes reads another key.

## Changes

- `src/core/code/gate/keep-queue.ts`: new exported type `Pause` (`(ms, then) => cancel`). The default is an unref'd timer. `EarlyWrites` takes an optional `pause` and now awaits each pause inside its loop. Before, the timer kicked a new loop. So a pause that ends at any time starts the next pass. A `kick` during a pause only marks `#again`. `stop()` cancels the pause under way, and the loop returns. A behaviour change that only a seam can show: with a pause callback that fires before the loop's `finally` cleared `#running`, the old code lost the kick. A real timer never fires that early. `MAX_PAUSE_MS` is now typed `number` (with a `?? 2_000` fallback), because it is no longer passed to `setTimeout`.
- `src/core/code/gate/keep-pass.ts`: `KeepOptions.pause?: Pause` (additive). The file was 338 lines and is now 341. It was over the 300-line guide before this row.
- `src/core/code/gate/keep.ts`: passes `options.pause` to `EarlyWrites`.
- `test/code/gate/keep-early-moved.test.ts` (new): three cases. The keeper's seams drive the order, never a sleep.
- `test/code/gate/keep-early.test.ts`: the timed case is removed. Case 1 of the new file replaces it.

Type changes: `Pause` (new export), `KeepOptions.pause` (new optional field), `EarlyWrites` constructor (new optional second parameter), `MAX_PAUSE_MS` annotated `number`. All additive.

## Done-when mapped to tests

| Done-when | Test |
|---|---|
| The input moves between the busy refusal and the retry: not kept | `keep-early-moved.test.ts` "does not keep a file whose input moved between the refusal and the retry". The pause seam proves the refusal: a pass asks for a pause only after a write did not land. The input moves during the pause, the hold ends, then the pause ends. The early retry pass drops the file by its owed check. |
| The input moves after the write: kept | "keeps a file whose input moved only after the retry wrote it". Same refusal, then the retry writes. The case waits for the row at `KEY_A` (a wait for a state), moves the input, then calls `flush`. |
| (decision pinned) The CI order, with no refusal: kept per D17.5 | "keeps a file whose input moved after its pass's opening check, when no write was refused". `head()` blocks the pass after its opening check. |
| 20 runs in a row under load, no sleeps deciding the order | 20/20 runs of `keep-early-moved.test.ts` with `keep-early.test.ts` (6 tests each run). The host's one-minute load was 10.65 before and 8.86 after, on 24 vCPUs. This is the host's real load from other sessions; no load was made on purpose. |

## Checks run

- `pnpm run typecheck`: pass (after the `MAX_PAUSE_MS` type fix).
- `pnpm run lint`: pass (`biome check .`, no fixes).
- `squeal status --wait 60000` on the keep-early, keep-early-moved, keep-early-retry and keep-busy test files: no known failures, each with a current result at revision 5.
- `squeal status --wait 180000` on the 20 keeper test files (`test/code/gate/keep*.test.ts`, `test/cli/code-gate-keep*.test.ts`, `test/run-evidence/keeper.test.ts`): no known failures, each with a current result at revision 10.
- Squeal's wider affected set (about 360 files that read `keep.ts`): no verdict yet. About 200 were still queued when this row ended; pending, not passed. Three failures are expected bundle drift, because `src` changed and no build ran in this tree: `test/harness/plugin.test.ts`, `test/harness/opencode/package.test.ts` and `test/harness/pi/package.test.ts` ("cli/squeal.mjs differs from the build"). The coordinator's bundle rebuild clears them.
- `node_modules/.bin/vitest run test/code/gate/keep-early-moved.test.ts test/code/gate/keep-early.test.ts` 20 times: 20 passed.
- Mutation (`InputCheck.holds` forced to `true`): case 1 fails, as it should; reverted.

Not run: the full suite (the wave rules forbid it; CI runs it); `pnpm run build` (the wave header says no build in a worker tree; this row does not own `plugins/claude-code/dist`).

## For the next worker

- Seams for keeper order: `KeepOptions.head` runs after a pass's opening check and before any write. `KeepOptions.pause` times the pauses between early passes. A pass asks for a pause only after a write did not land, so that call proves a refusal.
- The other `keep-early.test.ts` cases still use `sleep(100)` / `sleep(300)`. They do not decide an order: they assert state while the hold is in place.
- Option B was not chosen. If a later row closes the gap, the new path in `keep-here.ts` writes with slice 0, then waits for the lock with an empty `store.transaction(() => {})` or `code.transaction(() => {})` under the slice. `withBusySliceSync(0, …)` sets `busy_timeout = 0`, because 0 is less than the connection's own timeout. `sliced()` needs a "freed" outcome that owes the check and does not call `giveUp`. The 30 s bound must also count tries that were freed and then busy again.
