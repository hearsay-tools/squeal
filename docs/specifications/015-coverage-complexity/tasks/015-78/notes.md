# 015-78 notes: passes beside a skipped loader

Worker bbc46d31, 2026-10-27, from `tasks/wave-19.md` W1 (coordinator 8b2a8995). Shape: slice. Spec D9, **A pass beside skipped tests** (the human, 2026-10-27, option (a)); `lessons.md` Round 2, C1.

## What changed

| Part | Change | Where | Test (red first) |
|---|---|---|---|
| The gate | `judgeEarly` judged an unknown or pending file only when it held a `crap` or `uncovered` failure (`cache.failing`). A file `unknown` with cause `skipped` is now judged early without that check. | `src/core/code/crap/walk.ts` | `test/code/crap/skipped-pass.test.ts`, first case (red: `hot unknown -`) |
| The judgement | An early judgement gives only `fail-to-pass` (015-57). With the new mark `Judged.skipped` it also writes `pass` over a state no judgement made (none, `pending`, `unknown`). Under `drop` it also writes `pass` over a pass that another loader set judged. It never writes `fail`, and it makes no transition (`besideSkip`). | `src/core/code/crap/judge.ts` | `skipped-pass.test.ts`, all five cases |
| A new loader set | An early judgement with records in hand at the same signature was not judged again. When a loader's rerun skips, the loader set changes (`drop`) and the records in hand do not. The early pass from the pending step was then dropped to `unknown`. A skipped file at a new loader set is now judged again, so the passes it proves are kept. | `walk.ts` (`!(skipped && drop)`) | `skipped-pass.test.ts`, "keeps a pass proven while pending once a rerun skips" (red: `cold unknown -`) |
| Retired check | `step.test.ts` "reads unknown for skipped" asserted the retired rule (every function `unknown` beside a skip). Now it asserts that the functions the passing record runs read `pass` and `cold` reads `unknown`. The `unkeyed` and `unread` rows stay all `unknown`. The file still reads `unknown, skipped`. | `test/code/crap/step.test.ts` | the same case (red after the change, green after the table edit) |

`judgeEarly` went to CC 22 with the change. Two helpers bring it back to 14: `earlyOf` (the summary's early signature at the blob) and `marksOf` (the `Judged` marks).

## What the tests pin

- A passing loader plus a skipped one, with no judgement before. `hot` (run, CRAP 12) reads `pass` in both measures. `big` (run, CRAP 35) reads `uncovered pass` and `crap unknown`. `cold` and `wide` read `unknown`. Nothing is told and no transition is stored. The next step with the same records judges nothing (`judged: 0`).
- The passing loader stores a new record that runs `cold`: `cold` reads `pass`, quietly. A pass judged with the same loader set keeps its value: `hot pass 12` stays, and `big`'s `uncovered pass` stays.
- Records that cannot confirm the source's bytes (another blob; `unread`) prove nothing. The only exception is a CRAP that no coverage can raise over the threshold (see decision 2).
- A real failure that a new test passes, beside a rerun that skips: `FAIL -> PASS` is told once. A later step with the same records tells nothing. The judgement with every record (the skip gone) tells nothing more. `big` and `wide` go back to `fail` quietly from `unknown`, as 015-75's drop already did.
- A pass proven while the file was pending, then a rerun that skips: the pass stays, and nothing is told twice.

## Decisions the spec did not settle

1. **Trigger: file cause `skipped` only.** The new path runs when the file's summary cause is `skipped`, the cause status shows. `CAUSES` orders `unkeyed` before `skipped`. So a source with one unkeyed loader and one skipped loader reads `unknown, unkeyed` and gets the 015-57 rule only. For `no-record`, `unkeyed` and `unread` sources the proof is equally sound: more records only add covered lines. The amendment names only skips, so I did not widen it. The `step.test.ts` table pins this.
2. **A function with CC ≤ 5 reads CRAP `pass` with no line covered.** The early bound with no line covered is `CC² + CC`, which is 30 at CC 5. So beside a skipped loader, any function with CC ≤ 5 reads `crap pass` (value `CC² + CC`) once a ready loader exists. This is true even when no record in hand confirms the bytes. Its `uncovered` state stays `unknown`. No coverage can make such a function fail CRAP, so the pass is true, and a full judgement gives `pass` too. The other choice was to require at least one record entry at the current blob before the new path writes anything. That needs `coverageOf` to report whether a source joined. I did not do it. `skipped-pass.test.ts` pins `tiny pass 6`.
3. **A pass judged with the same loader set is not written again.** Its last value came from a full judgement and is no higher than the early bound. Writing the bound could raise a shown value. Under `drop` the old pass stands for other loaders and goes anyway, so the early bound replaces it.
4. **A failure passes only by `fail-to-pass`.** This is unchanged, with the threshold check from review 0.1.324 B2. `besideSkip` refuses `was.outcome === "fail"`. So under `drop`, a failure that only a `crap.threshold` change would pass goes `unknown`, not `pass`.
5. **The skipped loader's own record is not counted.** The loader that skipped keeps condition `unknown` (`loaders.ts`), so its record is not in hand. The brief said "even when another loader skipped". Lessons C1 says most skips are timing tests in files that also hold tests that ran. Those files' own records would prove the functions they run. That needs `LoaderCondition`'s `skipped` kind to carry its key and `storedAt`. A source whose only loader skipped still reads `unknown` for every function.

## Type changes (additive)

- `Judged.skipped?: true` (`src/core/code/crap/judge.ts`). It is not exported beyond `Judged`, and no store, summary or wire shape changes.

## Found, not changed (outside this slice)

- **015-75 drop loses a pass proven while pending, for causes other than `skipped`.** I checked this with a throwaway step test (since deleted), at commit `918af045d`. The sequence: judged; rerun queued; a new test proves `cold` (`cold pass 6`, told). Then the rerun has no record after `RECORD_WAIT_MS`, so the cause is `no-record`. Then `cold` reads `unknown`. The early signature is the same, so `judgeEarly` returns before it judges, and `dropKept` takes every state. The spec's 015-75 text says "a pass the records in hand prove ... is judged first and kept". The fix would be the same as this row's (judge again at `drop`, and write a proven pass over a pass under `drop`) for every unknown cause. That widens 015-78's rule, so it is the coordinator's call. No false failure results, only a lost pass.
- **A threshold change keeps an early pass.** An early judgement never writes `fail`. A pass judged early at threshold 30 stays `pass` after the threshold falls under its bound, until a full judgement. Kept states of unknown sources behave like this already.

## Checks run

- `squeal status --wait 60000 test/code/crap/*.test.ts` at revision 7 (`30983782 + 1`): `Named test files at revision 7: no known failures; 32 test files, each with a current result`. At revision 6, before the `step.test.ts` edit, the same command showed `step.test.ts > reads unknown for skipped` failing (`- "hot unknown -" ... + "hot pass -"`). That was the retired assertion.
- `squeal status --wait 60000` on `test/code/coverage/*.test.ts`, `test/code/delivery/*.test.ts`, `test/code/coverage/pace-shared.test.ts`, `test/code/delivery/pulled-coverage.test.ts`, `test/code/pass/unlisted.test.ts`, `test/evals/code-lines.test.ts` and `test/runners/node-test/coverage.test.ts`, at revision 7 (`918af045 + 0`): `no known failures; 38 test files, each with a current result`. The wait asked one run of 9 coverage writer files that were unknown.
- `npm run typecheck`: clean.
- `npm run lint` (`biome check .`): `Checked 2381 files ... No fixes applied.`
- Not run: a full suite and a bundle build (brief). The walk and judge files select 758 test files. At revision 7, about 700 of them were still queued behind the vitest lane's 120 s quiet wait. Those outside the files listed above have no verdict from me.
