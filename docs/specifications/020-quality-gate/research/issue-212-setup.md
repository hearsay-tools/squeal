# Row 020-56: a bounded gate for a change to a shared Vitest setup file (#212)

Recommendation: keep the rule that every selected file must finish (D3.4, D5), and fix what misled the reporter. Remove the false "no-loader" line for setup files. Let the estimate react to host load. Name the setup-file selection before the run. A rule that lets a sample stand for the whole suite read `pass` while 28 of 300 files failed in the probe (`late-breaks`). It should be offered to the human only as a separate outcome that says the tests did not all run, never as `pass`.

Examined 2026-11-14: Squeal main `4fe1a2d29` (0.1.477 in `package.json`), the released 0.1.475 bundle for probes, the 0.1.467 bundle (the reporter's version) read only, Vitest 5.0.3 in this repository, Node 26.13.0, 24 vCPUs. Cezar `cc34d00d6` and its Squeal store, both read only. The one-minute load was 70 to 88 from 08:50Z. All live runs ran 10:16Z–10:23Z at a one-minute load of 9.5 to 23.2 at their start, below the 24 CPUs. Each run's load is in the table under Q1.

| # | Question | Answer | Tag |
| --- | --- | --- | --- |
| 1a | Gate time on a #212-shaped fixture | 300 files, 8 vCPUs (Vitest width 7): 29.9 s cold, 10.6 s warm, 53.7 s with 1 s files. On cezar's 1,248 files, D17.1 estimates about 500 s at width 23. | verified by experiment; read in source code (store model) |
| 1b | What the early lines say | The estimate, the rerun command and the early stop all print correctly when the estimate is over the budget. Every run with a setup edit also prints a false line: the setup file's functions "will read incomplete (no-loader)". | verified by experiment |
| 1c | Why the reporter did not act | The estimate fit the budget (about 500 s against 1,800 s), so no rerun command and no early stop printed. The estimate ignores host load (140 to 175 on 24 CPUs). 0.1.467 also printed the false no-loader line, and it had no rerun of failures under load. | inferred from source, the store model and the issue |
| 2 | Bounded rules for a complete verdict | Today, setup functions are already measured from any completed file. Only D3.4 (every selected file must finish) and D5.5 (no selected failure) keep the verdict `incomplete`. Four rules, A to D below. Only A changes no rule. | verified by experiment; read in source code |
| 3 | Other tools | Vitest, Turborepo, Nx and Bazel run everything that depends on a shared setup or global input. Jest's related-test walk has no setup-file rule. pytest-testmon selects by recorded execution. None treats a sample as a pass. | read in official docs; read in source code |

## Q1. Time, early lines, and why the reporter did not act

**Fixture runs. verified by experiment** (`probes/issue-212/`, `summary.out.json`). One Vitest project, `setupFiles: ["./vitest.setup.ts"]`. The setup file has two functions: `resetEnv`, which a `beforeEach` runs in every file, and `makeClock`, which every 10th file calls. Six "preview" sources are each loaded by 3 of 18 files. There are 300 test files. Each edit changes both setup functions and all six previews.

| Run | Load 1 min before → after | Budget | Exit | Wall | Files run / not run (early stop) / failed | Functions |
| --- | --- | --- | --- | --- | --- | --- |
| cold, quick files, no store | 22.55 → 31.86 | 900 | 0 | 29.9 s | 300 / 0 / 0 | 8 pass |
| warm (store holds durations; setup edited again) | 23.24 → 21.35 | 900 | 0 | 10.6 s | 300 / 0 / 0 | 8 pass; estimate "about 8 s", Vitest ran 8.5 s |
| breaks: `makeClock` returns 1 more | 21.35 → 19.54 | 900 | 3 | 11.3 s | 300 / 0 / 30 | 8 incomplete `test-failed` |
| 1 s files, full | 19.54 → 12.71 | 900 | 0 | 53.7 s | 300 / 0 / 0 | 8 pass |
| 1 s files, warm, tight | 12.71 → 12.89 | 15 | 3 | 5.4 s | 18 / 282 / 0 | **8 pass**; verdict `incomplete` |
| as above, breaks | 12.89 → 12.74 | 15 | 3 | 6.9 s | 18 / 282 / 2 | 8 `test-failed` (t0, t10 call `makeClock`) |
| as above, top-level setup edit only | 12.74 → 12.36 | 15 | 3 | 5.3 s | 18 / 282 / 0 | 6 pass |
| as above, fits (estimate "about 45 s") | 12.36 → 10.89 | 900 | 0 | 53.8 s | 300 / 0 / 0 | 8 pass; Vitest ran 51.5 s |
| late: callers only in t20, t30, … ; full | 11.31 → 9.68 | 900 | 0 | 53.5 s | 300 / 0 / 0 | 8 pass |
| late, breaks, tight | 9.68 → 9.47 | 15 | 3 | 5.4 s | 18 / 282 / **0** | **8 pass**; verdict `incomplete` |
| late, breaks, fits | 9.47 → 9.92 | 900 | 3 | 56.5 s | 300 (18 from the store) / 0 / **28** | 8 `test-failed` |

What the runs show:

1. **Setup functions are measured from any completed file. verified by experiment; read in source code.** A Vitest test file's closure never holds a setup file (`src/runners/vitest/project.ts:36`). The record of each completed file does hold it. `standing()` (`src/core/code/gate/evaluate.ts:58-73`) therefore counts only completed files as a setup function's loaders: in the tight runs, `vitest.setup.ts` passed with 18 of 18 loaders while 282 files were not run. The reporter's first proposal is already true for each function.
2. **The early stop already runs the set #212 asks for.** At least twice over the budget, it ran the 18 files that load a changed function, in 5.4 s against 53.7 s. The setup functions were measured from those 18. Every function passed. The verdict stays `incomplete` only because the 282 files did not start (D3.4).
3. **A false line on every setup edit. verified by experiment.** Every run that changed a setup function printed `no test Squeal runs loads vitest.setup.ts: ... Its 2 changed functions will read incomplete (no-loader)`, and then both functions passed. The cause is `unloadedPaths` (`src/core/code/gate/prerun.ts:207-222`), which looks only at closures. The line is in the 0.1.467 bundle too.
4. **The estimate is good on a quiet host:** 8 s against 8.5 s, and 45 s against 51.5 s. The load rerun (D3.4, row 020-54) fired in every failing run. It found the real failures again ("30 failed again"). Note: under `taskset` it compares the load with the 8 visible CPUs, not the host's 24.

**Cezar. read in source code** (store model, `cezar-estimate.out.json`, read-only): all 1,248 `server` test files have a stored duration (the newest rows were recorded on 2026-11-13 and 2026-11-14, so the store at the incident differed). They sum to 11,487 s; the longest is 94 s. D17.1 at Vitest's width of 23 gives **about 500 s** (1,045 s at width 11, 2,298 s at width 5).

**Why the reporter did not act. inferred** from the above, the issue and `rule.ts`:

- The estimate, about 500 s, fit the 1,800 s budget. So no "over the budget" line, no rerun command and no early stop printed (D17.1 fires only when the estimate is over what is left). At load 140 to 175, 976 files finished in 1,800 s, so the whole run would have taken at least 4.6 times the estimate. D17.1 assumes the stored durations hold now. The rerun factor of 2 (`research/gate-budget.md` Q2) was measured on this host's own history and does not cover such a jump.
- The one setup line said the setup functions would read `no-loader`. That is false and gives a wrong reason.
- All 33 functions read `test-failed`. `completenessOf` checks a missing loader before a failure (`rule.ts:114-117`), so no function had an unfinished loader. Loader order (D17.2) and point 1 had done their work. Only the 6 failures and the 529 files that did not finish blocked the verdict. 0.1.467 had no rerun under load; 0.1.475 reruns such files once.
- With `--json`, every line above goes to stderr (D14.4); the issue quotes only the JSON.

## Q2. Bounded rules for a complete verdict

The policy version is `QUALITY_POLICY_VERSION = 4` (`src/core/code/gate/types.ts:26`; D6 still says 1).

**A. No rule change: diagnostics only.** (1) For a path in a runner's setup closure, `unloadedPaths` does not report it. Instead a line names the selection, for example "vitest.setup.ts is a setupFiles entry of project server: all 1,248 of its test files are selected". (2) When the one-minute load is at or over the CPU count, the estimate is scaled, for example by load ÷ CPUs. The rerun command and the early stop then fire on #212. (3) The early stop already gives a bounded run with every function measured. *Pass means:* as today. *Misses:* nothing new. *Changes:* D14.4 (the unloaded line), D17.1 (estimate). No D5 or D6 text; no policy raise. *Cost on #212:* nil, and the agent learns within seconds. The run is still `incomplete`.

**B. A separate outcome: "measured, tests not all run".** When the early stop or the budget left only files that load no changed function (closure or record), the verdict is a new value, not `pass`. Every function passes on complete metric evidence, and N selected files were not run. The 015 D9 bound is sound for the metrics: in `late-breaks`, `makeClock`'s CRAP from 18 files was 6, against 2 from 300. *Pass-like result means:* CC and CRAP proven within limits, and no test that loads a changed non-setup function failed. *Misses:* failures in files that were not run, which a setup change can cause (`late-breaks`: 28 failures, not seen). *Changes:* D1 (verdicts and exit codes), D3.4's sentence on files the early stop did not start, D5's verdict paragraph, D7, and a raise to 5. *Cost on #212:* the loaders of the six non-setup files. In cezar's store the `src/preview/*` sources have 52 to 630 loaders each, 724 for all 22 together: up to about 400 s at width 23 on a quiet host (`cezar-loaders.out.json`; #212 does not name its six files).

**C. The sample counts as `pass` (the issue's proposal).** The files the early stop does not start, or a sample of k setup loaders, no longer hold the verdict. *Pass means:* what B means, under the old name. *Misses:* verified. `late-breaks` would read `pass` while the same bytes fail 28 files. A sample of k files finds a failure that breaks a share q of files with chance 1 − (1 − q)^k (inferred): about 27% for k = 3 and q = 0.1. *Changes:* D3.4, D5 condition 5 and its verdict, D17.1; raise to 5. *Cost:* as B. Not recommended: it breaks D5's "a selected failure blocks every function" with no visible sign.

**D. Select by recorded execution (testmon's model).** A changed setup function's loaders become the files whose record at the base ran it. *Misses:* tests that reach it only after the change; top-level setup code, which every file runs. *Changes:* D3.1 and D5.2; raise to 5. *Cost on #212:* about the whole suite. Cezar's `vitest.setup.ts` is top-level code and `beforeEach`/`afterEach`/`afterAll` hooks, which every file runs (read in cezar `packages/cezar/vitest.setup.ts`). In the fixture it would save only for `makeClock` (30 files).

**Existing route, no Squeal change:** `--parts` from CI (D13). Cezar's CI writes parts only in a merge group or a `squeal_gate_trial` dispatch, not on a pull request (cezar `.github/workflows/ci.yml`, `docs/sdlc/ci.md`).

## Q3. What other tools do

- **Vitest 5.0.3. read in source code:** `resolved.forceRerunTriggers = [...resolved.forceRerunTriggers, ...resolved.setupFiles]`, and with `--changed`/`--related`, `if (matcher && related.some((file) => matcher(file))) return specs;`: a changed setup file runs every spec (`dist/chunks/index.DpLw24bj.js:14556`, `18594-18596`). Watch mode reruns every file of the project (`handleSetupFile`, `20347-20360`). Setup files are also put in `coverage.exclude` (`14548`); Squeal's records still hold them (Q1, point 1).
- **Jest (main `aa88f7cf`). read in official docs and source code:** `--changedSince` "Runs tests related to the changes since the provided branch or commit hash"; `--onlyChanged` "requires a static dependency graph". `SearchSource.findRelatedTests` walks the inverse import graph of test files (`packages/jest-core/src/SearchSource.ts:177-230`), and `jest-core/src` never names `setupFiles`. So an edit only to a setup file selects no test unless a test imports it (inferred from source; not run).
- **Turborepo. read in official docs:** `globalDependencies`: "If any file matching these globs changes, all tasks will miss cache." `--affected` filters by package.
- **Nx. read in official docs:** affected tasks are those "whose inputs include a changed file"; `sharedGlobals` are inputs "for all tasks". A task is a project's whole test target, so the runner runs it whole.
- **Bazel. read in official docs:** `--cache_test_results=auto` reruns a test "if and only if: Bazel detects changes in the test or its dependencies", or it previously failed. A shared test library is a dependency: everything that depends on it reruns.
- **pytest-testmon (`86d43f1`). read in official docs and source code:** it collects "dependencies between tests and all executed code (internally using Coverage.py)", on the premise that a "method body which is not reached/executed by a specific test cannot influence outcome of that test". Coverage runs across `pytest_runtest_protocol` (`testmon/pytest_testmon.py:396-399`), so fixture code a test runs is its dependency. How it treats a conftest's import-time code was not determined (not read).

No tool examined lets a sample of dependents certify a shared-input change. The coverage-based tool, testmon, reruns every test that executed the changed code.

## Recommendation for Squeal

For the human: **A** (diagnostics, no rule change), as one row: no false no-loader line for setup paths; a setup-selection line; a load-aware estimate, so the rerun command and the early stop fire under load. If a bounded, mergeable result is still wanted after A, choose **B**, a separately named outcome that a project's procedure may accept in place of the run that is left to CI. It raises `QUALITY_POLICY_VERSION` to 5. Do not choose **C**. **D** gains nothing on #212.

## Open questions

1. Which six files #212 changed, and the original stderr: the store model brackets the cost (52 to 724 loaders) but does not fix it.
2. The load scaling for A: whether load ÷ CPUs predicts the slowdown. One data point says at least 4.6 times at load 140 to 175 on 24 CPUs. Not measured, by the rule against making load.
3. For B: the verdict name and exit code, and whether the daemon (which has no early stop) needs it.
4. Whether the load rerun should read the host's CPU count when the process is limited to fewer CPUs (seen under `taskset`; not studied).

## Sources

- Issue https://github.com/hearsay-tools/squeal/issues/212 and its comments; https://github.com/hearsay-tools/squeal/issues/175 (`gh issue view`, 2026-11-14). `research/issue-212.md`, `research/gate-budget.md`, `research/wide-import.md`; spec 020 D3, D5, D6, D14, D17, D18, `status.md`; board rows gh-212, 020-17.
- Squeal `4fe1a2d29`: `src/core/code/gate/{evaluate,rule,prerun,order,plan,estimate,evidence,types}.ts`, `src/cli/{code-gate-prerun,code-gate-durations}.ts`, `src/runners/vitest/{adapter,affected,project}.ts`, `src/core/store/repos/results.ts`, `src/core/scheduler/files.ts`. Bundles `~/.claude/plugins/cache/hearsay/squeal/{0.1.467,0.1.475}/dist/cli/squeal.mjs`.
- Vitest 5.0.3 `node_modules/vitest/dist/chunks/index.DpLw24bj.js`, `plugin.d.BsjqSb4-.d.ts`.
- Jest `docs/CLI.md` (https://raw.githubusercontent.com/jestjs/jest/main/docs/CLI.md) and `packages/jest-core/src/SearchSource.ts` at `aa88f7cf0`.
- https://turborepo.com/docs/reference/run, https://turborepo.com/docs/reference/configuration; https://nx.dev/docs/features/ci-features/affected, https://nx.dev/docs/reference/inputs; https://bazel.build/reference/command-line-reference, https://bazel.build/reference/test-encyclopedia; https://testmon.org/, https://testmon.org/blog/determining-affected-tests/, https://github.com/tarpas/pytest-testmon at `86d43f1b5` (all fetched 2026-11-14).
- Cezar `cc34d00d6` (read only): `packages/cezar/vitest.setup.ts`, `vitest.config.ts`, `.github/workflows/ci.yml`, `docs/sdlc/ci.md:680-700`, `.git/squeal/store.sqlite` (`?immutable=1`).
- Probes: `probes/issue-212/` (README), `summary.out.json`, `cezar-estimate.out.json`, `cezar-loaders.out.json`, `out/`.
