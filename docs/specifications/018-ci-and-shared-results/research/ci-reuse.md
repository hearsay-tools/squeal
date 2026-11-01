# ci-reuse: reuse of earlier results across PR runs and re-runs

Researcher findings for spec 018, topic `ci-reuse` (row 018-04). Examined 2026-11-01. Squeal source at ec3f1ecb2 (version 0.1.389). Cezarion at `4bef1d26a` (`hearsay-tools/cezarion` main, 2026-11-01). GitHub was read only. No test ran in cezarion or here, no daemon was started, nothing was timed on this host (load average 11.5 on 24 CPUs at the start). Stores were copied to `$TMPDIR` and opened read-only. Probes and outputs: `probes/ci-reuse/`. This file extends `ci-run.md` 3 and 4 and does not repeat them. Tags: **[exp]** verified by experiment (a probe run on real data), **[docs]** read in official docs, **[src]** read in source code, **[inf]** inferred.

## Questions answered

| # | Question | Answer |
|---|---|---|
| 1 | Cezarion's CI today | Green four-shard PR run: wall p50 16.5 min, p90 19.6 min. That includes about 5 min before the test phase: preflight checks and the automated review, which gates the test jobs. Test phase p50 11.4 min, p90 12.1 min. About 90 job-minutes per run, 87% of them in the 4 Vitest and 4 browser-test jobs. The test step is 95% of each test job. Queueing p50 3 s. 11 of 400 runs re-ran test jobs on the same SHA **[exp]** |
| 2 | What reuse would save there | Over 50 merged PRs, 65.8% of unit-test seconds kept their key, but only 14.0% of browser-test seconds. The browser shards set the wall time, so a typical PR run saves about 60 s of 676 s (mean 94 s). It saves about 30 of 86 test job-minutes. A re-run of one failed shard would save about 9.5 min, if the first attempt's store reached it **[exp]** for keys, **[inf]** for time |
| 3 | This repository, two causes fixed | On the 8 product landings, kept seconds go from 10.5% to 15.8% with the version fixed, 13.8% with the setup import fixed, and 20.0% with both. That is about 85 s, then about 160 s, saved per candidate run of 14.5 min **[exp]**, **[inf]** for time |
| 4 | Existing tools | Datadog Test Impact Analysis and Nx Cloud (per-file Vitest tasks with Ultracache) already do what the human describes, as paid services. Vitest's own `--changed <ref>` selects by diff for free, but keeps no results. GitHub's "Re-run failed jobs" already narrows a re-run to the failed shard **[docs]** |
| 5 | GitHub cache rules | Cezarion's PR runs use `pull_request_target`, which may restore main's caches but not write any cache by default. So a re-run cannot restore a store that attempt 1 saved to the cache. A `pull_request` run writes only to its merge ref, which only its own re-runs read. Entries unused for 7 days are evicted; the default limit is 10 GB per repository **[docs]** |
| 6 | Rules for safe reuse | Always re-run a file whose last result failed (Bazel, Datadog, CircleCI). Squeal does not do this today. Keep a full run on every main push. Under the release rule, a run with skips never counts as the full-suite run for a release commit **[docs]**, **[src]**, **[inf]** |
| 7 | Recommendation | Not worth a spec for wall time. Per-file reuse cuts about 9% of a cezarion PR run's test phase, and about 10% of this repository's candidate runs (18% with the two causes fixed). Its real gain is job-minutes (about 35% in cezarion) and re-runs, which are rare. Tools that exist already do it better for a team that wants it **[inf]** |

## Findings

### 1. Cezarion's CI today [exp]

`.github/workflows/ci.yml` runs on `pull_request_target`, `merge_group`, `push` to main and `workflow_dispatch` **[src]**. On PRs to main, every test job waits for the `Automated Code Review` job. The test jobs are `Vitest shard N/4` (`npm test -- --shard=N/4 --maxWorkers=4`, with `--coverage.enabled` on PRs only), `Cockpit browser E2E shard N/4` (Ubicloud, 2 vCPU), and `Unit, build, and package` (node tests, build, packaged CLI tests). A main push skips its tests when `queue-proof` finds a passing merge-group run for the same SHA. No `merge_group` run was in the window, so no push reused one. The shard count went from 3 to 4 on 2026-10-30 (`perf(ci): balance Vitest across four shards`, #2267). The numbers below use only four-shard runs. `ci-benchmark.yml` and `docs/benchmarks/` hold earlier work on shard count, balance and runner type. None of it covers result reuse.

Window: 400 runs, 2026-10-28 22:25 to 2026-11-01 09:35 UTC: 247 PR runs, 140 main pushes, 12 dispatches; 246 green, 62 failed, 91 cancelled (`results/ci-times.json`). Times exclude queueing.

| Green first-attempt runs, 4 shards | n | Wall p50 / p90 | Test phase p50 / p90 | Longest Vitest job | Longest browser job | Build job | Job-minutes p50 |
|---|---|---|---|---|---|---|---|
| PR (`pull_request_target`) | 57 | 992 / 1176 s | 684 / 727 s | 676 s (test step 646) | 616 s (test step 579) | 343 s | 90 |
| Main push | 30 | 821 / 901 s | 656 / 692 s | 649 s (621) | 601 s (567) | 343 s | 84 |

Per-file times (main run 41291671624, `results/times-run41291671624.json`): 984 unit files with 7,267 s summed. Most of it is `server` (650 files, 6,901 s); `web` has 306 files and 346 s. 86 browser files have 2,083 s summed. The longest unit file is 284 s (`monitoring-turn.test.ts`) and the longest browser file 227 s (`touch-targets.e2e.ts`). These two set a floor under any shard.

Re-runs (`results/cezarion-reruns.txt`): 27 of 400 runs had a second attempt. 11 of them re-ran test jobs that had already run on that SHA. In 9 of those, one failed job was re-run: 4 Vitest, 4 browser, 1 build. Each failure was one file, and each re-run that finished passed, so all were flakes. In the other 2, every test job ran again on a green SHA. In the other 16 second attempts, a review re-run released test jobs for the first time. No run tested four Vitest shards on a SHA that an earlier run had already tested.

### 2. What reuse would save in cezarion

Method: `probes/ci-reuse/same-key-cez.mjs`. Each merged PR is squashed into one main commit C with parent P. A PR run with main's results restored is modelled as keys at P against keys at C. A key is taken as unchanged when no path in the file's stored closure changed. Directory listings are compared by entry names, and the project's config and setup files must not change either. Closures come from a copy of cezarion's store (1,145 unit and browser files; the closures already hold observed reads). Node version, `CI`, coverage options and the Squeal release are taken as equal on both sides. Below, that is shown to be false today for coverage. No lockfile change happened in the 50 PRs. **[exp]** for keys, **[inf]** for the model.

| Replay | Unit seconds kept | Browser seconds kept | Wall saved per run, mean / p50 | Test job-minutes saved, mean |
|---|---|---|---|---|
| 50 merged PRs, main's results (`results/prs.jsonl`) | 65.8% | 14.0% (all browser files kept in 7 PRs) | 94 / 60 s of 676 s | 30 of 86 |
| Same, plus 30 s Squeal cost per job (not measured) | – | – | 68 / 30 s | 26 |
| 55 later pushes of one PR, its previous push's results (`results/intra-pr.jsonl`) | 45.0% | 16.4% | 104 / 60 s | 24 |

The unit share is bimodal: 24 PRs kept at least 90% of unit seconds, and 15 kept at most 10%. The wall-time model (`wall-model.mjs`): the test phase lasts as long as its longest job, shards rebalance over the files left, and a job never goes below setup plus its longest remaining file. Most PRs re-key every browser file, so the browser jobs (616 s) become the longest and cap the saving at 60 s. Six PRs that changed only CI scripts kept every key. Today they still ran the full matrix, and for them the saving is 333 s, because the build job (343 s) then sets the wall time.

What re-keys the most (`rekeyedBy` in `results/prs.jsonl`):
- Shared code, not by accident. `packages/contract/src/*` files are in up to 794 of 1,145 closures. `packages/cezar/src/runs/record-write-rules.ts` re-keyed 2,647 file-runs over 6 PRs, and `runs/store.ts` 2,208 over 5.
- Browser closures hold about 2,260 paths each. The reason is the `inputs` globs in cezarion's `squeal.config.json`: `packages/cezar/src/**`, `packages/web/src/**` and others. These globs also match unit-test files, so a PR that only edits unit tests (a "kill surviving mutants" PR) re-keys every browser file. With unit-test files left out of the browser files' inputs, all browser files are kept in 11 PRs instead of 7, and the mean wall saving is 132 s (`results/prs-e2e-ignore-tests.jsonl`). That change is in cezarion's config, not in Squeal.
- Setup files changed in 3 PRs: `packages/cezar/vitest.setup.ts` (#2371), the browser setup's `agent-browser.ts` (#2391), and #2335.

Two blockers **[src]**: (a) Squeal keys the resolved config, `coverage` included, unless Squeal's own coverage provider is used (`canonicalConfig`, `src/runners/vitest/environment.ts`). PR shards pass `--coverage.enabled` and main does not, so no main key equals a PR key today. (b) PR coverage is uploaded as `vitest-coverage-<sha>` and read by the pre-PR quality check. A skipped file adds no coverage to that report **[inf]**.

Re-runs **[inf]**: a re-run of one failed shard took 531–815 s. With attempt 1's results, it would run only setup (30–37 s) plus the failed file (4–104 s). The saving over the 6 re-runs that finished is 452–733 s, median about 570 s. The 2 runs that re-ran every test job on a green SHA would have skipped everything, about 11 min each. Over 3.5 days, that is about 80 min of wall time in total.

### 3. This repository with the two causes fixed [exp]

`probes/ci-reuse/same-key-fixed.mjs` is 018-01's script with two flags. It uses the same 20 landings and a fresh copy of the store, and per-file times of the same run (41226020041). It reproduces 018-01's figures exactly: 57.0% overall, 10.5% on product landings.

| Variant | Product landings (8), kept share of test-file seconds | All 20 landings | Landings whose environment changed |
|---|---|---|---|
| Today | 10.5% | 57.0% | 4 |
| `package.json` version ignored (row 011-35) | 15.8% | 59.1% | 4 |
| Setup closure without `src/core/types/` | 13.8% | 58.3% | 0 |
| Both | 20.0% | 60.8% | 0 |

Correction to `ci-run.md` 4, checked by experiment: the setup closure reaches `src/core/types/` through `import { worktreeMetaKey } from "../types/index.js"` in `src/core/delivery/harness-process.ts`, which `test/global-teardown.ts` imports. It does not go through `src/core/daemon/paths.ts`, whose import is type-only. esbuild 0.28.2 keeps the value import, and the test setup reaches all 11 type files (`setup-closure.mjs`, `results/setup-closure-HEAD.json`). The conclusion of 018-01 stands.

Time **[exp]** for CI, **[inf]** for the saving: candidate runs on `cand/*` take p50 867 s and p90 927 s. The longest Node 22 shard's test step takes 808 s (`results/squeal-ci-times.json`, 64 green runs). A candidate run is a product change against main, like a product landing. At 10.5% kept, it saves about 85 s, and at 20.0% about 160 s. `test/e2e/**` (724 s summed) is excluded from Squeal and always runs. 5 of 101 main pushes had a SHA that a candidate run had already tested in full. A check for an earlier green run of the same SHA skips those without any per-file reuse, which is what cezarion's `queue-proof` does. Re-runs: 5 Node 22 shard re-runs in 200 runs over 6 days, about 800 s each. With reuse, each would keep setup (about 48 s), its share of `test/e2e` and the failed file, and save about 500 s.

### 4. Existing tools

| Tool, version (retrieved 2026-11-01) | Unit it skips | What decides a skip | What the project must change | Cost, data | Does what the human describes? |
|---|---|---|---|---|---|
| Vitest 5.0.5 `cache` | nothing | Stores failed and duration per file "to run failed and longer test files first" | – | free, local | No |
| Vitest 5.0.5 `--changed <ref>` (+ `experimental.recordDependencies`, new in 5.0.4) | test file | Static module graph, or "every file that a test file loads while it runs". `forceRerunTriggers` (`**/package.json`, configs) runs everything. "Files read with `fs` ... are not recorded" | `vitest run --changed origin/main` in the PR job | free | Partly: diff selection for PR runs. It keeps no results, so a re-run gets the same selection, not just the failed files |
| Vitest `--shard` + blob reporter | nothing | Splits files across machines | – | free | No |
| Nx 24.0.3 `affected` + cache | project task | Declared `inputs` (`default`, `^production`) | Adopt Nx | free, local or self-hosted cache | No: the `server` package's 650 files are one task |
| Nx Cloud + `@nx/vitest` Atomizer (`ciTargetName`) + Ultracache | test file (one task per file) | Ultracache hashes from "the files it reads" after one run on Nx Cloud Workers. Cache entries are immutable, and PRs use a read-only token (CREEP-safe) | Adopt Nx, the `@nx/vitest` plugin and Nx Cloud; tasks run on Workers | paid service (Hobby plan includes Ultracache); hashes, outputs and terminal output go to Nx Cloud | **Yes**, for PR runs and re-runs |
| Turborepo 2.11.10 | package task | Hash of declared inputs, global hash | Adopt Turborepo | free; Vercel remote cache or self-hosted | No: one task per package |
| Bazel 9.3.1 (`ci-run.md` 3) | test target | Declared inputs; re-run if "previously failed" | One target per test file, hermetic tests | free; remote cache to run | Yes, but only after a full Bazel migration |
| Develocity 2026.3 Predictive Test Selection | test class | Learned model; results stored only when all tests were selected | Gradle or Maven only | paid | No (no Vitest or pytest support) |
| Datadog Test Impact Analysis (dd-trace ≥ 6.21.0 / 5.132.0 for Vitest ≥ 1.6; ddtrace for pytest ≥ 7.2) | test, or suite = file for Vitest | "a record of the test passing in a commit where the covered and tracked files are identical". A failed run is never reused | `NODE_OPTIONS=--import dd-trace/register.js -r dd-trace/ci/init`; list "tracked files" | paid service; coverage and results go to Datadog | **Yes**, for PR runs and re-runs, without restructuring |
| CloudBees Smart Tests (formerly Launchable), CLI 22c5f90 | test file (Vitest JUnit) | "large language models" predict the relevant tests | record builds and JUnit reports; ask for a subset | paid service | No: prediction, not proof |
| Buildkite Test Engine (bktec) | none | Splits by "historical timing data"; mutes or skips flaky tests | Buildkite | Free plan for splitting | No |
| CircleCI Smarter Testing | test atom (file, test or module) | Test Impact Analysis: coverage on the default branch, then selects "new test atoms, test atoms that failed on the previous run, and test atoms whose covered files have changed". "Rerun only failed tests" is free | CircleCI only (`circleci testsuite run`) | free re-runs; TIA uses credits | Yes, but only on CircleCI |
| pytest-testmon 2.2.0 | test | Per-test coverage fingerprints in `.testmondata` (SQLite), or `--tmnet` cloud storage | carry `.testmondata` between CI runs | free; testmon.net optional | Yes for pytest, if the CI job carries the file (and with the same cache limits as Q5) |
| GitHub "Re-run failed jobs" | job | The job failed | – | free | Re-runs only: it narrows to the failed shard, not the failed file |

Plainly: for Vitest, Datadog TIA and Nx Cloud already do per-file reuse across PR runs and re-runs. For pytest, testmon and Datadog do. Each needs a paid service, a new build system or a cache the job carries. Vitest's free `--changed origin/main` gets most of the PR-run part by diff and needs no store. Squeal's own advantage would be: no service, no data leaving the repository, and closures that already include observed file reads. Today it lacks sharding, CI reporters and coverage (`ci-run.md` 2), and PR and main keys differ by coverage settings (Q2).

### 5. GitHub cache rules [docs]

From "Dependency caching" (docs.github.com, retrieved 2026-11-01) and `actions/cache` v6.1.0:
- A run can restore caches of "the current branch or the default branch", and a PR run can also restore those of its base branch.
- "When a cache is created by a workflow run triggered on a pull request, the cache is created for the merge ref ... can only be restored by re-runs of the pull request. It cannot be restored by the base branch or other pull requests."
- "Only these workflow triggers can create or overwrite caches in the default branch's scope: push, workflow_dispatch, repository_dispatch, delete, registry_package, page_build, schedule." Other events on the default branch, "such as `pull_request_target`", get read-only access, and the save "fails but the step and the job do not". `cache-mode: write` lifts this, which "reintroduces the risk of cache-poisoning". That risk is the Nx CVE-2025-36852 (CREEP) case.
- "GitHub will remove any cache entries that have not been accessed in over 7 days." The default limit is 10 GB per repository, and the oldest entries are evicted first.
- A re-run "use[s] the same `GITHUB_SHA` ... and `GITHUB_REF`", up to 30 days later.
- `actions/cache` creates a new entry only "provided the job completes successfully", so a failed job saves nothing unless `actions/cache/save` runs with `if: always()`.

For cezarion: a main push may write a store that every PR run can read. A PR run (`pull_request_target`) cannot write one, so a re-run cannot get attempt 1's store from the cache. Artifacts of the same run could carry it. I did not verify that a re-run attempt can download an artifact of an earlier attempt; cezarion's `overwrite: true` on its shard uploads suggests it can **[inf]**. For this repository: candidate pushes are `push` events on `cand/*`. They write to their own branch's scope, which main cannot read. Main writes the default scope, which candidates can read. No PR can write a result that main reads, so the default rules already block the CREEP case.

### 6. Rules reuse needs to be safe enough

- **Re-run every file whose last result failed.** Bazel re-runs a test that "previously failed" (`ci-run.md` 3). Datadog needs a passing record. CircleCI selects atoms "that failed on the previous run". Squeal serves a restored failure as current without a re-run (`ci-run.md` 3, verified there). In cezarion all 9 failures were single-file flakes, so this rule alone decides whether a re-run helps **[docs]**, **[inf]**.
- **A full run on every main push.** Cezarion already runs one, unless `queue-proof` reuses a merge-group run of the same SHA. This bounds how long a false skip can live: one landing **[src]**.
- **Release rule.** "Passing full-suite CI for the exact release commit" (`docs/process.md` 6a). A run with skips is not full-suite. So reuse may shorten candidate and PR runs only, and the main push or release run must stay full. In this repository the release commit is usually the candidate's SHA after a fast-forward, so its main push run must keep running everything **[inf]**.
- **Measured precision.** The false-skip rate is still unmeasured (`ci-run.md` open question). A shadow job on cezarion PR runs (below) would measure it.

## Recommendation for Squeal

1. Do not write a spec for CI reuse as a wall-time feature. In cezarion, the browser shards re-key in 43 of 50 PRs, because they test the whole app. So per-file reuse saves about 60 s of an 11-minute test phase (9%) on a typical PR run. In this repository it saves about 85 s of 14.5 min (10%) on a candidate run, and about 160 s (18%) with the version and setup causes fixed. The large number is job-minutes: about 30 of 86 per cezarion PR run (35%). That is cost, not wait.
2. Re-runs gain the most per event (about 9.5 min in cezarion, about 8 min here), but they are rare: 11 runs in 3.5 days in cezarion, and 5 test-shard re-runs in 6 days here. GitHub's rules block the cheap route in cezarion, because `pull_request_target` cannot write a cache.
3. If the human wants reuse anyway, existing tools come first. Datadog TIA is closest to the request as shipped: per Vitest file, plain Vitest, pytest too, and failures never reused. Nx Cloud's Atomizer with Ultracache does the same inside Nx. Both are paid and send data out. Vitest's own `--changed origin/main` is the free diff-based form for PR runs.
4. The two Squeal causes in Q3 are still worth fixing for local work (row 011-35 and the setup import). They are not a reason for CI reuse.
5. A proposed measurement row, not run: a shadow job on cezarion PR runs that restores main's store read-only, computes which files it would skip and Squeal's time to do so, and compares with the full run. Estimated cost: one extra job of 5–10 job-minutes per PR run, so 250–500 job-minutes for 50 runs. It measures the false-skip rate and Squeal's overhead in CI, which this file only assumes.

## Open questions for the human

1. Is the goal shorter waits (wall time) or lower CI cost (job-minutes)? The data supports the second much more than the first.
2. For cezarion, would a paid service that receives test data (Datadog TIA, Nx Cloud) be acceptable? If yes, it already does this.
3. Should a CI skip ever hide a flake in an unchanged file? All 9 test failures in cezarion's window were flakes in files the PR might not have touched.
4. Should the shadow-measurement row (Recommendation 5) be authorized for cezarion?

Not determined, because it needs a CI run: Squeal's own time in a CI job on a large suite, the size of a CI-only store for cezarion, and whether a re-run attempt can download an artifact uploaded by attempt 1.

## Sources

- GitHub (read only, 2026-11-01): `gh api repos/hearsay-tools/cezarion/actions/workflows/346945062/runs` (400 runs) and `.../runs/<id>/jobs?filter=all`; `gh run view --job --log` of run 41291671624 (8 shard jobs) and of 9 failed test jobs (`results/cezarion-failed-jobs.txt`); `gh pr list --state merged --limit 60`. This repository: `repos/hearsay-tools/squeal/actions/workflows/374500850/runs` (200 runs), the jobs of each, and the logs of run 41226020041.
- Cezarion at 4bef1d26a: `.github/workflows/ci.yml`, `ci-benchmark.yml`, `vitest.config.ts`, `packages/*/vitest.config.ts`, `packages/web/e2e/vitest.config.ts`, `squeal.config.json`, `scripts/test-changed.mjs`, `docs/sdlc/ci.md`. Store copy of `/home/agent/projects/cezar/.git/squeal/store.sqlite`, 2026-11-01 10:38 local.
- Squeal at ec3f1ecb2: `src/core/keys/closure.ts`, `src/core/keys/observed.ts`, `src/runners/vitest/environment.ts`, `src/runners/vitest/project.ts`, `src/runners/vitest/graph.ts`, `src/core/delivery/harness-process.ts`, `test/global-teardown.ts`, `tsconfig.json`, `docs/process.md`. Store copy of `/home/agent/projects/squeal/.git/squeal/store.sqlite`, 2026-11-01 10:51 local.
- Vitest v5.0.5 docs: `docs/config/cache.md`, `docs/config/changed.md`, `docs/config/experimental.md` (recordDependencies), `docs/config/forcereruntriggers.md`, `docs/guide/improving-performance.md`, https://github.com/vitest-dev/vitest/tree/v5.0.5/docs
- Nx 24.0.3 docs: `astro-docs/src/content/docs/features/CI Features/remote-cache.mdoc` (Ultracache, security), `kb/split-e2e-tasks.mdoc`, `technologies/test-tools/vitest/introduction.mdoc`, https://github.com/nrwl/nx/tree/24.0.3
- Turborepo v2.11.10: `apps/docs/content/docs/crafting-your-repository/caching.mdx`, https://github.com/vercel/turborepo/tree/v2.11.10
- Datadog: https://docs.datadoghq.com/tests/test_impact_analysis/how_it_works/, `/setup/javascript/`, `/setup/python/`, the overview page (tracked files).
- CloudBees Smart Tests: https://docs.cloudbees.com/docs/cloudbees-smart-tests/latest/ and https://github.com/cloudbees-oss/smart-tests-cli at 22c5f90 (`smart_tests/test_runners/vitest.py`).
- Buildkite: https://buildkite.com/docs/test-engine/test-splitting. CircleCI: https://circleci.com/docs/guides/test/smarter-testing-overview/, `/rerun-failed-tests/`, `/getting-started-with-smarter-testing/`.
- Develocity 2026.3: https://docs.develocity.ai/2026.3/guides/predictive-test-selection/
- pytest-testmon v2.2.0: https://github.com/tarpas/pytest-testmon/tree/v2.2.0 (`README.md`, `testmon/pytest_testmon.py`).
- GitHub docs: https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching, https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs, https://docs.github.com/en/actions/tutorials/store-and-share-data; `actions/cache` README (v6.1.0), `actions/download-artifact` README (v8.0.2).
- Earlier findings: `ci-run.md`, `result-import.md`, `remote-store.md` in this folder.
