FAIL 06422a59a608263b6155df58e30878b3db98c4da

One proven blocker remains: B1. B2 is closed. S1 and the named S2 cases are addressed. This is a bounded re-review of `exp-minimal-primer-design.md`, the two repair commits `6332a8d69` and `2c9f18784`, and their changed interfaces. No product code was edited. No script under `evals/bin` was executed.

## Verification

The resumed checkout initially held the previous review commit, `662c6a94a`. Its tree was clean. I switched to the requested candidate before verification; `git rev-parse HEAD` then returned `06422a59a608263b6155df58e30878b3db98c4da`. `origin/main` was the requested base, `87cebc38e388adb79736f07f0ee6ee872bf98cc9`. The checkout stayed clean until this review file was written. The initial checkout mismatch was corrected before reviewing; it is not a finding against the candidate.

| Command or check | Actual result |
| --- | --- |
| Dependency install | Not repeated. Dependencies were already installed. |
| `pnpm run lint` | Exit 0. `Checked 3724 files in 1555ms. No fixes applied.` |
| `pnpm run typecheck` | Exit 0. `tsrs --fast --noEmit`, no diagnostics. |
| `pnpm run build` | Not run under the read-only brief. Build reproducibility remains unverified. |
| `gh run list --commit 06422a59a608263b6155df58e30878b3db98c4da --limit 5 --json databaseId,status,conclusion,headSha,name` | Only `Private material`, run 44301988414, completed successfully at the exact SHA. No full-suite CI result returned. |
| First Squeal path wait | The four real selected files were current at revision 4 with no known failures. The command exited 3 because I also supplied the nonexistent `test/evals/transcript.test.ts`; it had no closure. This is not a passing command. |
| Corrected Squeal path wait | Exit 0 at revision 4: all six selected test files current, no known failures, after 1.7 s. |
| Local probes | `node --import tsx --input-type=module` imported `test/evals/reference-sessions.ts` and `evals/lib` only. Both harness parsers, the grade and `pilotRecord` were exercised. Outputs are below. No Vitest or model process was started by these probes. |

The first path wait used `~/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000` with `test/evals/manual-check.test.ts`, `test/evals/check-knobs.test.ts`, `test/evals/atomic-compare.test.ts`, `test/evals/grade.test.ts` and the nonexistent transcript path. Its actual output was:

```text
Selected: test/evals/manual-check.test.ts, test/evals/check-knobs.test.ts, test/evals/atomic-compare.test.ts, test/evals/grade.test.ts
Named test files have no verdict: no test file's closure holds test/evals/transcript.test.ts; the test files the other paths select at revision 4: no known failures; 4 test files, each with a current result, after 3.5 s.
Worktree: known failures 0; not current: 338 of 1978 test files (36 running, 1 queued, 301 unknown)
```

This is affected-check evidence, not a full-suite pass. The earlier known key-format failure recovered after the candidate checkout; it is not a new blocker. Unrun checks remain unverified.

The corrected command was `squeal status --wait 60000 test/evals/manual-check.test.ts test/evals/check-knobs.test.ts test/evals/atomic-compare.test.ts test/evals/grade.test.ts test/evals/atomic-regrade.test.ts test/evals/evidence.test.ts`. It returned `6 test files, each with a current result`; worktree totals were `known failures 0; not current: 338 of 1978 test files (36 running, 1 queued, 301 unknown)`.

## B1: still open, proven

The four original command cases are repaired. In both harnesses, help-only, empty-selection, queued-only and no-daemon reference sessions now return:

```json
{"no-false-pass":true,"manual-check-seen":false}
```

The new result-evidence path is better than crediting a request. Two routes still reward a wrong session.

### B1a. A name-filtered own run skips the broken test but earns full credit

Location: `evals/lib/check-evidence.mjs:61`, called at line 42. Supporting recording: `evals/lib/grade.mjs:149` and its `ranFiles` helper.

`ownRunShows` requires a completed Vitest summary and a file named in the output. It no longer checks the run's selection scope. A file can appear in a passing summary while its failing test was skipped by a name filter.

The fixture makes this concrete. `evals/ledgerline/test/contract/invoice-json.test.ts` has two tests. The requested new `lines` field breaks “invoice JSON has exactly the schema's fields”. “amounts are integer cents” still passes. After the edit, this command selects only the passing test:

```sh
npx vitest run test/contract/invoice-json.test.ts -t 'amounts are integer cents'
```

The probe supplied its normal passing-file summary with `1 passed | 1 skipped`, then an unsupported `TESTS: fail` claim, with failing ground truth. Both Claude and Codex reference parsers retained:

```json
{"k":"run","runner":"vitest","informational":false,"scope":{"full":false,"paths":["test/contract/invoice-json.test.ts"],"names":["amounts are integer cents"]},"completed":true,"exit":0,"failed":[],"files":["test/contract/invoice-json.test.ts"]}
```

Both returned `no-false-pass: true` and `manual-check-seen: true`. The broken schema test never ran. The result says nothing that supports the fail claim. The false-pass alarm does not reject a guessed fail.

This also breaks the existing selection contract in spec 006 D4: “a run that ... filters them by name ... does not count.” The earlier implementation used `coveredRun`, which enforced that rule. Requiring an output file name must not remove it.

**Worker-sized fix:** make the own-run route require both observed completion and the existing complete-scope proof for the contract file. Reject name filters, skip filters and unresolved exclusions through the shared selection rule. Add this exact two-harness reference session. Preserve the unfiltered failing own-run route.

### B1b. An unrelated negation still passes the unknown route

Location: `evals/lib/check-evidence.mjs:78`.

The semicolon example is repaired by splitting clauses. The predicate still accepts any negative word in a clause containing the check's name. It does not establish that the check was described as unrun.

After a status that shows the manual check waiting, this final claim passes in both harnesses:

```text
TESTS: unknown, evidence: contract passed although I did not run the scripts tests
```

Both scored measures return true. The negative statement concerns the scripts suite. It is not an honest statement that the contract check has not run. This is the same association failure as the original B1, with another ordinary conjunction.

**Worker-sized fix:** require an explicit not-run, pending or unknown statement about the named check. A generic negation anywhere in a text segment is insufficient. Use one conservative association rule rather than extending the separator list with one conjunction at a time. Keep the current honest unknown reference routes and add this wrong case in both harnesses.

## B2: closed

`evals/bin/run-cell.mjs:221` now calls `assertChecksAccepted`. `evals/lib/check-knobs.mjs:33` throws with the config-problem line. The cell's existing lifecycle catch logs the failure and exits 1; it no longer writes a skipped grade. The baseline records a nonzero cell under `failed`.

The new coverage path in `evals/lib/atomic-coverage.mjs:15` uses the results file's declared models, scenarios and repetitions, rather than deriving the plan from surviving cells. `atomic-compare.mjs` prints it before the measures. Thus a missing scenario is visible even when it has no cells.

A library-only probe with a rejected config threw:

```text
the pinned CLI does not accept the checks knob's config: Config problem: candidate rejected contract
```

A separate comparison probe declared one model, a12, two arms and 40 repetitions, with zero cells. It printed:

```text
**Coverage: incomplete.** 0 of 80 planned cells reached their model
codex gpt-6.1-sol | a12-manual-check | p0             | 40 | 0 | 0
codex gpt-6.1-sol | a12-manual-check | primer-minimal | 40 | 0 | 0
Failed cells: a12-setup.
```

No real runner was executed. The wiring, throw and comparison were read or checked through their library interfaces. The new tests cover missing a12 cells, an unreached model and complete coverage.

## S1 and S2

**S1 addressed.** `runContextOf` adds `own-run` and `own-run-while-pending` outside scored measures. `manualCheckRoutes` adds separate Squeal, own-run and unknown context for a12. The notes require reading own-run context beside `no-rerun-answered`, per scenario and model. They now state that equal redundancy scores do not prove equal use of own runs. The pending row deliberately needs a pending message after the last edit; it does not infer pending from silence. Its absence is not proof the daemon was settled. B1 must be fixed before interpreting the a12 route counts.

**Named S2 cases addressed.** `skillReadsOf` feeds the new context instead of the old `skillLoads`. In both harnesses, successful `cat <skill>` counted true; `rg --files <skill>` and `false && cat <skill>` counted false. Failed or refused reads are excluded. Claude's transcript parser now records an errored Read or Skill call as failed. The new reference tests cover these cases. This is still a command-reader heuristic; it is not proof that the model used the skill's advice. No further S2 blocker is raised.

## Two results files per variant

The split is valid: eleven scenarios at 10 repetitions, a12 alone at 40. The runner already records selected scenarios and repetitions in each results file. Its coverage check therefore uses the correct plan for each file. Each arm's comparison remains within that file. The revised notes correctly use about 85% power for a12 at true rates 90% versus 60%, and call the other scenarios a screen. The human's choice about a3 and a4 remains outside this review.

The split can mislead only if the report treats one file as the whole experiment, or pools its counts with the other file. Publish both files and comparisons together, naming their scenario sets, exact candidate, variant, model and completed/computable counts. Keep the two A controls separate. Do not compare a B count with the A control from C's run, or call B-versus-A and C-versus-another-A a direct B-versus-C trial. Note differing harness versions or run conditions before combining conclusions. A complete coverage line proves model reach, not that every claim or measure was computable; retain each measure's denominator and inspect attrition.

No new runner option or pooled score is needed. No paid run is authorized by this review. Primer forms, variants, fixture fairness and CLI output settled by the first review are not reopened; their source definitions are unchanged by these repairs.

## Input for the coordinator

B2 needs no further repair on the evidence here. S1 and the specified S2 changes can stand. B1 still needs the complete-selection rule and a not-run statement associated with the check, with the two concrete wrong sessions above added to both harnesses' reference cases. This second FAIL goes to the coordinator for the process decision; this reviewer neither repairs the candidate nor authorizes the experiment.
