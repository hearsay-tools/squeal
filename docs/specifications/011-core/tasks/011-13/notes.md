# 011-13 notes: a named wait says when a file is promoted; the verdict line's reason groups are capped

Worker notes, 2026-10-17, on 0.1.211. For the coordinator and whoever continues.

## Where promotion is published: a `meta` row, not the sync answer

The daemon publishes its live promotions in one `meta` row per worktree, `promotions:<worktreeId>` (`WORKTREE_META_ROWS.promotions`, owner `scheduler/promotions`), as `{ at, promotions: [{ files: [testFileId], until }] }`.

Why a row and not a field in the sync answer:

- The named reasons are read in the status read transaction (`readNamedFiles`) beside the open runs and the keys. A row there is read in the same transaction as the facts it qualifies. A sync field would be a second source taken at a different moment, and the sync answer is not read by every reader of the store (plain `squeal status`, the JSON).
- An older daemon writes no row, so the reader says `queued` with no protocol change and no version check.
- Writes are rare: once per named wait's `promote`, once when the last promotion settles, once on a queue `clear`. Nothing is written when a settle drops nothing.

## Seam map

- `src/core/scheduler/promotions.ts`: `Promotions` tells each change of its live list to the `publish` callback given to `setClock` (on `add` when one is added or one settled, on `settle` when one is dropped, on `clear` when the list was not empty). `publishPromotions` writes the row, deleting it when none is left. `promotedIds` reads it.
- `src/core/scheduler/queue.ts`: `setPromotionClock` takes the optional `publish` and passes it on. Wiring only.
- `src/core/scheduler/ledger.ts`: the constructor gives `publish` as `publishPromotions(context.store, context.worktreeId, live, context.now())`. Wiring only.
- `src/cli/named-files.ts`: `promotedOf` reads `promotedIds` only with a live daemon, and only a row written at or after that daemon's `startedAt` (a predecessor's is not inherited, C15 "Lifetime"). A file whose reason is `queued` and whose id is promoted gets `promoted: true`.
- `src/cli/named-file-lines.ts`: `reasonText` prints `queued, promoted, behind the <lane> tier running since HH:MM:SS`, or `queued, promoted` with no tier in its lane. `groupId` keeps promoted and plain queues apart. `reasonGroups` names `REASON_GROUPS_SHOWN` (5) groups, then `and N more for M other reasons`. The class lines and `wait.testFiles` still give every file's own reason.

## Decisions the spec did not settle

1. **Deadline.** The row keeps each promotion's `until` on the daemon's clock. The CLI compares it with its own `now`. That is the host clock, as for every other time in the store (run starts, heartbeats). Nothing is written at the deadline itself: the reader stops saying `promoted` once `until` has passed, and the daemon drops the row at its next settle.
2. **Settled promotions.** The daemon drops a promotion only when it settles, which happens at the next queueing. A promotion whose files have all run can stay in the row until then. The reader says `promoted` only for a file that is still pending and `queued`, which matches `RunQueue.isPromoted`: an entry is promoted only once `add` has settled the list.
3. **Predecessor.** A row written before the live daemon started is ignored. The successor does not clear it at start, so no write is added to daemon start. Its first change overwrites the row, and `WorktreeRepo.remove` drops it with the worktree.
4. **Slow and claimed files.** These keep their own reasons. A slow file says `slow, ...` and a claimed one says `waiting for ...`, promoted or not, because promotion changes neither constraint (C15 "Constraints that still bind").
5. **Cap.** Five groups, in the order the selected files first give them. The remainder is counted by files and groups. 1,000 claimant roots now give about 500 characters, against 70,888 before (S1).

## Type changes (additive)

- `PendingReason`'s `queued` variant gains `promoted?: boolean`.
- `PublishedPromotion`, `promotionsMetaKey`, `publishPromotions`, `promotedIds` (`promotions.ts`). `REASON_GROUPS_SHOWN` (`named-file-lines.ts`).
- `Promotions.setClock` and `RunQueue.setPromotionClock` take an optional third argument, `publish`.
- `WORKTREE_META_ROWS.promotions` (`src/core/types/store.ts`). 011-14 may add a row beside it: expect a one-line conflict there. `test/store/worktree-meta.test.ts` needed no edit, because it iterates the registry.

## Integration

- `KEY_FORMAT_VERSION` 11 is re-pinned in place at `34d731c3…`. Guarded sources changed: `promotions.ts`, `queue.ts`, `ledger.ts`, `store.ts`. If 011-14 also re-pins 11, take the hash from `test/keys/key-format.test.ts` on the merged tree.
- C15's parenthesis "(`queued` until the daemon publishes its promotions where the CLI reads; task 011-12)" can now be dropped, which is the coordinator's amendment. The skill's `references/commands.md` copies do not mention the queued wording, so they need no edit.

## Tests

- `test/scheduler/promotions-published.test.ts`: the queue tells on promote, settle, deadline and clear, and not when nothing changed. Covers the row's deadline, a predecessor's row, a dropped row, a row that does not parse, and a real scheduler's promotion published while its file is queued.
- `test/cli/status-wait-promoted.test.ts`: `queued, promoted, behind ...` in the class line, the verdict group and the JSON entry while the promotion holds. Reads `queued` after the deadline, with no row (an older daemon), and with a predecessor's row. Reads `queued, promoted` with no tier.
- `test/cli/named-file-lines.test.ts`: 1,000 claimant roots give 5 groups and `and 995 more for 995 other reasons`. Also covers a single remaining group, and promoted and plain queues grouped apart.
