# 011-343 notes: `squeal retry`'s receipt says the retry joins the queue, and names the wait

Wording only. When a retry starts does not change (`queueDue`, priorities, #127). Exit codes do not change. No gate change.

## Changed lines

1. A `load` retry when the load holds it (`loadRetryWhenText`, `src/core/retry/text.ts`; the load-allows branch is unchanged). Example at load 12.40 on 8 CPUs:

   - Old: `Retry queued (reason: load): test/a.test.ts runs once more when the one-minute load average falls below the CPU count, or after at most 10 min above it, then with a load note (load average 12.40 on 8 CPUs now). Its FAIL stays counted until a retry passes; squeal status lists the retry while it is pending.`
   - New: `Retry queued (reason: load): test/a.test.ts joins the queue when the one-minute load average falls below the CPU count, or after at most 10 min above it, then with a load note, and runs once more in its turn at its normal priority, at no set time (load average 12.40 on 8 CPUs now). Its FAIL stays counted until a retry passes; squeal status lists the retry while it is pending. squeal status --wait 60000 test/a.test.ts waits for its result; the wait leaves the retry at its normal priority.`

2. Every failed-result receipt (`Retry queued (reason: load|environment): …`, `src/cli/retry.ts`) ends with one more sentence:

   - Old end: `… Its FAIL stays counted until a retry passes; squeal status lists the retry while it is pending.`
   - New end: `… Its FAIL stays counted until a retry passes; squeal status lists the retry while it is pending. squeal status --wait 60000 <file> waits for its result; the wait leaves the retry at its normal priority.`

No other line changed: the no-result receipts (`Run queued: …`, `… has a run queued or running …`, `… has a run asked …`), the refusals, `--cancel`, the busy lines and the no-daemon line are as before.

## Choices the brief did not settle

- The no-result receipts say the wait "moves it ahead in the queue" (011 C15 promote). For a retry, a named wait leaves its run at normal priority (`named-step.ts` `RETRY_WAITS`, row 011-283; research F7: do not imply that the wait grants retry priority). So the retry's sentence says "the wait leaves the retry at its normal priority" instead of reusing `waitText`.
- The path is printed as the no-result receipt prints it (unquoted `shown`), so both receipts read alike. A path with a space is not one shell word in either; `shellWord` would fix both, outside this row.
- "Retry queued" stays as the receipt's first words: the request is stored; "joins the queue" names the daemon's run queue.
- Spec 011 C5 and spec 005 D1 quote no receipt text in this checkout (searched for the old phrase); the board row asks them amended where they quote it. Workers own neither `spec.md` nor `status.md`; the coordinator decides whether an amendment line is needed.
- `test/evals/retry-texts.ts` and `test/evals/retry-claim.test.ts` model receipts from old releases ("runs once more now"), as eval transcripts recorded them. They are fixtures of past output, so they stay.

## Tests

The lines are pinned in `test/cli/retry.test.ts` (load, held), `test/cli/retry-queued.test.ts`, `test/cli/retry-queued-group.test.ts` (tail per file) and `test/status/retry-holds-live.test.ts`. Flipped first: 14 tests failed at revision 1, then passed at revision 2 after the code change.
