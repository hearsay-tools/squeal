# 001-419: third repair of review 001-417 (cand/0.1.196, wave 14)

Baseline f06b4c33 (cand/0.1.196 at adb833e5 plus the round-2 addendum). The brief names `tasks/001-419/notes.md`; it sits beside 001-418's, under the spec folder.

| Item | Fix | Regression |
|---|---|---|
| B3 | `src/core/state/producers.ts`: the state sink (`applyResults` and `refresh`, beside `recordFailureKeys`) records, for each failing result it derives a state from, the producer `{ runId, recordedAt }` in the per-worktree meta row `failure-producers:<wt>` (`WORKTREE_META_ROWS.failureProducers`, kept to the newest 1,024; a non-failing result forgets its check). `withRecorded` (`src/core/retry/recorded.ts`) reads age and load only from the stored row of that run (`producingResult`), which must still give the state's outcome, fingerprint and commit. No producer named, or its row replaced or pruned: `recordedUnknown`, the existing unknown line. | `test/delivery/failure-producer.test.ts` (the reviewer's probe through the sink and registration: current inherited and re-keyed inherited, each with an identical same-key replacement from the same source at the same commit; red on the baseline, 2 of 9 failing; plus the positive inherited case and a refresh that applies the replacement). `test/status/failure-age.test.ts` (the same probe through `readStatus` and `formatStatus`, with the receiver confirming locally before inheriting). |
| S1 | Not changed in code, as the brief says. 004 D2's sentence now names the exception: a joined fast-only request is not held by the slow lane except after an owed checkpoint resumes on a successor daemon. | None; nothing filed. |

## Decisions the spec did not settle

- **Where the producer lives.** A column on `known_states` needs a schema step, and a newer `user_version` makes older installed plugins refuse the store (`openStore`, "newer-schema"). A per-worktree `meta` row, like `failure-keys:` and `failed-run-loads`, is additive and needs no migration. An older daemon that rewrites a state leaves the row alone; the check that the named row still gives the state's outcome, fingerprint and commit guards that case.
- **A refresh re-derives the producer.** When the receiver's sink applies the replacement row (a later `refresh`), that row becomes the producer, even though the state itself is unchanged: the state now stands on it. Only a row the worktree never applied is refused. The same holds for an own failure re-run at the same revision.
- **Upgrade.** Known failures recorded before this change name no producer, so they say their age and load are unknown until their next run or refresh.
- **`why`** keeps its own `shownResult` with the ordering bound, unchanged, as the review asked.

## Type changes (additive)

- `WORKTREE_META_ROWS.failureProducers` (`failure-producers:`).
- New exports from `state/`: `FailureProducer`, `FAILURE_PRODUCERS_KEPT`, `failureProducersMetaKey`, `readFailureProducers`, `recordFailureProducers`, `producingResult`; `fingerprintOf` is now exported from `state/shown-result.ts` (not from the index).

## Left to the coordinator

`docs/board.md`, the key-format pin (`test/keys/key-format.test.ts` asks for a bump: `src/core/state` changed) and `plugins/*/dist` (the bundle-drift tests fail until the rebuild).
