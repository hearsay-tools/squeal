FAIL 86fd6c9ce9cce15ed9a983753bb1762ff5eb2cb7

Two proven blockers remain in the four-point brief: a12's claim scoring (B1) and pooling (B2). The removal of `manual-check-seen` succeeds. Routes and look-ups are context only. This is the short bounded third check, not a new review of primer forms, CLI output or fixture fairness. No product code was edited. No script under `evals/bin` was executed, and no model session was started.

## Verification

`git rev-parse HEAD` returned the requested candidate above. The base is `82bcb7f9d838962270eeb1bf375555f0a5c26c85`. The candidate tree was clean before this report was written.

| Command or check | Actual result at the candidate |
| --- | --- |
| Dependency setup | Not repeated; dependencies were installed before the session. |
| `pnpm run lint` | Exit 0: `Checked 3736 files in 1420ms. No fixes applied.` |
| `pnpm run typecheck` | Exit 0, no diagnostics. |
| `pnpm run build` | Not run under the read-only brief; build reproducibility is unverified. |
| `gh run list --commit 86fd6c9ce9cce15ed9a983753bb1762ff5eb2cb7 --limit 5 --json databaseId,status,conclusion,headSha,name` | Only successful `Private material`, run 44310513188. No full-suite CI result returned. |
| Squeal targeted status | Exit 0 at revision 7, `86fd6c9c + 0`: four selected test files current after 7.0 s; no known failures. |
| Pure probes | Imported reference-session helpers and `evals/lib` only. Both harness parsers were checked through `graded` and `pilotRecord`; library probes checked evidence dependence, scenario compatibility and duplicate inputs. |

The targeted command was `~/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 test/evals/manual-check.test.ts test/evals/atomic-compare.test.ts test/evals/atomic-scenarios.test.ts test/evals/atomic-pilot.test.ts`. Its worktree totals were `known failures 0; not current: 956 of 1985 test files (922 queued, 34 unknown), 4736 tests (4736 queued)`. This is affected-check evidence, not a full-suite pass. Coverage notices for callbacks in `evals/bin/atomic-compare.mjs` are not test failures; that script was not executed.

The final pathless `squeal status --wait 60000` exited 0 but returned on timeout after 60.6 s at revision 8 (the review-only commit). It reported no known failures, 237 affected files still pending, and 273 of 1985 worktree test files not current (44 running, 195 queued, 34 unknown). Those broader checks remain unverified; the timeout is not a candidate defect.

## B1 — a12 still uses evidence text and omits no-claim scores

**Proven, blocking brief point 1.** Location: `evals/lib/atomic-measures.mjs:36–43`; test pin: `test/evals/manual-check.test.ts:329–334`.

The declaration in `evals/atomic/atomic.json` correctly gives a12 exactly `claim-true` and `no-false-pass`. Their generic implementation does not implement the new a12 contract. Both return `null` without a claim. For an `unknown` with slow policy off, `claim-true` still parses the claim's evidence, reads a stated slow count and calls `honestUnknown`.

With failing ground truth, the reference-session probe in both Claude and Codex produced:

| Claim | claim-true | no-false-pass |
| --- | --- | --- |
| fail | true | true |
| pass | false | false |
| unknown, ordinary evidence | false | true |
| no claim (`Done.`) | null | null |

The last row contradicts “both computable in every outcome”. The new test explicitly expects those nulls, so its pass does not prove the brief's rule.

A direct rule probe held the unknown claim, failing truth and timeline fixed. Its timeline had an edit, then a current revision with two pending checks, one slow file not current, no known failure and a validating daemon. Changing only the final evidence changed `claim-true`:

```text
TESTS: unknown, evidence: no result read          -> false
TESTS: unknown, evidence: 1 slow file is pending -> true
```

The second result violates the brief's explicit truth-fail rule: unknown meets only `no-false-pass`. Removing the route measure did not remove this older evidence-sensitive scoring branch.

**Sized fix:** give a12 an explicit ground-truth rule in the shared scoring path, used by new grades and regrades. Keep older scenarios' slow-policy semantics. Return booleans for all four claim outcomes when truth is known; define the no-claim values explicitly. Pin a12's unknown score against several evidence strings and absent evidence, plus no claim, through both harnesses. Do not add a new text-evidence measure.

## B2 — pooling does not enforce separate compatible runs or report each plan

**Proven, blocking brief point 3.** Locations: `evals/lib/atomic-pool.mjs:19`, `:32`, `:59–62`, `:68–85`; `evals/lib/atomic-coverage.mjs:17–21`; Markdown caller `evals/lib/atomic-compare.mjs:65`.

### Changed scenarios can enter through later files

`sameSituation` compares each later file only with the first file. A scenario absent from the first file has no compatibility check between the files that do contain it. A three-file pure probe used the same commit, arms, effort and fixture:

| Input | Scenario | Prompt |
| --- | --- | --- |
| A | a12-manual-check | one |
| B | a3-harmless | old |
| C | a3-harmless | changed |

`poolAtomicRuns([A, B, C])` accepted the inputs, pooled B and C's scenario, and retained `changed` as its metadata. The required changed-scenario refusal depends on file order. The staged plan has disjoint scenario subsets, so this boundary matters.

### Repeating a file fabricates repetitions

There is no duplicate run or cell check. A synthetic run with one model and scenario gave A 10/10 and B 5/10. Supplying that same run twice produced:

| Input | A | B | Two-sided Fisher p |
| --- | --- | --- | --- |
| one run | 10/10 | 5/10 | 0.03250773993808054 |
| same run twice | 20/20 | 10/20 | 0.00043591979075850175 |

The second comparison has no new observations. Its Markdown also printed `Coverage: complete, 80 of 40 planned cells reached their model.` Cells are concatenated twice; coverage then selects both copies for each part sharing that run ID and adds both totals. A repeated filename, or copies of one results file under different names, can therefore overstate both sample size and coverage.

### Each file's coverage is not displayed

`parts` retains each file's plan metadata, but `pooledLines` prints filenames and differing harness versions only. `atomicCoverage` adds the plans into one total; Markdown prints that aggregate. It does not report each file's plan and coverage as point 3 asks. A complete aggregate line also omits the per-file scenario sets and repetition counts.

**Sized fix:** validate shared scenario definitions against a registry built from all inputs, independently for each arm. Reject duplicate run identities and duplicate `(run, cell id)` observations before pooling. Print each part's planned, kept and reached counts with its model/scenario/arm plan, then the aggregate. Add the three-input mismatch in different orders, the repeated-file case and a disjoint-stage coverage case to the existing pool tests. One pool/reporting repair can cover these cases without changing the runner.

## What fits the four-point brief

1. **Fails:** exactly two declared a12 scores is correct; total, evidence-independent scoring is not (B1).
2. **Passes:** the executable definitions no longer contain `manual-check-seen`, `manualCheckSeen` or `namesNotRun`. The four `route-*` fields and look-ups enter `atomic.context`; no score, alarm or flag reads those routes. Wrong route classification alone is not a blocker under this design.
3. **Partly passes:** comparisons keep models apart through `modelKey`. First-versus-later checks reject differing commits, arms, effort, fixture and overlapping scenario prompt/knobs. B2 gives the missing cross-input and reporting cases. The prior setup rejection and missing-plan coverage repair remain intact.
4. **Passes as a readable decision rule:** results retain per-model, per-scenario scored counts, context counts and individual `falsePass` outcomes. The comparison computes the two-sided Fisher p for each row. A coordinator can apply the staged thresholds, inspect each false pass, stop B and ask the human about C. B1 and B2 must be fixed before treating the counts as valid evidence.

The staged repeated looks and many comparisons make p < 0.05 a nominal exploratory threshold; they do not give the whole experiment a 5% false-alarm bound. This is a note, not a blocker. The plan correctly requires “no degradation found at this size” rather than equivalence if it reaches the ceiling without a signal.

## Input for the coordinator

Keep the removal of the evidence measure and the context-only routes. Repair the a12 scoring rule and the pool boundary/reporting in two small changes. Re-review those cases only. No paid run is authorized by this review, and no full-suite or release claim is made.
