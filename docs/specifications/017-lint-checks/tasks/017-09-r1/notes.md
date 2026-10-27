# 017-09.R1: findings belong to their keying

Worker 835e9249, 2026-10-27. Repair of review `reviews/0.1.360.md` B1, brief `tasks/wave-2.5.md`. Changed: `src/core/lint/surface/news.ts`, `src/core/lint/surface/deliver.ts`, and three new test files under `test/lint/surface/`. No CLI, formatter, provider, key, shared delivery, `report.ts`, `lint-delivery.ts`, bundle, version, board or status file changed. No existing test file changed.

## Cause

`planLintNews` took the consumer's own transitions since its mark as a file's evidence. A transition from before the last first or config keying was judged under the config before it. The keying then judged the file again with no transition (D2's last row). So the plan named the old config's finding next to the new state's count, and the summary computed after it did not remove the entry.

## Repair

- `LintPlanInput` gains `keyedAfter`: the last keying's transition id (`LintKeying.transition`, the producer's boundary from 017-09's `7d6e04833`). It is internal to the surface: `planLintNews` has no other caller.
- `fileStep` counts a transition as evidence only when its id is above both the file's base and `keyedAfter`. The change before the keying is taken in by count. The keying's summary tells it once its files are linted.
- `lintStep` reads the keying record once, in the same read transaction as the transitions (`store.read` is one deferred `BEGIN`). `summaryOf` takes that record, so the cut and the summary come from one state.

### Why the cut is safe once the summary was told

A told summary writes `deferred: []` and `transition: lastId`. That read saw the keying, so `lastId >= keying.transition`. Registration also writes `lastId`. So for a consumer that already heard a keying, every transition the plan sees is above the boundary, and the cut changes nothing. The cut only acts while the keying's summary is still owed.

## Decisions the brief did not settle

1. **The cut is conservative, as Stop's is (D8 Blocking).** An own edit from before a config keying is not told per file, even when the keying did not change that file's result (for example a config change that only added a comment). The agent hears `Lint config changed: N files with findings now; squeal lint lists them.` and `squeal lint` lists the file. It never hears a finding that is not in the file's result. A finer rule would compare the transition's resulting fingerprint with the state's. I did not build it: the brief names the keying boundary, and it would be a second rule beside Stop's.
2. **An edit to a file the keying left pending records no transition.** The pass judges such a file with cause `config` (`rekey.ts` `judgeAll`, `lint-part.ts` `judge`), so that edit is told only through the summary's count. This is producer behavior, not changed here. It gives no wrong result. The pending-summary test edits a file that was already linted again, so its edit records a transition.
3. **An edit while the summary waits is told at once, against the view the consumer holds.** In the pending-summary test the view says `a` passes, so the edit reads `pass-to-fail src/a.js +no-alert` with 2 findings: the `no-undef` the new config gave is counted, not named. The summary follows once the keying's last files are linted.

## Tests

| File | What it checks |
| --- | --- |
| `test/lint/surface/keyed-news.test.ts` | Fake provider. B1: summary only, then a genuine edit after the keying (`fail-changed +no-alert`). An edit after the keying beside the summary. An edit while the summary waits: the keying's backlog is two parts, the second held, so the news has the edit and no summary, then the summary only. Acknowledgements across the keying: a read from before it acknowledged after it; newest then oldest; oldest then newest. |
| `test/lint/surface/keyed-delivery.test.ts` | The shared delivery (`createDelivery`, `formatDelta`): header `SQUEAL · revision 3` and the summary as the only lint line; a failed main-store commit (`consumers.touch` throws) tells the summary once more, with no old finding, then a genuine edit. |
| `test/lint/surface/keyed-eslint.test.ts` | The review's sequence with ESLint 9 and 10 core rules, the real provider and pass. Each stored result equals a fresh `eslint -f json` before the news is read. The news is the summary only; a later edit and an edit before the summary's delivery are told with the `no-unused-vars` finding for `other` only, and each named finding is in the file's result. |

`HeldProvider` in `keyed-news.test.ts` holds the first lint call that asks for a named file. Its holds are released in a `finally`, so a failed step does not leave the pass waiting for the hook timeout.

The existing controls are unchanged and pass: `race.test.ts` (an edit between read and acknowledgement, out-of-order acknowledgements, a commit after the read-only look) and `test/lint/wiring/delivery.test.ts` (a failed main-store commit; a pass commit between the lint read and its acknowledgement).

## Checks run

- Red first, Squeal revision 1: 4 of the 6 `keyed-news.test.ts` tests failed with the review's error, for example `"pass-to-fail src/a.js +no-console +no-alert"` where `+no-alert` alone was expected. The 2 that passed are acknowledgement-order controls, which must pass with or without the cut.
- Mutation check, Node 22.19.0: with the cut removed (`const after = base;`), `pnpm exec vitest run test/lint/surface/keyed-eslint.test.ts test/lint/surface/keyed-news.test.ts test/lint/surface/keyed-delivery.test.ts --maxWorkers=2` gave `Test Files 3 failed (3)`, `Tests 10 failed | 2 passed (12)`. All 4 real ESLint tests failed, on both majors. The committed `news.ts` was restored with `git checkout`.
- Node 22.19.0, with the fix: `pnpm exec vitest run test/lint/surface test/lint/wiring --maxWorkers=2` gave `Test Files 17 passed (17)`, `Tests 64 passed (64)`.
- Squeal, revision 8: `keyed-eslint.test.ts` current, no failures (Node 24.21.0, the daemon's Node).
- Squeal, revision 6: the 16 test files in `test/lint/surface` and `test/lint/wiring`, current, no known failures.
- `pnpm run lint`: exit 0, `Checked 2417 files in 1415ms. No fixes applied.`
- `pnpm run typecheck`: exit 0, no diagnostics.
- Squeal affected read at revision 14 (`squeal status --wait` on the two source files and three test files): see the final report for the last count. `news.ts` and `deliver.ts` select 614 test files through the shared delivery.
- **Known failures, expected: the four bundle tests.** `test/harness/plugin.test.ts`, `test/harness/codex/plugin.test.ts`, `test/harness/opencode/package.test.ts` and `test/harness/pi/package.test.ts` fail with "differs from the build": the hook bundles hold `deliver.ts` and `news.ts`. The brief forbids a build in a worker tree; the integration rebuilds.
- Not run: a full suite or checkpoint, a build (the brief).

## For the next worker and the re-review

- `keyed-eslint.test.ts` bundles the real worker at test time, as `test/lint/integration/` does. `squeal.config.json` gives `src/core/lint/**` as inputs only to `test/lint/provider/**` and `test/lint/integration/**`. A change to the worker's sources may leave this file's result current. Adding `test/lint/surface/keyed-eslint.test.ts` there is the coordinator's call.
- B2 (`lint --changed`) is 017-10.R1's. This repair does not change `lintChanged`.
