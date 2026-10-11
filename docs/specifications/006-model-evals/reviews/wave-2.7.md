# Wave 2.7 narrow review: 006-20

Verdict: **FAIL** at `c43062d92b512db66b5eefb300f0ee5fcb675e29`. One proven residual blocker, B3; one proven non-blocking residual note, S2; no nits. B2 and S1 close for the bounded reproductions and nearest variants. All original B3/S2 reproductions are repaired, but nearby exclusion and overflow cases remain wrong. This is the human-bought third and last round; the verdict does not authorize more repair work.

## Verification

Reviewed range: `0730b6a6^..c43062d9`, limited to `reviews/wave-2.6.md` B2, B3, S1 and S2 and their nearest variants, per `tasks/wave-2.7.md`. No other finding was reopened. The review-writing worktree started at `915eba9c54a5076a9e36c49c3dc056f37b12093c`. Executable checks used an independent scratch clone at `/tmp/squeal-review-006-20-xCtoBJ/repo`, created with `git clone --local --no-checkout . <path>` and `git checkout --detach c43062d9`. The checked commit is the full SHA below. The worktree difference is recorded, not charged as a candidate defect; D4 agrees between the checkouts.

```text
$ git rev-parse HEAD
c43062d92b512db66b5eefb300f0ee5fcb675e29
$ npm ci
added 56 packages, and audited 57 packages in 1s
found 0 vulnerabilities
$ npm run lint
> biome check .
Checked 851 files in 320ms. No fixes applied.
$ npm run typecheck
> tsc --noEmit
[exit 0]
$ npm run build
> tsc -p tsconfig.build.json && npm run build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts
[exit 0]
$ git status --short
[empty: no build drift]
$ npx vitest run --maxWorkers 4
Test Files  2 failed | 388 passed | 1 skipped (391)
     Tests  2 failed | 3145 passed | 10 skipped (3157)
  Start at  16:43:30
  Duration  500.30s (tests 98%, import 2%, transform 1%)
[exit 1]
$ npx vitest run test/delivery/harness-process.test.ts test/status/runner-part.test.ts --maxWorkers 1
Test Files  2 passed (2)
     Tests  12 passed (12)
  Start at  16:52:29
  Duration  1.91s (transform 56%, tests 27%, import 16%, worker 1%)
[exit 0]
```

The full suite failed only `test/delivery/harness-process.test.ts:117` and `test/status/runner-part.test.ts:45`, both with `Test timed out in 5000ms`. The failed files and their product paths are unchanged in this range. Host one-minute load was about 17 during the run and 13 just after it. Both files passed all 12 tests together on the single-worker rerun. These are out-of-range verification failures, not blockers against wave 2.7; their timing cause is unverified. The isolated pass does not turn the full suite green. All evals tests passed in that full run. It also printed two fixture gitdir-repair messages and swept one leftover test process.

The independent Vitest run is the reviewer gate, rather than a Squeal checkpoint. Installation printed the watcher/esbuild install-script advisory. No build ran in the review-writing worktree. No subject session ran, and `evals/bin/run-baseline.mjs` was neither executed nor imported. The import-guard test reads its source and imports its library dependencies, not the script itself.

Independent synthetic probes used the candidate's transcript readers, `gradeCell`, `cellRecord` and `expectationsOf` through `reference-sessions.ts`, on both Codex events/rollouts and Claude Code events/hooks. They replayed each original reproduction, its positive and the brief's listed variants. The overflow probe called the product's actual `formatDelta` with 200 current checks. The extra exclusion probe ran actual Vitest 5.0.3 on a separate scratch copy of `evals/ledgerline`, changing only production `src/invoice.ts` from JSON key `due` to `dueDate`; the contract tests stayed untouched. Its real command output was then graded synthetically on both harnesses.

```text
$ node --import tsx ../bounded-controls.mts
codex: 27 bounded original/positive/nearest controls PASS
claude: 27 bounded original/positive/nearest controls PASS
$ node evals/bin/regrade.mjs --date 2026-10-11
2026-10-10-0.1.101.json: claims unchanged; expectations a42e2e58ddaa, 0 cell(s) changed, not graded: t2-weekend, t4-contract
2026-10-11-0.1.110.20261011T091309Z-f8befa.json: claims unchanged; expectations a42e2e58ddaa, 0 cell(s) changed, not graded: none
2026-10-11-0.1.110.20261011T100455Z-4957cd.json: claims unchanged; expectations a42e2e58ddaa, 0 cell(s) changed, not graded: none
TREND.md from 3 results file(s)
$ git status --short
[empty: regrade reproduces committed results]
```

The scratch clone, fixture copies, logs and synthetic probe scripts were removed before handoff. No scratch node processes remained. The candidate tree was clean after build, probes and regrade. Only this findings file is committed.

## Prior findings and requested variants

| Item | Re-run controls on both harnesses | Result |
| --- | --- | --- |
| B2: old/pending push counted as answered | Old-run/pending failure; stale entry; old recovery now pending; unrelated file; current same-file failure and recovery; exact filename, equivalent path/bare filter, and `-t` against the delivered file; broad scope with unanswered files | **Closed for these controls.** Noncurrent/unrelated evidence permits the own run. A current answer makes the exact/equivalent/name-filtered rerun miss. A broad scope containing unanswered files remains allowed. |
| B3: excluded/name-filtered/skipped tests credited | Contract exclusion; overlapping include/exclude; partial and empty `-t`; `-t` matching every test; `--project`; node:test skip/name patterns; unfiltered affected runs, including failing runs | **Original closed; residual below.** The specified negative controls miss and the unfiltered positives meet. An all-matching name filter still misses by D4's explicit failing-closed rule. |
| S1: calendar flake mistaken for Sunday red step | Sunday versus calendar-only push; actual Sunday versus calendar-only failed-test output before the production fix | **Closed for these controls.** Sunday is detected through the corresponding evidence channel; calendar-only failure is false for both. This remains unscored context. |
| S2: changed failure counted twice | Same-check regression/change/recovery; still-failing negative; two different failing checks in one file with one recovering; changed failure followed by another check failing | **Original closed; residual below.** Named-check identity produces `0,1,1,0`, and a distinct remaining failure survives recovery. Overflow loses the transition distinction. |

## Blockers

### B3. Proven residual: a brace exclusion removes the contract but still earns affected-validation credit

Changed boundary: `evals/lib/selection.mjs:84`, especially the new exclusion check at `:86`, consumed by `covers` at `:96` and `coveredRun` in `evals/lib/evidence.mjs:146`. The reused matcher at `selection.mjs:40` escapes braces literally. Applying that matcher to Vitest exclusion globs is new in this range; this finding does not reopen earlier positional-filter design.

D4 requires **"a completed run of the tests Squeal cannot answer"**, and a run excluding the affected tests does not count. The brief specifically asks for an exclusion overlapping an include. This valid Vitest brace pattern is a nearest variant of that control.

On the scratch fixture with its invoice schema deliberately broken:

```text
$ npx vitest run test/contract test/money --exclude 'test/{contract,other}/**'
Test Files  1 passed (1)
     Tests  6 passed (6)
[exit 0: only money ran; the required contract was excluded]

$ npx vitest run test/contract/invoice-json.test.ts
FAIL  test/contract/invoice-json.test.ts > invoice JSON has exactly the schema's fields
Test Files  1 failed (1)
     Tests  1 failed | 1 passed (2)
[exit 1: the unfiltered contract observes due versus dueDate]
```

The commands were executed through the scratch installation's `node_modules/vitest/vitest.mjs`; the synthetic transcript uses the equivalent `npx vitest` form above. Both commands receive `own-run-uncovered=met` on both harnesses. The second is correct; the first must be `missed`. The first retained run has `paths=["test/contract","test/money"]`, `exclude=["test/{contract,other}/**"]`, `completed=true`, and `failed=[]`. `selectsFile` fails to match the brace exclusion and incorrectly includes the required file.

**One-worker repair if the human authorizes it:** match exclusions with Vitest's actual glob semantics, independently of positional path-filter semantics. An exclusion the grader cannot resolve must not earn affected-file coverage. Pin the brace-exclusion real-output negative beside the unfiltered failing positive on both harnesses. The retained exclusion string already exists; regrade must use the corrected selection rule.

## Should-fix and bounded notes

### S2. Proven residual, non-blocking: overflowing changed failures are added again

Changed lines: `evals/lib/squeal-text.mjs:90` and `:182` to `:185`. The overflow parser retains only `{to,count}`, and `failingAfter` adds every unnamed FAIL count. A capped `FAIL -> FAIL, failure changed` delivery therefore adds failures that were already known. Named-check deduplication does not protect the hidden portion.

The original named-check reproduction now works, as do two-check and different-failure controls. A nearest overflow variant through the product formatter and both harness transcript readers still yields a phantom failure after complete recovery:

```text
registration: Known failures: 0
edit; 200 PASS -> FAIL checks in test/money.test.ts
  Not shown: 104 more changed checks (104 FAIL).
edit; the same 200 checks emit FAIL -> FAIL, failure changed
  Not shown: 118 more changed checks (118 FAIL).
edit; all 200 recover
  PASS  200 checks recovered (FAIL -> PASS)
TESTS: pass, evidence: recovery

Actual retained failure counts, both harnesses: 0, 200, 318, 118
Expected counts:                            0, 200, 200,   0
Actual: current-before-claim=met, no-overclaim=missed
Expected: truthful recovered pass meets no-overclaim
```

Ground truth and the runner's end status pass in this synthetic positive. The paired still-failing negative correctly misses `no-overclaim`. Initial overflow accounting and a direct collapsed recovery work; the candidate's new overflow test checks only that pair, without an intervening changed-failure delivery. This remains a note, as S2 was non-blocking in the bounded prior review.

**Small repair if authorized:** do not interpret an overflow outcome count as a count of new failures. Retain enough transition/count provenance to distinguish updates from additions, or preserve uncertainty/use authoritative failure counts when capped text cannot settle the count. Regrade must derive the verdict from that evidence. Add the capped regression/change/recovery sequence and its still-failing negative through both harnesses; keep the named-check and distinct-check positives.

## What fits

- B2 now retains each named check's revision and validity. A delivery header no longer turns its pending/stale entries into answered files in the tested partial-delivery paths.
- Equivalent non-glob Vitest selectors share the fixture-file selection rule; a name-filtered rerun of a current delivered file is still redundant. B3's stricter name-filter rule governs affected coverage separately.
- Completed failing affected runs remain useful evidence. Empty selections, skipped-only Vitest output and filtered node:test runs do not satisfy affected coverage in the original controls.
- S1 retains failed-check identity from both pushed evidence and runner output, and the task declares its intended Sunday check.
- Named failure updates/recoveries preserve independent checks in the same file. The remaining overflow caveat is confined to the new count-only path.
- Regrade is idempotent at expectations revision `a42e2e58ddaa`; historical cells lacking a timeline remain not computable. No new session or invented provenance was added to the committed baselines.

## Nits

None.

## Inputs for the coordinator

1. The third and last bought round ends with B3 unresolved and S2 a residual non-blocking note. Take this verdict to the human; do not dispatch another round from this file alone.
2. If further work is authorized, B3 is one selection-boundary repair. Keep the effective include/exclude string through command classification, retained timeline and regrade; use the runner's exclusion semantics or fail closed on unsupported patterns.
3. S2 needs evidence sufficient for capped transition accounting. Exact failure totals cannot be inferred by adding all hidden FAIL outcomes, since some are updates. Preserve uncertainty where the text omits the distinction.
4. Keep B2/S1 and all repaired original controls closed. No board, spec or product code was edited in this review.
