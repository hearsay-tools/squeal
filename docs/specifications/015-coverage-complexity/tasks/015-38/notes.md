# 015-38 notes: transitions from a pull

Worker b822c832, 2026-10-24. Brief: `tasks/wave-1d.md` W2. Starts from `int/015f-r1` (0b1abef7e). The human's option (a), `status.md` 2026-10-24; `lessons.md` "Round 1 (015-10)" B5.

## The rule, as built

A `PASS` or `RESOLVED` of complexity, `crap` or `uncovered`, for a function the consumer's view holds by count only (`told: "count"`), is taken into the view by count and not told when git brought the last change to the function's file up to the transition's revision. The passing function leaves the view, and so does the removed one. "Git brought" means 015-19's and 015-34's files (`committedPaths`: the blob at a moved `HEAD` or at a commit that an operation under way brings), plus a file gone at such a commit.

These are told as before:

- every `FAIL` (`first-seen fail`, `PASS -> FAIL`), from git or not;
- a `PASS` or `RESOLVED` for a function told in full, as `FAIL` (`full`) or as `STILL FAIL` (`still`);
- a `PASS` or `RESOLVED` from the session's own edit to the file.

The coordinator chose this reading for `crap` and `uncovered` (option A, reply to request `dcbd7355`). These measures are judged when coverage arrives, often at a later revision than the pull. The cost: a test the agent writes later (an own edit to another file) can make an untold `crap` failure in a pulled file pass, and that `PASS` is not told either. The agent never heard that the function failed, so it stays quiet and leaves the view, which fits option (a). Option B would have matched the exact revision. Then a pull's `crap` `PASS` judged after any other edit would still be told.

## Seam

- `src/core/code/pass/pulled.ts`, new: code meta `pulled:<worktreeId>`, `[path, revision]` pairs. `writePulled` runs in the pass's last transaction over the judged paths. A path in `committedPaths` is set to the pass's revision, and every other judged path is dropped. A recount clears the record (`clearPulled`): its revisions can be another store's after a first count. `pulledReader` is the delivery's question `(path, revision) => last change git's at or before revision`. It reads the record once, and only when the question is asked.
- `committedPaths` (`pass/head.ts`) now takes every judged path, with `blob: null` for a gone one. A gone path is git's when `cat-file` prints `<rev>:./<path> missing` for a revision git brought. The pass gives the entry's own blob for counted, too-big and symlink files (`pass.ts`, `blobs`), so the edit filter (015-19) is unchanged: only counted checks have edits.
- `planCodeDelta` (`delivery/code-delta.ts`): `CodePlanInput.pulled`, optional. `toldKind` takes `after` and the input. It returns `null` for a `fail-to-pass` or `removed` when the view entry is `count` and `pulled(last.check.path, last.revision)` holds. Only these two kinds ask, so a `FAIL` never reads the record.
- `codeStep` (`delivery/code-deliver.ts`): one line, `pulled: pulledReader(store.meta, worktreeId)`. A 015-12 repair edits this file beside this row (`newTooBig`), so the change stays at that line and its import.

## Tests, red first

Each one failed before the change, with the untold line told, and passes after it:

- `test/code/delivery/pulled.test.ts`: a pull over an untold failing function that now passes tells nothing and leaves it out of the view, and the function's next `FAIL` is told; a pull's `PASS` stays quiet beside an own edit to another file before the delivery; a pull that removes an untold function, or deletes its file, tells nothing; a merge that git stopped (015-34) tells no `PASS` it brought.
- `test/code/delivery/pulled-coverage.test.ts`: a pull's `crap` and `uncovered` `PASS` for an untold function tells nothing; the same pull tells both for a function told `FAIL`, and nothing for the untold one beside it. Proved red by replacing the reader with `() => false` for one run.

Each of these passed before and after the change. They pin what must not change:

- `pulled.test.ts`: a pull's `PASS` for a function told `FAIL` and one told `STILL FAIL`; a pull's `FAIL` for a function that went over and for a new one; an own edit's `PASS` for a function told by count; a pull's `RESOLVED` for a function told `FAIL`.
- `test/code/pass/pulled.test.ts`: the record. A pull's files are recorded at its revision, and an own edit drops one. A file a pull deleted is recorded, and an own deletion is not. A recount clears it.
- `test/code/pass/head.test.ts`: a gone path is named when it is gone at the new `HEAD`, and not when `HEAD` still holds it.

Superseded: `test/code/pass/pull.test.ts` "still tells a FAIL and a PASS it brought" (015-19) now expects only the `FAIL`. The `PASS` there was for a function told by count.

## D6 amendment text (the coordinator owns `spec.md`)

In "The first edit to a standing failure", replace "a `FAIL` or `PASS` from it is still delivered (amended 2026-10-24, 015-19)" with "a `FAIL` from it is still delivered, and a `PASS` as the next paragraph says (amended 2026-10-24, 015-19, 015-38)". Then add, after the 015-34 sentence:

> **A recovery git brought.** A `PASS` or `RESOLVED` of complexity, `crap` or `uncovered`, for a function the consumer's view holds by count only, is taken into the view by count and not told when git brought the last change to the function's file up to the transition's revision: a file whose bytes are its blob at the new `HEAD` or at a commit an operation under way brings, as above, or a file gone at such a commit. A `FAIL` from git is told, and so is a `PASS` or `RESOLVED` for a function told in full (`FAIL` or `STILL FAIL`) or brought by the session's own edit to the file. `crap` and `uncovered` are judged when coverage arrives, so a test the session writes later that makes such a function pass is not told either: the session never heard that it failed (amended 2026-10-24, 015-38, the human's option (a); the coordinator's reading for D9's measures).

## Limits, accepted

- A pull, then an own edit to the same file in a later pass but before the session's next delivery: the edit drops the file from the record, so the pull's `PASS` is told. The record keeps only each file's last change.
- 015-19's limits hold. An edit and a commit in one watcher batch read as git's, so such a `PASS` is quiet for an untold function. A count that failed on a pulled file and succeeds at a later pass reads as the agent's, because that pass's `since` is after the `HEAD` move.
- An untracked file the agent deletes in a pass where `HEAD` moved, or while an operation is under way, reads as git's deletion. Its `RESOLVED` is told only when the session was told it in full.
- `squeal code --changed` and status's `sinceRegistration` still count what changed since the registration, a pull's changes too. They are what the agent asks for, not a delivery.

## Cost

- The record is one meta row per worktree, about 55 bytes per file whose last change was git's. Its size is bounded by the included files. The pass reads it at each edit pass and writes it only when it changes. The delivery reads it only for a recovery or removal of a function held by count.
- Like `pass:` and `recount:`, the code store's prune does not drop it for a worktree that is gone (`src/core/code/store/prune.ts` is not this row's). For later: prune `pulled:<id>` with `coverage:<id>`.

## Type changes

- `CodePlanInput.pulled?: (path, revision) => boolean`, optional: additive.
- `committedPaths`'s `files[].blob` is `FileHash | null`, a widened parameter.
- New exports in `src/core/code/pass/pulled.ts`: `readPulled`, `writePulled`, `clearPulled`, `pulledReader`. No store schema or `src/core/types` change.

## Review 0.1.297 B5, the same worker (`tasks/wave-1d.md` "W2 addition")

A real edit to a too-big file at a revision that also recounts was hidden: the recount writes every files row at its revision, and `newTooBig` dropped each row at `recount.revision` (015-36).

- **As built.** Before a recount after a cursor (`threshold`, `include` or `counter`) writes the rows, the pass reads the paths its revisions changed (`changedPaths(cursor.revision, latest)`). It keeps apart each too-big file among them whose stored row had another blob or none (`tooBigEdits`, `pass/cursor.ts`). The recount record carries them as the optional `tooBigEdits`. `newTooBig` hides a row at the recount's revision unless the record names it, so a recount-only row tells nothing and the real edit tells once.
- **Not the lead as written.** The coordinator's first edit was to keep each files row's own edit revision when a recount rewrites it. That alone leaves an edited row and a new row, which a first count or an include change writes, both at the recount's revision. The delivery still could not tell them apart, and the files table has no column for that one bit (`src/core/code/store/**` is not this row's). The review's second option, "read the revision's changed paths and blob difference", needs no schema change, so the pass does that and records the result.
- **First count.** Nothing is an edit, as 015-36 decided: no cursor, so no `tooBigEdits`.
- **Test.** `test/code/delivery/too-big.test.ts`: two too-big files, one edited at a revision that recounts and one only rewritten by it. Only the edited one is told, once. A later edit by the same counter tells none, and neither does a recount back to the first counter. It went red with the review's proof (no `src/big.ts is …` line) and is green after the change. The first-count, recount, resume and once-per-session tests in the file pass unchanged.
- **Limit.** The record holds the latest recount only. If a second recount comes before the session's next delivery, the first recount's edits read as recount rows and are not told. The line comes at the next edit to that file instead.
- **Type change.** `RecountRecord.tooBigEdits?: readonly RelativePath[]`, optional: additive. `CodeRecount` (`src/core/types/code-delivery.ts`) is unchanged; the delivery reads the field with `recountTooBigEdits`.
