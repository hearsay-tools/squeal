# 015-18 notes: a failed count is retried

Worker 327ffa01, 2026-10-24. From main at 55afb856a. Review 0.1.283 S1. The sibling row 013-07 owns `src/runners/vitest/adapter.ts` only.

## Decisions

The coordinator settled three questions during the row:

1. **The readers (decision 1, B).** The row also owns `src/cli/code-report.ts`, `src/cli/code.ts`, `src/core/delivery/code-deliver.ts`, `src/core/status/code-status.ts` and their tests. A file whose attempts are spent reads `unknown: could not count (<error>)` in `squeal code`, leaves `counting: N of M`, and is counted in status JSON.
2. **The unit in status JSON (follow-up, B).** `code.unknown` stays "functions in parse errors". A new optional field `code.uncountable` counts files (`src/core/types/code-delivery.ts`, granted for that field).
3. **The grammar load (decision 2, B).** `src/core/code/count/parser.ts` resets its cached load promise when the load rejects.

## Seam map

| Part | Seam | Regression |
|---|---|---|
| The record and its rules | `src/core/code/pass/failed.ts` (new) | `test/code/pass/retry.test.ts` |
| Gate, record and log per attempt | `countMissing` and `fail` in `src/core/code/pass/blobs.ts` | `retry.test.ts` |
| Work set, early return, forget, shared blob | `runPass`, `retriesDue` and `workSet` in `src/core/code/pass/pass.ts` | `retry.test.ts` |
| Timer, fresh budget, counter-load reset | `createCodePass` in `src/core/code/pass/index.ts` | `test/code/pass/retry-daemon.test.ts` |
| Grammar load reset | `counterReady` in `src/core/code/count/parser.ts` | `test/code/count/ready.test.ts` |
| `squeal code` | `behindOnDisk`, `notJudged` in `src/cli/code-report.ts`; `fileLine` in `src/cli/code.ts` | `test/code/delivery/uncountable.test.ts` |
| Registration and status counting | `countingOf` in `src/core/delivery/code-deliver.ts`, used by `registerCode` and `codeStatusOf` | `uncountable.test.ts`, `retry.test.ts` |
| Status phrase | `codeStatusLines` in `src/core/status/code-status.ts` | `uncountable.test.ts` |

## The rules as built

- **The record.** Code meta `uncountable:<worktreeId>` is one JSON object by path: `{ blob, attempts, retryAt, error }`. `error` is the first line of the counter's error message. The key is removed when no path has a failed count.
- **Attempts.** `COUNT_ATTEMPTS` is 3. `RETRY_AFTER_MS` is `[5_000, 60_000]`: the second attempt comes 5 s after the first failure, the third comes 60 s after the second. After the third failure `retryAt` is `null`.
- **Spacing is kept.** A failed path joins the work set only when its `retryAt` is due. An edit to another file before that time does not retry it. If the same blob enters the work set before then (the same bytes written again, or a recount), the pass holds it: it does not read or count it. So a burst of edits cannot use up the attempts.
- **"Judged on the next pass".** I read the done-when as the pass at which the retry is due. With no edit, the daemon's timer starts that pass 5 s after the failure. `retry.test.ts` shows that a pass before the due time returns `null` and that the pass at the due time judges the file.
- **Forgetting.** After `countMissing`, every work-set path that was not skipped loses its record: it was judged, removed, made too big, or is a link. A path with a new blob starts again at attempt 1.
- **A shared blob.** Paths with the same blob are one group, and one count. When that count fails, only the paths that may count it now get the failure. A path that already spent its attempts at that blob gets no fourth attempt.
- **Another worktree counted the blob.** A spent record whose blob now has a count in the store (another worktree's pass stored it) is due at the next pass. That pass judges the file from the stored count and does not count it again. Until then, the readers do not call the file uncountable (`uncountableFiles` requires that no count exists).
- **The timer.** After each pass, `createCodePass` sets one `unref`'d timer at the earliest `retryAt` and nudges itself then. `close()` clears it. When no `retryAt` is to come, no timer is set: a counter that always throws runs 3 times and then stops.
- **Fresh budget.** The first pass after the code store opens (at daemon start, and after the policy is switched on again) sets every record to `attempts: 0, retryAt: now`. A restarted daemon therefore retries a spent file. This is also the only recovery for a process-level failure that the in-process reset does not fix. If that write throws, the next pass tries it again.
- **Counter load.** In `createCodePass`, a rejected counter-load promise is set back to `null`. The next pass, at the next nudge, loads it again. The error is still told once (`lastError`).
- **Grammar load.** In `counterReady`, a rejected load sets `loading` back to `null`, so the next `countFile` loads again.
- **Logs.** One line per attempt, three at most per blob: `complexity: could not count src/a.ts (attempt 1 of 3): <error>; trying again in 5 s`. The last line ends `not again until it changes`.

## Reader change, for the D4/D6 amendment

- **`squeal code` (D6, details on demand).** A file at the blob the counter failed on at every attempt, with no count of that blob stored, prints `  <path>: unknown: could not count (<error>)` under `Not judged:`. Its JSON entry is `{ path, reason: "could-not-count", size, error }`. It is not `pending`, so `squeal code` does not wait for the pass over it. While a retry is to come, or once its bytes change, it reads as before: `pending` with `root`, else `not counted yet`. Order of the reasons: pending, too big, could not count, not counted yet, parse errors.
- **Registration and status (D6).** Such a file is in neither `done` nor `total` of `counting: N of M`, so counting ends when only such files remain. Status JSON `code.pending` and `code.files` leave it out too. `code.uncountable` counts these files and is absent when there are none. The status line adds `; 1 file could not be counted` (or `N files`) after the parse-error part. If every included file is such a file, status no longer says `no file counted yet`.
- **D4 (the pass).** Proposed sentence: "A count the counter fails on is tried again 5 s and then 60 s later, three times in all, then not until the file's blob changes or a daemon starts. Meanwhile the file keeps its last judged states (row 015-18)."
- **Spec line 169** lists status JSON as `code: { v: 1, threshold, over, sinceRegistration, pending, unknown }`. It now also has `files` and the optional `uncountable`.

## Type changes

All additive except the one internal return type:

- `CodeStatus.uncountable?: number` (`src/core/types/code-delivery.ts`).
- `CodeReportFile.reason` gets `"could-not-count"`, and `CodeReportFile.error?: string` is new (`src/cli/code-report.ts`).
- `countMissing(ctx, entries, failed, now)` has two new parameters. Its only caller is `runPass`. The internal `countOne` returns `{ error }` instead of `null`.
- New exports from `src/core/code/pass/index.ts`: `COUNT_ATTEMPTS`, `RETRY_AFTER_MS`, `FailedCount`, `FailedCounts`, `readUncountable`, `uncountableKey`. New export from `code-deliver.ts`: `countingOf`.

## Tests

- `test/code/pass/retry.test.ts`: throws once and is judged at the due pass; three attempts with no retry before each due time, and the log lines; a spent blob is held for the same bytes and for a recount; a copy at a new path gets its own attempts (a mutant without the filter gives `attempts: 4`); a new blob gets a fresh budget; another worktree's count is used; removing the file forgets its record.
- `test/code/pass/retry-daemon.test.ts`, with fake `setTimeout`, `clearTimeout` and `Date`: the timer judges the file 5 s later with no edit; a counter that always throws runs 3 times and leaves no timer; a restarted daemon retries a spent count (a mutant without `restartRetries` fails); `close` clears the timer; a failed counter load is loaded again.
- `test/code/count/ready.test.ts`: a grammar load that throws once (mocked `loadTsxGrammar`) succeeds at the next `countFile`. It failed red before the fix.
- `test/code/delivery/uncountable.test.ts`: `squeal code` text and JSON with no wait; status JSON and its line; the registration's counting; pending while a retry is to come; pending again once the bytes change.
- `daemonPass` moved from `lifecycle.test.ts` to `test/code/pass/helpers.ts`, beside the new `flakyCounter`.

## Limits and residue for the next worker

- **Python grammar.** `pythonParserReady` in `src/runners/pytest/graph/parse.ts:39` also caches a rejected load with `??=`. A Python grammar or runtime that fails to load once fails every later Python count in that daemon. Only a daemon restart recovers it, through the fresh budget. That file is outside this row. The same 3-line reset would fix it, but a second `Parser.init` after a partial init needs a check first.
- **A pass that throws.** If the retry pass itself throws (a busy store), no new timer is set. The retry then waits for the next batch's nudge. Its record is unchanged, so it is retried then.
- **First-seen at a retry of a first count.** If a first count (quiet) fails on a file, the retry runs as an edit pass. A function over the threshold in that file then records a `first-seen fail`, not a quiet seed. An overtaken first count (`ctx.retry`) did the same before this row. I did not change it.
- **Old states stay.** A spent file keeps the states of its last judged blob. `squeal code` without paths still lists a failing one among the functions over. This is the same as for any count not yet made.
- **`src/cli/code-report.ts`** is now 329 lines, above the ~300 guide. `behindOnDisk` and `regularBytes` could move to their own module.
