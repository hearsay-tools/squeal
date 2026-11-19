# 011-396: list only the newest revision of an edit stream (gh-181)

Wave 122, W1. Shape: repair. Evidence: `../../research/stuck-running.md` E4b (20 revisions in 60 s listed one at a time, about 21 s each, no tier for over 4 min) and E4c (a restart lists only the newest, in 5 s).

## What changed

- `src/core/scheduler/superseded.ts` (new): `supersede(older, newer)` folds a newer revision's runner part into a queued, not started one.
- `src/core/scheduler/runner-work.ts`: `queueRefine` looks for a revision's runner part that is queued and not started (`RunnerTask.queued`). If one exists, the new revision supersedes it and nothing new is queued. The task reads its `queued` value when it starts, so a part already shifted off the queue (in flight) is never changed.
- `src/core/scheduler/revision.ts`: `ContentRekey.edits` and `RevisionEdit` (additive, optional).
- `src/core/scheduler/refinement.ts`: `RunnerPart.edits` (additive, optional). Catch-up at apply moved into `isCatchUpPart`, which counts each superseded revision on its own. `contentFields` moved the optional spreads out of `fetchRunnerPart` (its complexity stays where it was; `applyRunnerPart` went 20 to 18).
- `step.ts` is not changed. The existing rule (no tier while runner work is queued or draining) now holds for at most two runner parts: the one in flight and the newest.

## Merge rules (`supersede`)

- The merged revision is the newest: its number, head, dirty, trigger. Its refined commit counts every superseded number refined (`covers`: `revision <= refined`).
- Each path: its first `oldHash`, its last `newHash`.
  - Added, then deleted (null to null): a delete from the hash it held in between. The runner forgets it, and the change is structural, so the listing runs, as the unmerged listings would.
  - Deleted, then added again: a change. The content part never removes a file from the ledger (only `applyListing` does), so the file stays known.
  - Edited back to its first bytes: still a change, so the runner drops what it may have read in between.
- Content: `rekeyed` and `recent` unions by test file id; `previous` keeps the key from before the oldest revision (the runner walked at that key); `environment` is an OR; `catchUp` only when both were.
- `touched` paths: union, less any path a merged revision changed.
- `edits`: each revision's own paths and content catch-up. At apply, the part is catch-up only when every revision is catch-up on its own (never their union, review wave 5, B3).

## Decisions the spec did not settle

1. Supersede across a catch-up boundary. A catch-up revision (a pull, editor scratch) and a small edit merge. The merged part is not catch-up, and the edit cut runs over all merged paths. A big pull merged into an edit stream can therefore keep a few more files as edit work (namesakes and short importers of the pull's paths) than separate parts would. I chose this over refusing to merge, because an editor that writes scratch files between saves would otherwise break every merge. A reviewer may want the stricter rule.
2. Waits on a superseded revision. Revision 5, merged into 22, counts refined only when 22 is applied. Before, it counted refined after its own part. This is the point of the row: the tier start is bound by one listing after the last edit.
3. Order with other runner work. The newest revision joins the queued part where it stands, so it can move ahead of a `run --all` (`afterTier`), a touched-only or an observed refinement queued after that part. Each of them then sees a later runner state, which is the state they read anyway.

## Tests

- `test/scheduler/superseded-listing.test.ts`: barrel fixture, the first runner part held in `invalidate` while 20 revisions arrive. Asserts 2 runner parts (in flight and newest), at most 2 listings, `test/kept.test.ts` (added at revision 3, kept) is listed and runs, `test/gone.test.ts` (added at 5, deleted at 9) is not, the first run starts after the last listing, and the refined revision is the current one. Red without the merge: 20 runner parts (`expected ... to have a length of 2 but got 20`).
- `test/scheduler/superseded.test.ts`: unit cases for the path kinds, content joins, touched paths, and edits through three revisions.
- No key-format or validity change: no case in `test/keys/key-format.test.ts` needed.

## Proposed spec amendment (011 C4, plain text for the coordinator)

Amended 2026-11-19 (the human, row 011-396, gh-181, `research/stuck-running.md` E4b and E4c): a revision's runner part that is queued and not started yet stands for every later revision too, as a daemon start lists only the newest revision. One runner part then invalidates, lists and resolves what all of them changed: each path from its hash before the first to its hash after the last, a path added and deleted in between as a delete, so the listing runs. Its commit records the newest revision refined. Each revision still counts on its own for catch-up (step 4). While edits come faster than the runner lists them, the runner lists the revision in flight and the newest one, and a queued tier starts within one listing of the last edit. (E4b: 20 revisions in 60 s were listed one by one at about 21 s each, with no tier for over 4 min; E4c: a restart listed the newest in 5 s.)

## For the next worker

- `runner-work.ts`, `refinement.ts` and `revision.ts` were over 300 lines before this row; they still are (327, 338, 406).
- While verifying, the host daemon (0.1.565, without this row) printed "Vitest has not listed revision 12's test files yet; it waits for the run in flight, each of its calls bounded at 666 s" for this worktree, the text W3 owns.
