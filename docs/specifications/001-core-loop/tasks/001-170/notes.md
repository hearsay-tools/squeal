# 001-170 notes: where an inherited fail is held, and where a pass heals

Seam map for whoever continues (001-171 shares these files).

- The rule: `heldFailure` in `src/core/state/inherited.ts`. Another worktree's `fail` under a key stands only when `readFailureKeys(store, worktree)` already maps the check to that key. One held result holds the whole file's results under the key.
- Applied at the two places a shared row becomes a known state:
  - `Ledger.lookup` (`src/core/scheduler/ledger.ts`): returns no hits, so `settle`, `selectTier`'s pre-run lookup (`tiers.ts`) and the slow tier's `#pick` (`slow-tier.ts`) all treat the file as a miss. `slow-tier.ts` needed no change.
  - `StateSink.refresh` (`src/core/state/sink.ts`): skips the key, so previous states fall to `stateWithoutResult` (pending while queued).
- `bootstrap.ts`: a miss whose previous key equals its current key is a held file; it no longer gets `resultKey` set to that key (which would make `settle` drop it from the queue). Its duration is still read.
- Storing a run: `storeResults` (`src/core/scheduler/store-results.ts`) replaces `results.putMany` in `recordTier`. It reads the key's rows before the write, records flips (`recordFlips`, `src/core/state/flaky.ts`, `meta` row `flaky-checks`), and on a `fail -> pass` refreshes every other worktree whose `test_file_keys` row has the key (`testFileKeys.withKey`, additive), through a store-backed `createStateSink`: the scheduler's sink is per worktree (the test `RecordingSink` rejects another worktree).
- Report line: `attribution.ts` `withFlaky` sets `TransitionEntry.flaky` when the note's key is the worktree's current key; `format.ts` prints "Flaky: FAIL -> PASS under the same inputs".
- `why`: `src/core/status/why.ts` (`heldFor`, `readFlakyNotes`) and `format-why.ts` (`heldLine`, `flakyLine`, in the known-state section). The brief named `src/cli/why.ts`, which does not exist.

Known gaps, not fixed here:

- A worktree whose own state is a pass at key K, after another worktree's run replaced the row with a fail at K (a forced run, or 001-171's re-run), holds that row at its next refresh of the file: its pass reads `stale` while its ledger counts the key as done, until something queues the file again.
- `squeal why` with a partial name resolves through known states only, so a held check with no known state is found by its full name (exact match also looks at stored results), not by a fragment.
- `recordFlips` rewrites one JSON row of up to 1,024 notes per flip; fine for rare flips, quadratic if every run flipped.
