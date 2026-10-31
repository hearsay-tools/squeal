# Row 011-283: one owner for named-wait order (option B)

Worker 9a2c6bb0, wave 62 W1, 2026-10-31. Brief: `tasks/wave-62.md` W1. Rule: the brief's five sentences, from `research/named-wait-rule.md` option B. `Promotions` (`src/core/scheduler/promotions.ts`) is the one owner of named-wait order; every change below goes through it or reads what it publishes.

## What changed, by rule sentence

| Rule | Change | Where | Test (red before) |
| --- | --- | --- | --- |
| 3, last sentence | A wait with no file of its own is kept until its deadline while a selected file of it is open or has not been queued yet; a selected file queued later joins its group (F1). A wait whose files each had their turn and settled ends, as before | `Promotions.add`, `Promotions.#settle` (`seen`) | `test/scheduler/named-wait-late.test.ts` (test 1, and the bound) |
| 3, store and takeover | A starting daemon takes over each batch of the store's row whose files it queued again at the same key, in order, before its own, and republishes; with none, the row is dropped (F3) | `Promotions.takeOver`, `RunQueue.takeOver`, `inheritedBatches` (`promotions-row.ts`), `inheritedOf` (`handover.ts`), one call in `bootstrap.ts` | `test/scheduler/handover-batches.test.ts` (tests 2, 3, 4) |
| 3, open wait's outcomes | The focused row keeps each file an open wait selected; the 20-file cap counts only the others (F4) | `writeFocused` (`focused-row.ts`) reads `openWaitFiles` (`promotions-row.ts`) | `test/scheduler/focused-row-open.test.ts`, `test/cli/status-wait-focus-wide.test.ts` (test 5) |
| 2, N1 | A focused tier of a group is that group's tier: a due post-batch turn goes first, it counts not toward the four, the backlog's turn follows it | `RunQueue.focusedSelected` (`queue.ts`), its call in `focused.ts`, the turn decision in `selectTier` (`tiers.ts`) | `test/scheduler/focused-group-turn.test.ts` (test 6) |
| 5 | Status says why a retry's run and a named slow file wait, text and JSON | `namedStep` (`src/cli/named-file-lines.ts`), `retried` flag set by `retriedRuns` (`src/core/status/retried.ts`) in `standing.ts` | `test/cli/named-wait-reasons.test.ts` |

Red checks: tests 1, 5 and 6 and the status test were read failing before their fix; tests 2 to 4 were read failing with the `takeOver` call disabled, then the call was restored.

## Special cases for named-wait order, and what became of each

1. `Promotions.add` formed no wait when no file of it was open (`open.length > 0`). Removed: the wait is kept until its deadline while a file of it is open or not queued yet.
2. `Promotions.#settle` kept a memberless wait only while a file of it was open. Changed: also while a selected file has not been seen queued or running since the wait came (`Promotion.seen`).
3. Row 011-207's re-send in `src/cli/status-wait-paths.ts` (a second promotion for an asked file once the daemon queued it). Removed, with `WaitAsks.promoted`, `WaitAsks.taken` and `#unpromoted` in `src/cli/status-wait-ask.ts`, which it alone used. `test/cli/status-wait-ask.test.ts` now pins one promotion.
4. `publishedBatches` rejects a row older than the live daemon's start. Kept for readers; the successor reads the row through `inheritedBatches`, which ignores `at`, and republishes.
5. The focused row's 20-file cap (`FOCUSED_FILES`). Routed: it asks the waits `Promotions` publishes (`openWaitFiles`).
6. A focused tier's turn accounting (`tierSelected(false)` in `focused.ts`). Routed: `RunQueue.focusedSelected` asks `Promotions`' rank.
7. The focused tier ahead of a due post-batch turn (`selectTier`). Routed: the post-batch obligation goes into the focused selection's turn decision (`turnFirst`).

Left alone, not named-wait order: `FocusedEntries` (focused entries are the daemon's memory; a successor does not inherit them); the `asked` standing; the yield rules, which already read `Promotions`' rank.

## Decisions the spec did not settle, and my choice

0. Rule 3's bound for a wait with no file of its own: it lives until its deadline only while a selected file is open or has not been queued or running since the wait came. Once each selected file had its turn and settled (a current result, or it left the queue), the wait ends, as today. My first build kept every wait to its deadline; `test/scheduler/tier-yields-fairness.test.ts` ("a result accepted after the cut ends the mark") then failed, because a forced run of a file that had already settled joined the finished wait's group and ran before the tier the test cuts. Today's order for settled files is kept (rule 4, "nothing else about order").

1. "Its key moved" applies at a takeover only. In one daemon a re-keyed member stays in its batch, as C15 Lifetime says today ("a re-key during its run puts it back in the same batch").
2. "The same key" is the key the predecessor's `test_file_keys` row left the file at, compared with the successor's key. The promotions row carries no keys, so `PublishedPromotion` did not change.
3. A taken-over batch selects only its taken-over files. A memberless wait is not taken over, so a file of it queued after the handover does not join (gh-127 across a handover is not covered).
4. No takeover once a wait of the successor's own came: its first publication replaced the row. Only possible while a daemon waits for an install.
5. A successor that takes over nothing still republishes: the empty list drops the predecessor's row.
6. N1: a focused tier "of a group" holds a file in a batch or selected by an open wait (`rankOf`). A due post-batch turn precedes every focused tier, of a group or not, as C4's "before any other tier" says. A focused tier of no group still counts toward the four (row 011-145's `focused-turn.test.ts` case 5 is unchanged).
7. The focused row's "now" is the newest `endedAt` or `startedAt` of the runs written, on the daemon's clock as the promotions row's deadlines are.
8. Slow text uses a comma, "slow, behind the fast backlog", because the line reads `N <reason>: <files>` and a colon gave `1 slow: behind the fast backlog: ...`. Only under `slow.trigger` "continuous" with no slow-slot holder named.
9. Retry text, the coordinator's wording without a count (reply to request d7e65346): the queued reason, then `; retry: normal priority; waits for named groups and edits' work`; the short form adds `; retry: normal priority`. Only for an unpromoted queued file whose pending retry this worktree's daemon claimed at its current key. A promoted file reads `promoted`, with no retry words.

## Edits outside the brief's file list, all agreed with the coordinator

- `src/core/scheduler/focused.ts`: one call, `tierSelected(false)` to `focusedSelected` (request d7e65346, item 1).
- `src/core/scheduler/queue.ts`: the pass-through `takeOver` (item 2) and `focusedSelected` (N1).
- `src/cli/status-wait-ask.ts`: dead `promoted`, `taken`, `#unpromoted` removed (item 3).
- `src/core/types/standing.ts` and `src/core/status/standing.ts`, new `src/core/status/retried.ts`: the `retried` flag (item 4).
- `src/core/scheduler/promotions-row.ts`: the store row split out of `promotions.ts` (375 lines), re-exported so no importer changed; `src/core/types/store.ts` registry owner string `scheduler/promotions` to `scheduler/promotions-row` (request acca88ab). The meta key string `promotions:` did not change, so a newer daemon reads an older row.

## Type changes (all additive)

- `Standing` `queued`: `retried?: true`.
- `InheritedBatch` (exported from `promotions.ts`); `Promotions.takeOver`; `RunQueue.takeOver`, `RunQueue.focusedSelected`.
- R1: `SelectedFact`, `SelectedFacts` (`promotions.ts`); optional `facts` on `Promotions.add` and `RunQueue.promote`; `answeredOf` (`promoted-tier.ts`).
- `inheritedBatches`, `openWaitFiles` (`promotions-row.ts`); `inheritedOf` (`handover.ts`); `retriedRuns` (`status/retried.ts`).

## Existing tests changed, because they pinned a replaced rule

- `test/scheduler/promotions-published.test.ts`: a wait with a file not queued yet is now kept and told.
- `test/scheduler/queue-promotion.test.ts`: "does not affect a file that is not queued" removed (test 1 supersedes it).
- `test/cli/status-wait-ask.test.ts`: one promotion, no re-send.
- `test/cli/named-file-lines.test.ts`, `test/cli/next-step-pending.test.ts`, `test/cli/status-wait-reasons.test.ts`: the slow text.

## C4, C15 and C5 sentences that must change (for the coordinator; `spec.md` is not mine)

- C4 step 5 (line 125), after "After it, while a file of the second group is queued, the backlog's turn is due before any other tier, ...": add "A focused tier of a named wait's group, one with a file in a batch or selected by an open wait, is that group's tier: the due turn goes before it, it does not count toward the four first-group tiers, and the backlog's turn follows it (row 011-283, review `reviews/0.1.378-r2.md` N1)."
- C4 focused (line 133), "It is never the backlog's, and it counts toward the four first-group tiers after which the backlog gets its turn." → "It is never the backlog's. A focused tier of a named wait's group is that group's tier (step 5); any other counts toward the four first-group tiers after which the backlog gets its turn."
- C5 (line 178), "at most 20 files, the oldest dropped first" → "at most 20 files that no open named wait selected, the oldest dropped first; each file an open wait selected stays (row 011-283)".
- C15 What is promoted (line 409), "A file that is current or not queued is not affected" → "A file that is current is not affected; a file not queued yet joins its wait's batch when it is queued before the deadline (row 011-283)".
- C15 Rank (line 411): add "A wait with no file of its own is kept until its deadline while a file it selected is queued or running, or awaits its run: not queued since the wait came, at the key it had then, with no result there or with a `squeal retry` pending there. Once each selected file had its turn, has a result at its key with nothing asked, or its key moved, the wait ends (row 011-283, review `reviews/0.1.384.md` B1)."
- C15 Lifetime (line 413), "Promotion lives in the daemon's memory, and a successor daemon does not inherit it." → "The store holds each batch (`promotions:<worktree>`). A daemon that starts takes over each batch of its predecessor's row whose files it queues again at the key the predecessor's rows left them at, in the same order, before its own waits, and republishes the row; a file whose key moved is no batch's, and with none taken over the row is dropped. No age bound applies: the same-key rule is the bound (row 011-283)."
- C15 asked runs (line 443), "promotes the file once it is queued" → "its one promotion holds the file once it is queued (row 011-283: the daemon keeps the wait until its deadline)".
- C15 Focused checks (line 445), "The daemon keeps a focused entry per file until the deadline, in its memory" → add "; the focused row keeps the outcome of each file an open wait selected (C5)".
- C15 status words: add the retry and slow reasons of decision 8 and 9 above.

## R1: repair of review 0.1.384 B1 (wave 62.5 RP1)

B1: `Promotion.seen` held only the files found queued or running, so a selected file already current when the wait came looked like one not queued yet. It kept a finished wait alive to its deadline, and a later edit put that file back into the old group, ahead of a newer wait.

Fix, decided in `Promotions` only:

- `Promotions.add` takes the scheduler's `SelectedFacts`: for a selected file, its key now and whether it has its answer there. It records each unseen file's key when the wait came.
- A file not seen queued awaits its run while its key is the recorded one and it has no answer (`awaitsRun`). A wait with no file of its own lives only while a file is open or awaits its run. A wait with neither forms no group at all (`add`).
- The scheduler's fact is `answeredOf` (`promoted-tier.ts`): a result at the file's key with no `squeal retry` pending there. A retry the load gate holds is no answer, so gh-127's wait stays open until its deadline. The store's retries row is read only for a file current at its key, and parsed again only when the row changed.
- `scheduler.ts`, at the promote call only, passes `answeredOf(context, ledger)` through `RunQueue.promote` (an optional parameter).
- A taken-over group has every file seen (its members) and no facts, as before.

Not changed: no CLI re-send, no second ordering path, no change to retry priority, slow eligibility, tier selection, keys or verdicts.

Tests, each read failing before the fix:

- `test/scheduler/named-wait-settled.test.ts` (real scheduler): the review's paired probe. A wait on current A and queued B ends when B settles (the row is gone), and a later edit of B runs after a newer wait on C; the control, a wait on B alone; and a wait on B that nothing queued, which another worktree's run makes current here through a lookup (`run --all`), ends, with the same later order.
- `test/scheduler/named-wait-late.test.ts`: a selected file with its answer holds no group; an unqueued file that gets its answer, or whose key moves, ends the wait.
- `test/scheduler/promoted-answer.test.ts`: `answeredOf`, including a pending retry at the key as no answer.

What the fix could not keep: nothing that the review lists. One choice: a file whose key moves before it is queued stops holding its wait (rule 3, "its key moved"). So when no other file of the wait is open or awaits its run, the wait ends and the edited file is plain edit work. While another file of it is still open, the edited file joins the wait, as C15 says of an edit during the wait.

## For the next worker

- `plugins/*` bundles drift from the build (`test/harness/pi/package.test.ts` fails on `cli/squeal.mjs`): expected, rebuilt at the candidate.
- Not covered: a memberless wait across a handover (decision 3); focused entries across a handover (memory only).
- Option A (retry priority, named slow files) is not built; the status words say why they wait.
