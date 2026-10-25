# 015-49 notes: the complexity line names the changed files not judged

Worker a278bb7d, 2026-10-25. Wave 7 W1, from issue #96 (the human's option (a)).

## What was built

- **Pass record (commit 1, by agreement: coordinator option 2).** `FailedCount.editedAt` (`src/core/code/pass/failed.ts`): the revision of the edit that brought the failed blob. It is the pass's own `lastChanges` map (the one `writeTooBigEdits` uses), given to `countMissing` through `Attempt.edits` (`blobs.ts`), one line in `pass.ts`. The same blob keeps the earlier `editedAt` through a retry, a restart's retries (`restartRetries` spreads the record) and a recount. A new blob takes the new edit's revision. A first count's failure has none. A file that counts again, or is deleted, loses the whole record, as before. No schema, `user_version`, record key or result key change. An older record without the field names no file.
- **One read (commit 2).** `changedNotJudged(store, worktreeId, bounds)` in `src/core/delivery/code-told.ts`. A too-big file counts by its `tooBigEdits` revision. A could-not-count file (`uncountableFiles`, spent attempts) counts by its `editedAt`. Each counts when `isOwn` holds for one of the bounds. Order: the newest edit first, then the path. The hook (`withToldOver`, one bound: the consumer's `codeSeenUpTo`) and `squeal code --told` (the bounds of `toldTo`'s consumers) both read it, so the two agree.
- **Line.** `toldOverLine` now takes `{ toldOver, notJudged }` and returns `null` while neither is set. `CodeNews.notJudged` holds at most `CODE_NOT_JUDGED_MAX` (3) files and `more`. The single call in `format.ts` changed (two lines).
- **`--told`.** `CodeReport.files` is exactly the session's changed files not judged, all of them, the newest edit first (coordinator decision 1). **`--told` no longer lists pending, not-counted-yet or parse-error files**, and no too-big or could-not-count file the session did not change. Plain `squeal code` still lists every not-judged file in path order. The JSON shape is unchanged.

## Decisions the spec did not settle

- A file whose count failed and whose retry is still due (5 s, then 60 s) is `pending`, not "could not count". It is named once its attempts are spent, as `squeal code` reads it (015-18).
- With no registration recorded (`since` `null`), no file is named. The too-big line does the same (`newTooBig`).
- 2 files read `a (…) and b (…)`, 3 read `a, b and c`, more than 3 read `a, b, c and N more`.
- On the delivery where an edit to a too-big file is first told, the once-per-session too-big line and this line both come when the delivery has test news. D6 asks for the line on every test-news delivery.

## Known edges, not handled

- An edit and its revert in one pass's range (A to B to A), at a new counter version whose count fails, records an `editedAt`. The too-big record would not, because it compares with the stored row. This is rare; the coordinator asked to keep the pass change small.
- A file the session changed earlier that becomes not judged only by a policy change (a lower `maxFileBytes`, or a new counter that fails on it) is not named. The recount's range does not include the old edit. The too-big line behaves the same (015-39).

## For the coordinator

- `src/cli/main.ts`'s help text still says `--told those over that this session was told about; files not counted follow, with why`. Under `--told` the files are now only the session's changed ones. The text is not wrong, but it is less exact. I did not change it, because it is outside my ownership.
- `docs/specifications/015-coverage-complexity/tasks/015-10/part-b/bin/cases.py` matches the told line by `^Complexity: \d+ functions? over`. A line with only files does not match. It is an archived dogfood script.
- `plugins/*/dist` is not rebuilt (brief). CI's drift check needs the build at integration.
- Dogfood: in this worktree, test files that no runner lists yet (a new test file) reached the hook as `FAIL uncovered: <describe> …` until the runner listed them. That is outside this row; it may be worth a triage line.

## Tests

- `test/code/pass/failed-edit.test.ts` (new): the edit's own revision, not the pass's; kept through retries, a restart's retries and a recount; a new blob takes the new edit's revision; a first count has none.
- `test/code/pass/retry.test.ts`: one exact record gains `editedAt: 2`.
- `test/code/delivery/not-judged.test.ts` (new): named on every test news, also with no told function; added to the functions told over; never another session's file or an unedited one, also after a recount; `could not count`; leaves the line once it counts, shrinks or is deleted; 5 files show 3 and `and 2 more`; `--told` lists all 5 with the same reasons, its first 3 are the line's, and a shell with no session registered reads the same.
- `test/code/delivery/code-command.test.ts`: `--told` no longer lists `src/new.ts: not counted yet`.
- `test/code/crap/told.test.ts`: `toldOverLine` takes `{ toldOver }`.
