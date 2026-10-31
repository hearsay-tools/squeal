# 011-274 notes: a named wait says which files ended while their tier runs

Worker 8d409bce, wave 61 W1, 2026-10-31. Brief: section W1 of `tasks/wave-61.md`. Evidence: `research/issue-111.md` (gh-111). One commit.

## What changed

1. **Publication.** The daemon's `yields` row (row 011-51, widened by 011-209) gains the additive key `endedFiles`: for each several-file tier in flight, the files its runner named ended, in the tier's order, by run id. `ended` (the count) stays, for older readers. `YieldHistory` now keeps the tier itself, not its count, so every write of the row reads the tier's ended files as they are at that write. The write bound is unchanged: at most one write per 2 s from file ends, skipped on a busy store, no timer.
2. **Read.** `readYieldRow` returns the row's `at`, and `endedFiles` with each list validated. `standingsOf` gives a running file whose run the row names it ended a `NamedFile.end` (`FileEnd`): the run's revision, the row's `at` (`asOf`), and the run's files the row does not name ended (the first 3, and their count).
3. **Text and JSON.** A named wait's class line and verdict line lead such a file's group with the end. The `--json` `testFiles[]` entry gains `fileEnd` (the same `FileEnd`), and its `reason` carries the same words. A file that ended reads in a group of its own: files share a line only when their ends read alike.

## Line forms

Example: tier of `test/fast.test.ts` and `test/slow.test.ts` started 06:39:33 at revision 4; the fast file ended; the daemon wrote the row at 06:39:35.

- `1 ended at revision 4, awaiting the tier's final checks and 1 file not reported ended as of 06:39:35 (test/slow.test.ts), in the vitest tier of 2 test files running since 06:39:33, 1 of them ended: test/fast.test.ts; no command runs it sooner (a running tier is not interrupted)`
- More than three not reported: `... and 40 files not reported ended as of 06:39:35 (test/b.test.ts, web: test/c.test.ts, test/d.test.ts and 37 more), ...`
- Every file reported ended, the run still open: `1 ended at revision 4, awaiting the tier's final checks (every file of the tier reported ended as of 06:39:35), in the vitest tier ...`
- The slow file's own line is unchanged: `1 in the vitest tier of 2 test files running since 06:39:33, 1 of them ended: test/slow.test.ts; ...`
- The verdict line's group uses the same words before the tier's short text: `1 ended at revision 4, awaiting the tier's final checks and 1 file not reported ended as of 06:39:35 (test/slow.test.ts), in the vitest tier of 2 test files running since 06:39:33, 1 of them ended`.

The class stays `Pending`, the state `pending`, no verdict, exit 3. Nothing about when a result becomes current changed.

## Decisions the brief did not settle

- **"Unknown".** The brief says to name the unfinished peers "(or 'unknown')". Each run's file list is in the store (`RunRecord.testFiles`), so once the row names a file ended, the files it does not name are always known. What is uncertain is whether they still run, since a file end inside the 2 s window, or on a busy store, waits for the next write. The line words that uncertainty as "not reported ended as of HH:MM:SS", never "still running". No line says "unknown". A daemon older than this row publishes counts only: then no file gets an end, and its lines read as in 011-209. I did not add "which ones is unknown" to those count-only lines: it applies only while an older daemon runs beside a newer CLI.
- **Revision provenance.** The line and `fileEnd.revision` name the revision of the run that ended the file. When an edit moves the file's key during the run, the ledger stops marking it running (`Ledger.#syncPhase`: running only while the tier runs the file's current key), so it reads queued and has no end.
- **Where the end lives.** On `NamedFile`, not on `Standing`. Status's `Outstanding:` groups share one `Standing` per group (`groupId`, `widest`) and print it in `--json`. An end on the standing would show one file's end for a whole group. Status's `Outstanding:` block is unchanged.
- **How many peers.** 3 names, then "and N more", in both text and JSON (`unreported`, `unreportedCount`). The verdict line names 5 groups at most, so it stays bounded.
- **Lazy count.** The published count is now the number of the tier's files named ended at the write, not `tier.ended.size` at the last file end. They differ only if the runner names a file outside the tier.

## Shared files touched

- `src/core/status/standing.ts` (not listed in the brief's ownership): the `NamedFile.end` field, one import and one spread on the last return of the `standingsOf` callback. The branches are in `standing-yields.ts` (`endOf`), so the callback's complexity stays at 43, its count before this row.
- `src/cli/named-file-end.ts` is new: the words, `withFileEnd` and the group id part. `named-file-lines.ts` is 284 lines.

## Type changes, all additive

- `FileEnd` (`src/core/types/standing.ts`).
- `NamedFile.end?` (`src/core/status/standing.ts`); `NamedFileEntry.fileEnd?` (the named wait's `--json` `testFiles[]`).
- `YieldRow.endedFiles` (required in the type; read as empty from older rows) and `YieldRow.at?` (`src/core/scheduler/yield-row.ts`); the row's JSON key `endedFiles`.
- `endOf` (`standing-yields.ts`); `fileEndText`, `withFileEnd`, `fileEndId` (`named-file-end.ts`).
- No `schemaVersion` raise. No header or hook text changes.

## Tests

- `test/scheduler/tier-file-end.test.ts`, through the scheduler with a fake runner: a fast file behind a slow peer (text, verdict line and JSON agree; never current or passed; both pass after release); a late run error after a file ended (no result, no pass, no end); changed inputs after a file ended (no end at the new key, the file runs again); a delayed end report (the peer that ended inside the 2 s window reads not reported, as of the last write). All four were red before.
- `test/cli/named-file-end.test.ts`: the line forms above, grouping, text against JSON.
- `test/scheduler/tier-yields-ended-count.test.ts`: the row names the ended files in the tier's order and reads back with `at`; a list that does not read is dropped. 011-209's line check now expects the ended file in a line of its own.

## For the next worker

- `test/scheduler/tier-ended-files.test.ts` is row 011-54's (the yield's first rule). This row's scheduler test is `tier-file-end.test.ts`.
- The scheduler's test runner calls `options.fileEnded` only when the test wraps `runner.run`, as `tier-file-end.test.ts` and `tier-yields-ended-count.test.ts` do.
- The four bundle tests fail on drift until the coordinator rebuilds, as expected: this row does not run the build.
