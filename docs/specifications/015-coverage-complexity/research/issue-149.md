# Issue 149: standalone coverage fixtures listed as untested

Keep explicit fixture exclusions and fold the child-run evidence into #144.

Researcher, 2026-11-04. **Synthetic symptom reproduced; original incident not replayed.** Documentation-only research, completed within the 20-minute limit. Examined Squeal commit `4204b3d479ec241424d1ba629f904caf95076c15`, committed CLI **0.1.402**, Node **24.22.1**, Vitest **5.0.3**, Linux, 24 CPUs. Initial one-minute load was **1.61**; corrected probe launch loads were **7.20–7.27**, all below 24. Every fixture and daemon launch passed a load gate. No build, install or full suite ran.

## Questions answered

| # | Question | Answer and evidence tag |
|---|---|---|
| 1 | Can a passing separate-config test leave its source untested? | Yes. A node:test parent starts Vitest with a standalone config and proves the child calls the source; Squeal still reports `uncovered: fail`, CRAP 2. **verified by experiment**, Squeal 0.1.402 / Vitest 5.0.3 / Node 24.22.1. |
| 2 | Does direct execution differ? | The identical source called inside the parent test has 100% line coverage, `uncovered: pass`, CRAP 1. **verified by experiment**, same versions. |
| 3 | Does explicit exclusion already work? | Yes. The child test still passes, complexity stays CC 1, and coverage becomes `{ "excluded": true }`. **verified by experiment**, same versions. |
| 4 | What does the linked repository actually run? | At cezarion merge `64d58f93f851ce1be70fa5ba156dd69214cbc1e5`, the named matcher tests read `source.ts` and saved `coverage.json`; the fixture README gives a manual regeneration command. **read in source code / read in official docs**, that commit; saved report names Vitest 4.1.10. |
| 5 | Is this new behavior beyond #144 or helper exclusions? | It adds a separate-config example and source evidence about snapshot fixtures, but proves no new collection defect or missing exclusion mechanism. **inferred**, from the evidence and spec 015 at the examined Squeal commit. |

## Findings

**Q1–Q3: separate configuration does not cross the collection boundary** (**verified by experiment**, Squeal 0.1.402). Four isolated repositories use the same one-line TypeScript expression arrow at the issue's `.ai/skills/check-code-quality/scripts/fixtures/expression-arrows/source.ts` path. Only that source is included for complexity. Each has one Squeal-run node:test parent.

| Case | Parent result, revision 0 | Source result |
|---|---|---|
| Parent starts Vitest with a separate fixture config | Current, no failures | CC 1; CRAP 2; untested; zero covering test files |
| Parent directly imports and calls source | Current, no failures | CC 1; CRAP 1; 1/1 lines covered by one test file |
| Same child run, fixture directory in `coverage.exclude` | Current, no failures | CC 1; `coverage not checked (coverage.exclude)`; no CRAP or uncovered state |
| Parent reads source text without executing it | Current, no failures | CC 1; CRAP 2; untested; zero covering test files |

The child test asserts `single() === 42`, then emits `FIXTURE_EXECUTED`. Its parent asserts the child exit is zero, its output says `1 passed`, and the marker exists. This proves execution without treating an arbitrary passing subprocess as coverage evidence. The snapshot-reader control proves that reading a source file is insufficient to cover its function; it does not implement the original matcher.

The failed source's path report says:

```text
single  CC 1, at or under; CRAP 2; untested: no test runs it in the test's own thread
```

The aggregate report adds: `Squeal does not measure worker threads or child processes.` This repeats #144's path-versus-aggregate wording distinction. JSON reports zero covered lines and covering test files; this is the measured scope, not proof that no external test executed the source.

The first probe used a relative `--config` together with `--root`. Vitest resolved the fixture path twice and the two child cases failed before execution. [Initial output](probes/issue-149/initial-invalid-config.json) is retained but excluded from the verdict. The corrected run uses an absolute config path; all 20 recorded CLI reads exit 0. All four daemons exit 0 after targeted termination.

**Q4: the original artifact is a saved-report fixture** (**read in source code**, cezarion `64d58f93f`). Fetched `metrics.test.mjs:468–480` and `:519–529` read source text and the committed report. They pass those values to `analyzeSource`, `measureCoverage` and `functionResults`. Neither shown test starts the fixture config. The root Vitest config lists package projects, while `squeal.config.json` includes `.ai/skills/*/scripts/*.test.mjs` as node:test files and has no `coverage.exclude` entry.

The fixture README says “Regenerate from the repository root” and gives an explicit config/root/coverage command. It says the saved coverage came from **Vitest 4.1.10**. The report has function counts **2, 1, 0, 1, 1**; the matcher asserts that `unused` has zero calls, zero coverage and CRAP 6. Thus at least one fixture function is intentionally uncalled even during regeneration. These are fetched artifact facts, not fresh execution of that version. They qualify the issue's statement that repository tests execute these sources: the named matcher tests consume prior execution evidence.

**Q5: existing contracts cover both cases** (**read in official docs / read in source code**, Squeal `4204b3d47`). Spec 015 Non-goals and D9 expressly exclude child-only execution. D8 records coverage from Squeal's own test-file runs; a config file or external coverage report alone does not establish a Squeal record. D6/D9 describe the thread limit. D1 defines `coverage.exclude`: a matched source keeps complexity but loses CRAP and untested checks. `src/cli/code-coverage.ts:94–95,221–223` matches exclusions and renders the observed text.

The shipped policy guidance already says: “Test helpers shipped inside a package, which only a manual or built-output run uses, are measured as product code” and “Exclude them explicitly here, with globs that leave product helpers checked.” The 2026-10-31 status amendment records this guidance-only decision for 015-100 / #122. The 2026-10-27 amendment rejects automatic broad helper exclusions. #144 remains **open, triaged** in the fetched issue state.

## Recommendation and limits

**Inferred, Squeal 0.1.402:** retain a narrow project-owned exclusion for fixture inputs that are data for another tool. For this directory, the existing setting can use `.ai/skills/check-code-quality/scripts/fixtures/expression-arrows/**`; the synthetic counterpart works. This is guidance, not a change applied to cezarion. Keep any clearer path-report scope wording with the existing #144 decision. Do not treat a standalone config, saved coverage report or fixture-looking path as automatic coverage or as grounds to hide product functions.

The original command output, revision and runtime were not recorded. No original-repository run or 0.1.390 replay was attempted. The probe uses a node:test parent and Vitest 5.0.3 child; the original artifact names 4.1.10. It does not test a standalone fixture registered as a Squeal-owned Vitest project, restarts, push delivery, timing or coverage-import mechanisms. Those limits prevent an exact incident verdict or a conclusion about every separate-config arrangement. Existing holds stand; this research authorizes no implementation.

## Commands, verification and sources

From the examined worktree:

```sh
gh issue view 149 --repo hearsay-tools/squeal --json title,body,comments,url,state,labels
gh issue view 144 --repo hearsay-tools/squeal --json state,labels,title
gh api repos/hearsay-tools/cezarion/pulls/2574 --jq '{merge_commit_sha,merged_at,title,body}'
node plugins/claude-code/dist/cli/squeal.mjs --version
node docs/specifications/015-coverage-complexity/research/probes/issue-149/run.mjs
node docs/specifications/015-coverage-complexity/research/probes/issue-149/verify.mjs
node --check docs/specifications/015-coverage-complexity/research/probes/issue-149/run.mjs
node --check docs/specifications/015-coverage-complexity/research/probes/issue-149/verify.mjs
```

Probe and syntax commands exit 0. The offline audit checks all CLI exits, load gates, daemon exits and expected coverage states. [Results](probes/issue-149/results.json) preserve exact commands, fixture bytes, logs and version/load evidence; [audit](probes/issue-149/audit.json) preserves the checked summary. Per fixture: `node <committed-cli> daemon <root>`, `status --wait 30000 test/parent.test.mjs`, `code <source>`, `code <source> --json`, and `code`. The child uses `node <installed-vitest>/vitest.mjs run --config <absolute-config> --root <fixture-dir> --maxWorkers 1`.

Sources: [#149](https://github.com/hearsay-tools/squeal/issues/149), [#144](https://github.com/hearsay-tools/squeal/issues/144), [prior #144 findings](issue-144.md), [#122 findings](issue-122.md), [spec D1/D6/D8/D9](../spec.md), [amendments](../status.md), [shipped policy](../../../../plugins/claude-code/skills/squeal/references/policy.md), [cezarion fixture at the merge](https://github.com/hearsay-tools/cezarion/tree/64d58f93f851ce1be70fa5ba156dd69214cbc1e5/.ai/skills/check-code-quality/scripts/fixtures/expression-arrows), and [matcher tests](https://github.com/hearsay-tools/cezarion/blob/64d58f93f851ce1be70fa5ba156dd69214cbc1e5/.ai/skills/check-code-quality/scripts/metrics.test.mjs#L468). Fetched snapshots and their exact fetch recipe are in the [probe README](probes/issue-149/README.md). No open-web search was used.

Research-file verification: the session launcher’s `status --wait 60000` on the report, `run.mjs` and `verify.mjs` exits **3**: no test closure for those paths; worktree known failures **0**, with **4 of 1,451 test files unknown**. This is not a repository-suite pass. Syntax checks, saved-evidence assertions and `git diff --cached --check` pass.
