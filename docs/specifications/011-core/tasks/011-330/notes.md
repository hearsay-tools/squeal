# Row 011-330: one rule per report field in the report merge

Worker e645ac81, 2026-11-13, brief `tasks/wave-84.md` W1.

## Step 1: the table pins today's rules

`test/daemon/report-merge.test.ts` holds one table, typed over every `RunReport` field (`{ [K in keyof RunReport]-?: Case<K>[] }`), so a field without rows fails the typecheck in the test too. Each cell sets one field on one, two or three parts over an empty report and compares the whole merged report with `toStrictEqual`, so a key present or absent is part of the cell. The table calls `merge` from `composite-runner.ts`; it holds no copy of the rules.

`test/daemon/report-merge-whole.test.ts` holds three whole-report cases: no part; two parts that each failed to start (the first's setup failure, both failures named); three parts that set every field, with the merged keys in today's order (a report written as JSON keeps its bytes).

Both passed against today's `merge` before any refactor (Squeal, revision 8). The builders are in `test/daemon/report-merge-fixture.ts`, so each file stays under 300 lines.

### Merge cases the table replaced

From `test/daemon/composite-runner.test.ts`:

| Deleted case | Table rows that replace it |
| --- | --- |
| "keeps the other adapter's results when one adapter's run crashed" | `end`: "the worst of three, an earlier one"; `durationMs`: "summed over two"; `completedFiles`: "over three, one empty"; `results`: "over three, one empty"; `fileDurations`: "a later part's", "over three, one without"; `failure`: "only the failing part named" |
| "is timed-out when one part timed out and none crashed" | `end`: "a later part's worse end"; `failure`: "only the failing part named" |
| "carries a part's skipped files, and none when no part skipped one (task 007-23)" | `skippedFiles`: "a later part's", "absent when no part has them", "absent when every list is empty" |
| "carries a part's focused counts, a zero match included, and none when no part focused (row 011-145)" | `focused`: "a later part's, a zero match included", "absent when no part has them" |

Kept in the composite's test: "dispatches a run spanning both adapters by project and merges the reports" (dispatch by project and the members' order; it is the only case that shows `run` merges at all) and "turns an adapter whose run rejects into a crashed part of the run" (`Flights` turns a rejection into a crashed report; not a merge rule).

From `test/runner-host/remote/`: none deleted. The cases there test the lane's own paths. "keeps the local part's results and the remote part's setup failure when only the remote fails" (`lane-setup.test.ts`) asserts a merged report, but it is the only case of the lane's branch that merges after a local part that started; the table's `startupFailure` row "a later part's when the first started" covers the rule, not that branch.

### Unrelated failures seen during step 1

At revision 8 (test files only changed), Squeal reported `test/commit/boundary-daemon.test.ts` ("carries the commit line in the same delivery…") and `test/daemon/vacant-wait.test.ts` (timed out in 5000 ms, load average 78.70), both "no baseline result, may predate your edits". The changes at revision 8 were test files those tests do not import.
