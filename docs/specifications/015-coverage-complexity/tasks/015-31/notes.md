# 015-31 notes: a held edit reports no crossing that only a later threshold change made

Worker f9416aba, 2026-10-24. From main at 5b7c15914 (0.1.293 on main). Brief: `tasks/wave-2.md`, "W3: 015-31". Finding: `reviews/0.1.293-r2.md` N1. No bundle was built and the version was not raised.

## The defect

N1's sequence: revision 1 counts `f` at CC 3, a pass at threshold 20. Revision 2 edits it to CC 4 and the count throws (an edit's failure, not quiet). A threshold recount to 2 holds the path: its retry is not due, so its states stay CC 3, pass, threshold 20. The retry counts CC 4 and judged it at 2 against the stored pass: `pass-to-fail`, told in full, and a session regression for `wentOverSince`. The edit crossed nothing under either threshold.

`test/code/pass/retry-held.test.ts` reproduced it before the fix: three of its tests recorded a transition (N1, a function the held edit added, a PASS that only a raised threshold makes), and the genuine CC 3 -> 23 control passed.

## The rule as built

- **The record.** `FailedCount.threshold` (`src/core/code/pass/failed.ts`) is the threshold of the first edit whose count failed at the path. `failedAgain` keeps it while the path's counts fail, at the same blob and at a new one, because no pass judges the path until a count succeeds. A quiet record (first count or recount, B1) has no threshold. A new blob that fails in an edit pass after a quiet record takes that pass's threshold. `restartRetries` keeps it, as it spreads the record.
- **The pass.** `runPass` (`pass.ts`) passes the path's record threshold to the judge as `FileAfter.editedUnder`, at any blob, before the judged paths lose their records. `Attempt` carries the pass's threshold to `failedAgain`.
- **The judge.** `judge` (`judge.ts`) records a transition for a counted check only when `byPolicy` is false: the count's outcome is the same at the current threshold, at the threshold its prior state was judged at (`was.threshold`), and at `editedUnder`. `byPolicy` takes both, which keeps `judge` at CC 19. The state is still written at the current threshold, and `edited` is marked as before.
- **Why this is the brief's order.** The brief says: judge the retry as the edit under its own threshold, then the policy change as the recount's (quiet). With two outcomes, the edit's crossing under the old threshold survives the quiet re-judge only when the new threshold gives the same outcome. In that case the transition from the stored state to the final state is that same crossing. In every other case the final state equals the stored one, or only the threshold moved it. So "record only when the outcome agrees at every earlier threshold" gives the same transitions, without a second judge.
- **`removed`.** Unchanged. A function gone from a held file was `fail` at its stored threshold, and its removal is the edit's.
- **Delivery.** With no transition, the planner takes the failing function into the view by count, and Stop's `complexity.blocking` check does not count it (`wentOverSince` reads transitions). The recount's summary line already told the new threshold. The FAIL line of a genuine crossing gives the state's value and current threshold (`entryOf` reads the state).

## Tests

`test/code/pass/retry-held.test.ts`, six tests, each with the delivery to a session registered at revision 1 (`told`) and its Stop regressions (`wentOver`):

| Test | Checks |
|---|---|
| CC 3 -> 4, threshold 20 -> 2 while held | no transition; state fail at 2; nothing told; no regression (the done-when) |
| CC 3 -> 23, same sequence | `pass-to-fail` told in full; a regression (the done-when control) |
| a function the held edit added at CC 4, 20 -> 2 | no first-seen fail: needs the record's threshold |
| a second edit fails after the recount | the record keeps 20, not the second pass's 2 |
| a recount's count fails (quiet), then an edit's | the record takes 2; the state's 20 stops the false crossing: needs `was.threshold` |
| 23 -> 24 and 23 -> 3, threshold 20 -> 30 | no PASS for the first; `fail-to-pass` for the second |

Mutation check, run with `npx vitest run test/code/pass/retry-held.test.ts` on the first form of the commit: without `was.threshold`, only the quiet-then-edit test fails. Without `editedUnder`, only the added-function test fails. With `failedAgain` taking each pass's threshold, only the second-edit test fails. The code was restored after each.

The R2 tests (`retry-quiet.test.ts`) stay green. Their `told` helper moved to `test/code/pass/told.ts`, shared with the new file, and now reads the store's edits as the delivery does (`edit: () => null` before). Their assertions did not change. `retry.test.ts`'s `toEqual` on an edit's record now includes `threshold: 20`.

## Decisions the spec did not settle

- **Conservative when edits are unknown.** When two edits failed in turn across a threshold change, the intermediate count is unknown. The record keeps the first edit's threshold. So a function added by the second edit, which crosses only under the new threshold, is not told as a first-seen fail; `squeal code` and status still count it. The other choice (the latest edit's threshold) would tell a function the first edit added under the old threshold as a new FAIL: N1's defect again. D1 says a policy change never delivers per-function lines, so I chose the side that never tells a crossing a threshold change could explain.
- **Both thresholds, not one.** `was.threshold` alone misses functions with no prior state. The record alone is wrong after a quiet record (its threshold is the recount's, while the states keep the earlier one), and for a record written by 0.1.293, which has no threshold. The judge uses both.
- **Only an edit's record has a threshold.** A quiet record seeds quietly, so its threshold would never be read.

## Type changes

All additive except one internal signature:

- `FailedCount.threshold?: number` (`failed.ts`). A record written by 0.1.293 has none: its retry is judged with `was.threshold` only, and its next failure at the path takes that pass's threshold.
- `FileAfter.editedUnder?: number` (`judge.ts`).
- `Attempt.threshold: number` (`blobs.ts`). Its only caller is `runPass`.
- `failedAgain(previous, blob, error, { now, quiet, threshold })`: the last parameter gained `threshold`. Its only caller is `fail` in `blobs.ts`.

## Residue for the next worker

- **A move out of a held file.** A function moved from a held file to another file in the same pass is judged with the moved state's threshold (`was.threshold`). That is the intended reference, but no test covers a move across a threshold change.
- **`changedAt`.** A function that only the new threshold put over gets `changedAt` at the retry's revision, as a recount's re-judge would give the recount's revision. `squeal code` sorts by it.
