# 011-124: status names a claim only for a file that waits on it, worker notes (2026-10-23)

Brief W1 of `../wave-19.md`; spec 011 C7 (claims) and C15 (the queued reasons); `../011-55/notes.md`, "Open for later rows" 2. Base `f9e09794e` (0.1.271). Commit `ad0aa0eb4` is the row.

## What changed

- `src/core/status/standing.ts`, `queuedReason`: a queued file under another worktree's claim of its key reads the claim only when no result is stored at its key (`store.results.byKey(key, 0)`, a read with no last-used write, as `peekClaim` reads it). With a result stored there, the scheduler never holds the file on the claim (`claimOf`, `peekClaim` in `src/core/scheduler/claims.ts`): a result that stands here is taken with no run, and another worktree's failure this worktree holds makes the file run here. Status then reads what the file waits for: the tier running in its lane, the slow tier, or `queued; no run is open and nothing recorded holds it`.
- `claimantOf` (`open-runs.ts`) is unchanged. Its other callers keep their reading: `standingsOf` for a stale or unknown file (line 161, a file not queued here, which no daemon selection judges) and `unknownReasons` (`unknown-files.ts`, not this row's).

## The open case: an edit's work and a forced file

The brief's outcome also names a queued file that is an edit's work, or forced, under another worktree's claim. That file still reads `waiting for <worktree>'s run of its key`, though this daemon runs it (C7: "unless an edit caused it, it is forced"), and in 011-55's test 2 state a tier may yield to it.

Finding: status cannot tell these files from the store. The queue's classes live only in the daemon's memory: `RunQueue` entries' `recent` and `forced` (`src/core/scheduler/queue.ts`). `test_file_keys.pending` is `queued` or `running`; no `meta` row carries the classes; `CheckpointProgress` has no force flag (only an owed checkpoint's `strict` list). `peekClaim` and `claimOf` need the daemon's `Ledger`, so the CLI cannot call them.

Options put to the coordinator (request `21691955`), with their costs:

- **A, the daemon publishes the facts.** One `meta` row per worktree with the `testFileId`s of queued entries that are `recent` or `forced`, rewritten when that set changes and dropped when empty, with `at` so a predecessor's row is ignored (the `promotions` and `quiet` pattern); a reader the CLI calls. Status names a claim only for a file outside it. Files: `queue.ts` (a publish callback, as `Promotions` has), a new scheduler module, `scheduler.ts` (wiring), `types/store.ts` (one `WorktreeMetaRow` name). Cost: during `run --all --force` the forced ids are the whole queued suite, about 60 bytes each, rewritten whenever a tier records, when the store is busiest.
- **B, the daemon publishes its decision.** Each pass, one join query for this worktree's queued keys another live worktree runs (a `sharers()` variant that returns keys: store repo and types), `peekClaim` on those, and the waiting ids with their first sight published. Status names exactly what the daemon holds, and could give the waiter's real bound (C15 says "at most until now plus the bound" since only the daemon knows the first sight). Cost: new store state, a pass-time query, the scheduler's pass.
- **C, status only** (chosen by the coordinator, 2026-10-23): the stored-result clause above. A: a row the daemon rewrites as the queue changes, up to the whole suite per recorded tier during `run --all --force` (busy-store friction is open, #1, #77), for one rare wording case. B: bigger again.

What a later row needs: the daemon to publish the claim-exempt classes or its claim decisions (A or B above, or a cheaper form, such as the recent ids only plus a forced flag on the open checkpoint); `src/core/scheduler/` and the store or types as A or B lists; status then skips `claimantOf` for an exempt file in `queuedReason`. Its test: the 011-55 test 2 state (two worktrees on one store, `tier-yields-claim-fixture.ts`), with F an edit's work here under the other worktree's claim, read through status, not the claim line.

## Decisions the spec did not settle

1. Any result stored at the key ends the claim's reading, not only one that stands. `peekClaim` returns `"stored"` or `"free"` for both, and neither is `"waits"`; the `heldFailure` test only changes which of the two, and both read the same reason in status. So status reads no failure keys for it.
2. Only the queued file's reason changes (`queuedReason`, so `pauseOnlyIds` too: a slow file with a result at its key is pause-only again, as the slow tier's `waits` test says). A stale or unknown file is not queued: no selection judges it, and the claimant's run is still what would give it a result here, so it keeps the claim (the order rule, design 011-24 section 3).
3. No new reason: a file with a standing result at its key reads `queued` with nothing recorded holding it, or behind its lane's tier. A new `Standing` kind would be a type change, which this row may not make.

## Tests

`test/status/claim-stored.test.ts`, one store, C queued here at key K and another worktree with a live daemon running K, each read through status's `--json` (`outstanding`), its `Outstanding:` line and `readNamedFiles` (the named read):

1. No result at K: the claim, as before, at most until now plus 606 s.
2. A pass the other worktree stored at K before: `queued`, nothing recorded holds it; no claim.
3. The other worktree's failure at K, which this worktree holds, and a tier of this worktree running in the vitest lane: queued behind that tier; no claim.

Red before: tests 2 and 3 failed on `f9e09794e` with `kind: "claim"`. Test 1 passes on the base by nature: it pins the reading the row keeps. The existing claim tests (`test/cli/status-wait-reasons.test.ts`, `test/status/outstanding.test.ts`, `next-step.test.ts`) store no result at the claimed key and read as before.

## Open for later rows

- The open case above.
- `standing.ts` is 420 lines, above the styleguide's 300 (417 before this row).
