# 015-40 notes: the coverage measures follow D6 and D7

Worker f0ed5308, 2026-10-24. Brief: `tasks/wave-3.md` W1, with 015-39 and 015-33. Starts from main at 0.1.297 (e538c7788). Wording of the told line: `status.md`, the coordinator, 2026-10-24. The edit to `src/core/types/code-delivery.ts`, outside the brief's ownership, was agreed with the coordinator (reply to request `cb17fc53`): additive fields in `CodeNews` only.

## Amendment text for spec.md

The coordinator folds these in. Each keeps every complexity-only text as it is.

### D6, the first edit to a standing failure (after "...and squeal code <path> shows its count.")

> The rule holds for `crap` and `uncovered` (amended 2026-10-24, 015-40). These are judged when coverage arrives, so the coverage step marks the edit: a function the complexity pass marked edited after the measure's last judgement is marked edited for the measure, at the complexity edit's revision. A body git brought is no edit here either (015-19), and a recount's judgement marks none. The lines:
>
> ```text
> STILL FAIL CRAP: cold (src/a.ts:2) is 42 after the edit; it was already over 30 before it (CC 6); no in-process test that Squeal runs reaches it; Squeal stays quiet about it until it is at or under 30, and squeal code src/a.ts shows its CRAP.
> STILL FAIL CRAP: fresh (src/a.ts:4) is 72 after the edit, over 30 (CC 8); no in-process test that Squeal runs reaches it; Squeal stays quiet about it until it is at or under 30, and squeal code src/a.ts shows its CRAP.
> STILL FAIL uncovered: cold (src/a.ts:2): no in-process test that Squeal runs reaches it after the edit; none reached it before it either (CC 6); Squeal stays quiet about it until an in-process test runs it, and squeal code src/a.ts shows its coverage.
> STILL FAIL uncovered: fresh (src/a.ts:4): no in-process test that Squeal runs reaches it after the edit (CC 8); Squeal stays quiet about it until an in-process test runs it, and squeal code src/a.ts shows its coverage.
> ```
>
> The evidence is the FAIL line's (D9). A delivery's title counts such functions once each: `1 function still failing a code check`; with complexity only it stays `1 function still over the complexity threshold`.

### D6, the other side (replace the first bullet)

> - Test news (any test entry) ends with `Complexity: 2 functions over 20 that this session was told about; squeal code --told lists them.` while a function told to the session in full (`FAIL` or `STILL FAIL`) is still over. A function the view holds by count only is not counted. The `crap` and `uncovered` states told in full that still fail are counted too, each measure apart, and a measure with none is left out: `Complexity: 2 functions over 20, 1 over CRAP 30 and 1 no in-process test reaches, that this session was told about; squeal code --told lists them.` (amended 2026-10-24, 015-40).

### D6, a summary (append)

> A `crap.threshold` change delivers `CRAP threshold is now 25: 40 functions over; squeal code lists them.` and re-seeds the views by count, once the coverage step has judged every ready file at the new threshold; a file that waits for its records keeps its last judged states. It tells no crossing that only the threshold made (D9). Coverage starting, or switched off and on, tells none (amended 2026-10-24, 015-40).

### D6, details on demand (replace the `--told` bullet)

> - `--told` lists the functions over the threshold that the session was told about in full: the same read as the test-news line above, so the two agree. Its coverage part lists the `crap` and `uncovered` states told in full that still fail, headed `Coverage: 1 function over CRAP 30 and 1 no in-process test reaches, that this session was told about`; it has none when no such state is (amended 2026-10-24, 015-40). In a shell with no session registered here (Pi, a terminal) it lists those told to any registered session, and says so. `--told` with `--changed` exits 2 (015-27).

### D7 (replace the second paragraph)

> With `complexity.blocking: true`, Stop's completion check (011 C8) also counts each code check that went to `fail` since the consumer registered: complexity, and `crap` and `uncovered` while the coverage step judges here. A function that was already failing at registration never blocks. With complexity only, the reason reads as before: `Squeal policy complexity.blocking is on and 1 function went over the complexity threshold 20 since this session started: sel (src/a.ts:4). squeal code --changed lists them.` With a coverage measure among them it names each function once, with what it went to `fail` on: `Squeal policy complexity.blocking is on and 2 functions went to fail since this session started: sel (src/a.ts:4) over complexity 20, hot (src/a.ts:1) over CRAP 30 and no in-process test reaches it. squeal code --changed lists them.` The status line's `since this session started` stays complexity only (amended 2026-10-24, 015-40).

### D9, delivery

"D5, D6 and D7 apply unchanged" now holds as built. The residue lines in `tasks/015-12/notes.md` and `tasks/R6/notes.md` (no `STILL FAIL`, complexity-only blocking and `--told`, no CRAP-threshold summary) are closed.

## Seam, as built

| Part | Where | What |
|---|---|---|
| STILL FAIL | `crap/judge.ts` `judgeFiles`, `JudgeContext.edits` | A measure judged before (`was`) whose function has a complexity edit (`states.edits(wt, "complexity")`) with `revision > was.countedAt` is returned in `edited`, at the edit's revision and the judgement's time. Not for a quiet (recount) judgement. |
| | `crap/step.ts` `writeJudgement` | Reads the complexity edits of the judged paths, calls `markEdited` after `upsertMany` (an upsert keeps a state's edit). |
| | `delivery/code-deliver.ts` `codeStep` | Reads the edits of every measure the delivery tells, not complexity's only. `planCodeDelta` was already measure-blind. |
| | `delivery/code-coverage.ts` `stillFailLine`, `quietHint`; `code-format.ts` `codeTitleWords` | The lines and the title above. `coverageEntryLine` takes `command`. |
| Blocking | `delivery/code-since.ts` `wentOverSince` | Takes `measures`, default `["complexity"]`, so status's count is unchanged. |
| | `harness/shared/stop-code.ts` | Passes complexity plus `coverageMeasures`; groups by function; complexity-only text as before. `NOT_REACHED_SHORT` in `code-coverage.ts`. |
| Told | `delivery/code-told.ts` `toldOver`, `withToldOver` | `toldOver` takes `measures`; `withToldOver` fills `toldOver.crap` (the threshold of the told `crap` states) and `toldOver.uncovered`. |
| | `delivery/code-format.ts` `toldOverWords`, `toldOverLine` | The parts, a comma before "that" only with two or more. |
| | `cli/code-report.ts` `coveragePart`, `cli/code-coverage.ts` `coverageReport(…, told)`, `coverageLines(…, told)`, `cli/code.ts` `toldWho` | `--told` has a coverage part of the told states; none when there are none, so the complexity-only output is unchanged. |
| Summary | `crap/summary.ts` `CoverageSummary.threshold`, `CrapRecount`, `readCrapRecount`, `writeCrapRecount` | Code meta `crapRecount:<worktreeId>`. `deleteSummary` deletes it too, so coverage off clears it. |
| | `crap/step.ts` `thresholdAfter` | The summary keeps the threshold every ready file was judged at; a change writes the record when the step ends with no file past the budget, else the summary keeps the old one so the next step sees the change. No record as coverage starts or when an older summary has no threshold. |
| | `delivery/code-deliver.ts` `codeStep`, `registerCode` | A record newer than the seed is told as `crapRecount` and seeds the view by count, beside a complexity recount if both are new. The registration seeds at the newer of both records' times (015-37's rule). |
| | `delivery/code-format.ts` `crapRecountLine` | `CRAP threshold is now 25: 40 functions over; squeal code lists them.` |

## Decisions the spec did not settle

- **The coverage edit's provenance.** The step reuses the complexity pass's edit mark rather than comparing body hashes itself: the mark already excludes what git brought (015-19, 015-34), and its revision is the edit's, not the judgement's. Compare: the residue in `tasks/015-12/notes.md` suggested comparing the body hash at the state's blob.
- **Wording.** The STILL FAIL lines end with "shows its CRAP" and "shows its coverage", not "shows its count", since `squeal code <path>` shows those for these measures. The title says "still failing a code check", since `uncovered` has no threshold. Stop says "went to fail" and "over complexity 20" beside "over CRAP 30", from the told line's phrases.
- **When the CRAP summary comes.** After every ready file is judged at the new threshold, so its number counts them all. A pending file keeps its states from the old threshold (D9's rule) and is in the number as judged then.
- **The told line's CRAP threshold** is the one the told `crap` states hold, since the delivery reads only the complexity keys of the policy.

## Type changes

- `CodeNews.toldOver.crap?`, `CodeNews.toldOver.uncovered?`, `CodeNews.crapRecount?` (`src/core/types/code-delivery.ts`, agreed, additive).
- `CoverageSummary.threshold?`, new `CrapRecount` (`crap/summary.ts`).
- `JudgeContext.edits` (required), `judgeFiles` returns `edited` (`crap/judge.ts`; one caller).
- `wentOverSince(…, measures?)`, `toldOver(…, measures?)`, `coverageReport(…, told?)`, `coverageLines(…, told?)`: optional parameters.
- `coverageEntryLine(entry, at, command)`: a third parameter (one caller).

## Tests, red first

- `test/code/crap/still-fail.test.ts`: a first edit tells STILL FAIL for CRAP and uncovered once, then quiet; after a FAIL told, "after the edit, over"; a body git brought tells nothing and the own edit after it tells; an edit judged before the registration tells nothing; complexity's STILL FAIL text and title as before; a function over both titled once.
- `test/code/crap/blocking.test.ts`: Stop names each function with its measures, status counts complexity only; a failure at registration never blocks; the complexity-only text with coverage judged.
- `test/code/crap/told.test.ts`: the told line counts each measure apart, leaves out one with none; `--told` lists the coverage states; the complexity-only told line and each recount line pinned byte for byte.
- `test/code/crap/threshold.test.ts`: one summary line and no crossing, the view seeded by count (the next edit is a STILL FAIL); a later registration hears nothing; the line waits for the step past the budget; coverage start and off-on tell nothing.

## For whoever continues

- `codeStep` reads the coverage summary in `coverageMeasures` and the small `crapRecount` key on every delivery; a hook with coverage on reads the summary twice when it has test news (`withToldOver`). The summary is one JSON value of every file's condition.
- The CRAP summary's number includes the `crap` states of pending files at the threshold they were last judged at. Re-deriving their outcome from their stored value at the new threshold would make it exact; D9 says a pending source keeps its last judged states, so this row does not.
