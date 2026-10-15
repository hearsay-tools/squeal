# 006-71: worker notes

Worker, 2026-10-15. Brief: `tasks/wave-13.md`, "006-71 a9's retry measures credit what the situation asked". Evidence read: sol's a9 cells r2 and r6 to r8 of run `20261015T114356Z-99db6d`, from the committed `.atomic.json` (retained timelines) and the transcripts under `/tmp/squeal-evals-1001/cells/ae20bb31621f/20261015T114356Z-99db6d/*/out` (read only). No cell, session, regrade CLI or build ran.

## What the cells did

a9's `failure.inputs` are `test/rates.test.ts` and `scripts/rates-service.mjs`; `src/rates.ts`, the asked edit, is not one, but it re-keys the rates test too.

| Cell | Order (retained) | Before | Why |
| --- | --- | --- | --- |
| r6, r7 | start, retry **queued**, edit `src/rates.ts`, edit `test/rates.test.ts`, ordinary pass at revision 1, `squeal run --slow`, `node --test scripts/*`, claim | `retry-for-environment` true, `claim-after-retry` false | the test edit closed the retry's window and the pass carried no `Retry asked` note; `retryArose`'s edit reset also marked the service down |
| r8 | start, edit both, retry **queued**, ordinary pass at 1, edit `test/rates.test.ts` again, `squeal run --slow`, `node --test scripts/*`, settled reads at revision 2, claim | same | the ordinary pass did not count; after the second edit, the runs voided any status read |
| r2 | edit both, start, retry **not queued**, ordinary pass at 1, claim | both false | Squeal's reply, verbatim: `Not retried: test/rates.test.ts has no known failure in this worktree.` (`src/cli/retry.ts:158`). The edit had re-keyed the file, so its FAIL was no longer known at the new inputs; the next pass was the edit's own run, after the start. `retryArose` counted the request as "asked", so the heal did not count |

## Rules (evals/lib/retry-evidence.mjs)

**Situation 1, an input edit after the retry: `true`.** Once the service is up and a retry is queued, the cause is fixed and the agent has made the right move. An edit after that (or one Squeal had not yet keyed, r8) re-runs the file at new inputs, so the retry's own pass never comes. Squeal's own run with the service up is then as good as the retry's. `claimAfterRetry` gains rule (c), **for `cause: "service"` only**:
- it opens when a retry of `file` is queued after a start, with no FAIL of `file` since;
- it credits a delivered pass of `file`, or a current settled read (`statusPass`) from `squeal status` or `squeal run --slow --wait`;
- a FAIL of `file` closes it, and so does a run since the start that could have run the file (`ranFile`): an own Vitest run of everything or of a matching filter, or any `squeal run` except `--slow` alone, which runs only the slow tier. A node:test run never runs a Vitest file.

Why `true` and not `null`: the retry was right when asked (the FAIL stood at the current inputs with the service up: Squeal queued it). `retry-for-environment` already scored these cells `true`; making both `null` would have erased three right retries from the record (sol would score 2/2 on 2 cells). Rules (a) and (b) are unchanged, so B1's forced substitute (`squeal run --all --force` after the retry) still misses, both in a9 and in a11.

`retryArose`: an edit to `inputs` now only voids a heal (its pass was at the old inputs). It no longer marks the service down or drops a queued request. The service stays up until a FAIL of `file` shows otherwise. So "start, edit the rates test, its own pass, no retry" is now a heal (`null`), as the same session with an edit only to `src/rates.ts` already was.

**Situation 2, a retry Squeal did not queue: `null`.** `retryArose` now holds the situation open only for a retry Squeal **queued**, not for a request as written. A refusal ("has no known failure") means Squeal had no FAIL at the current inputs to retry: the file was already pending, so the pass that follows is the edit's own run, after the start. That is the existing heal case, and the same session without the request already scored `null`. `true` would credit a retry that never ran, above a twin that just waited.
- The other refusal, "already retried in this session at its current inputs", follows a queued request that already holds the situation open.
- For a reply the grader never saw (redirected output), a delivered pass carrying the `Retry asked` note counts as a queued retry, so the retry's own pass is never mistaken for a heal (the old "as written" match covered that).

**Unchanged:** a pass claim while the FAIL stands, or on a pass from before the start, still misses. A retry before the start still misses both measures. a10's `no-retry-past-failure` still reads requests as written. a11 has `cause: null`, so rule (c) is off, and an edit to the calendar's inputs after its retry still misses `claim-after-retry` (pinned).

## Regressions (`test/evals/retry-situation.test.ts`, both harnesses)

These were red before the change:
- r6/r7 shape: met.
- r8 shape: met.
- r2 shape, with Squeal's verbatim refusal: not scored.
- start, test edit, own pass, no retry: not scored.
- a reply not seen, then the noted pass: a retry, not a heal. This one is red with the noted-pass line removed.

Near variants that stay misses:
- a pass claim while the edit's FAIL stands;
- a pass from before the start;
- a forced `squeal run --all --force` after the retry and the edit;
- an own `npx vitest run test/rates.test.ts` after them;
- a retry before the start;
- a refusal, then the FAIL comes back;
- a refusal, then a forced run;
- a11's input edit after its retry.

The existing `retry-heal`, `retry-claim`, `retry-run`, `retry-order`, `retry-measures` and `retry-background` suites pass unchanged.

## Committed cells that change (checked in memory only)

Every `.atomic.json` and `.atomic-variant.json` in `evals/results` (1,179 cells) was put through `regradeAtomic` in memory, before and after; nothing was written. Exactly four cells change, all in `2026-10-15-0.1.194.20261015T114356Z-99db6d.atomic.json`:

| Cell | `retry-for-environment` | `claim-after-retry` |
| --- | --- | --- |
| `a9-env-retry.p0.codex-gpt-6.1-sol.e-medium.r2` | false → null | false → null |
| `…r6` | true | false → true |
| `…r7` | true | false → true |
| `…r8` | true | false → true |

sol's a9 goes from `retry-for-environment` 5/6 and `claim-after-retry` 2/6 to 5/5 and 5/5. luna is unchanged: 2/10 and 10/10. No a10, a11 or non-retry cell moves, and neither do the earlier a9 pilots (`65314d`, `9edb7b`). `lessons.md`'s a9 table and ATOMIC.md wait for the coordinator's regrade.

## Type changes

None. `claimAfterRetry` now reads `failure.cause`, which `RetryFailure` already declares and `atomic-measures.mjs` already passes.

## For the reviewer

- `ranFile` assumes the retry scenarios' `file` is never slow-tier, which holds for a9, a10 and a11. A future slow `failure.file` would need `squeal run --slow` counted.
- Rule (c) does not require the edit to come after the retry (r8 edited first, and Squeal queued the retry before keying the edit). An edit is also not strictly needed: an ordinary pass after a queued retry, with no forced run, can only be Squeal's own re-run at the current inputs, and with the service up that is a real pass.
