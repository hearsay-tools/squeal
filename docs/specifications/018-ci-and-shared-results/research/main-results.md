# main-results: could results CI already produces on main cut test work on developers' machines?

Researcher a42d1179 for spec 018, 2026-11-07 23:00Z to 2026-11-08 01:00Z, reopened by the human on 2026-11-08 (task 7d611fc4) with the goal of less load on dev machines, not shorter CI. Data: copies of the squeal and cezar stores with `-wal`/`-shm` and run reports (2026-11-07 23:12Z); both repositories read with `git log/ls-tree/diff/merge-base/reflog`; GitHub read only (main-push runs since 2026-10-28, cezar merge-group runs since 2026-11-01, squeal `cand/**` runs, job and step times, three job logs); sar from 2026-10-30 22:50Z. Source: squeal `571824713` (0.1.415, `KEY_FORMAT_VERSION` 21), cezar `fcf2a5227`, Vitest 5.0.3 (squeal) and 4.1.10 (cezar). No test, build or load ran; my worktree has no runs in either store. Probes: `probes/main-results/`. Tags: **[exp]** verified by experiment (a probe on the copied data), **[src]** read in source code, **[docs]** read in official docs, **[inf]** inferred.

**Method in one line.** For each local file run since 2026-10-29, its closure content at the run's commit (blobs of `test_files.closure_paths`, its observed paths, and the config and lock files that feed the environment hash) is compared with the same file's content at every main commit, and the run counts as "CI had it" when an equal-content main commit's main-push CI run had finished before the run started. This is the 011-299 `levers.cjs` rule with CI finish times in place of landing times. It assumes the environment parts of the key match (question 3 shows they do not today). Today's closures stand in for each run's closure. "Clean" runs had no uncommitted change, so their content is exact. "Dirty" runs had uncommitted edits, so a match at their commit is only an upper bound; 011-299 found own edits touched the closure in 90% of such seconds.

## Questions answered

| # | Question | Answer |
|---|---|---|
| 1 | The prize | **cezar: 19.6% to 37.0% of 2,191,690 background file-seconds (9.0 days)**; 44.9% of clean-run seconds. Before the 2026-11-06 17:39Z switch 18.3% to 36.2%; after it 26.1% to 41.3% (0.86 days only). Above 16 busy vCPUs: 18.2% to 32.4% of the seconds there. Edit tiers: 4.9% (clean). **squeal: 7.1% to 14.7% of 459,724 s (9.7 days)**; above the knee 8.3% to 15.9%; edit tiers 8.4% **[exp]** |
| 2 | Freshness | cezar: CI on main finishes 1.4 min (p50) after landing since the merge queue (2026-11-01); 2.4% of the no-lag prize is lost. squeal: 15.8 min (p50) after landing; 42% of the no-lag prize is lost, 38% if `cand/**` runs counted **[exp]** |
| 3 | Key match today | No CI job matches a developer key in either project: Node (cezar test shards 26.13.0, squeal shards 22.19.0, developers 24.22.1), `CI=true` (Vitest fields), and new since 2026-10-28: Squeal's own coverage provider is in every local key, and no CI run uses it. Also needed: the same observed sets and the same Squeal key format **[src][exp]** |
| 4 | Producing the bundle | squeal runs the full suite on every non-docs main push; cezar runs it in the merge group (main pushes reuse that run by `queue-proof`). Reusing that run (reporter plus recorder in the test step, keys and publication in a job after it) adds no test seconds. A separate incremental Squeal run on each main commit would cost 82 CI hours a day for cezar and 7.6 for squeal, more than it saves locally **[exp][src][inf]** |
| 5 | Recommendation | Conditional go: a spec is worth writing for cezar-like projects (merge queue, hub-heavy closures), only for the form that reuses the run CI already does, and only if projects accept two changes: one Node version for CI tests and developers, and Squeal's recorder and coverage provider in the CI test step. Saves about 14 to 27 file-hours a day on this host (0.6 to 1.1 vCPU mean; 5 to 9 of them above the knee) **[inf]** |

## 1. The prize [exp]

`extract.cjs`, `prize.cjs`, `summary.cjs`; `results/cezar.summary.txt`, `results/squeal.summary.txt`. Background = restart and first baselines, catch-up and backlog tiers, and `run --all`; edit tiers are apart. 99.9% of seconds had a known commit (from a surviving `results` row of the run, else its revision row). Ranges are clean only (low) to clean plus every dirty match (high); clean plus 10% of dirty, by 011-299's 90% rate, is near the low end.

| Project, period | Background s | Clean, CI had it | + dirty (upper) | Share, low–high | Above 16 busy: share of those s |
|---|---|---|---|---|---|
| cezar, 10-29 to 11-06 17:39Z (7.2 d) | 1,827,348 | 334,667 | 327,084 | 18.3–36.2% | 18.4–32.7% of 682,935 |
| cezar, after the switch (0.86 d) | 364,343 | 95,107 | 55,324 | 26.1–41.3% | 17.3–31.3% of 140,393 |
| cezar, all (9.0 d) | 2,191,690 | 429,774 | 382,408 | 19.6–37.0% | 18.2–32.4% of 823,328 |
| squeal, before (8.4 d) | 333,451 | 28,226 | 27,376 | 8.5–16.7% | 8.9–16.8% of 157,908 |
| squeal, after (1.2 d) | 126,273 | 4,381 | 7,420 | 3.5–9.3% | 2.8–8.0% of 17,802 |
| squeal, all (9.7 d) | 459,724 | 32,607 | 34,796 | 7.1–14.7% | 8.3–15.9% of 175,710 |

- **Who it comes from in cezar.** Before the switch, baselines were 69% of the clean prize (230,850 s). After it, catch-up and backlog tiers are 88% (83,894 of 95,107 s): main-state work now arrives after rebases and pulls, as the brief expected. By project: `server` 334,745 s, browser `e2e` 66,166 s (it ran in baselines until `fc5c2c5e0` made it `at: manual`), `web` 19,427 s, the two node:test projects 9,369 s (2.2%).
- **Edit tiers** are small either way: cezar 2,392 of 49,096 s clean (4.9%), squeal 1,403 of 16,623 s (8.4%). Their dirty matches are not real: an edit tier runs because an edit touched the file's closure.
- **Matched runs started a median 0.67 h (cezar) and 1.1 h (squeal) after CI had finished**, p10 5 min and 4 min. A content rule that keeps every main bundle (`ci`) and one that imports only the nearest finished main commit below the run's base (`near`) matched the same seconds in both projects.
- **Per day on this host:** cezar 13.2 file-hours (clean) to 25.0 (with dirty), 4.6 to 8.2 of them above the knee; squeal 0.9 to 1.9, 0.4 to 0.8 above it. For scale, `load-slowdown.md` counted 92 Squeal worker-hours a day and 36 above the knee across all stores.

## 2. Freshness [exp]

| | CI on main after landing (p50 / p90) | Lost: content had landed, CI not yet finished | Cancelled main-push runs |
|---|---|---|---|
| cezar since 2026-11-01 (merge queue) | 1.4 / 4.8 min for matched seconds; push runs p50 80 s, because `queue-proof` reuses the merge-group run of the same SHA (274 of 287 runs under 5 min) | 10,592 of 440,366 s (2.4%) | 18 of 305 |
| cezar before 2026-11-01 | 13 to 19 min, p50 about 15 (full push runs) | in the total above | 74 of 180 (`cancel-in-progress` on main) |
| squeal | 15.8 / 27.7 min; push runs p50 930 s | 23,733 of 56,340 s (42%); 21,277 (38%) if `cand/**` runs counted as producers | 0 (main never cancelled); docs-only pushes run no CI |

Landing time is the first time the local `origin/main` reflog or a GitHub push run shows main at or past the commit (`prize.cjs`). squeal loses most because its catch-up starts within minutes of a pull or rebase onto a fresh main, while main's CI still runs. A publication job after CI (question 4, option C) adds 1 to 3 min; 6.3% (cezar) and 8.2% (squeal) of matched clean seconds started within 3 min of CI finishing.

## 3. Key match at current versions

| Difference | Today | Cheapest fix, who | Risk of a wrong pass |
|---|---|---|---|
| Node version (full `process.version`, `environment.ts:45`) **[src]** | cezar: Vitest and browser shards `node-version: lts/*` = **26.13.0**; unit/build 24.21.0. squeal: test shards **22.19.0**; the Node 24 job floats (`24` = 24.22.2) and runs only 97 version-sensitive files. Every daemon here: 24.22.1 (job logs 128550113283, 128550113674, 128549784439; `/proc`) **[exp]** | The project pins one version for its CI test jobs and its developers (a version file read by `setup-node`). Keying by major fixes neither project (26 vs 24, 22 vs 24) | None with a pin. Keying by major: a patch release that changes behaviour gives a wrong pass |
| `CI=true` | Vitest 5.0.3 and 4.1.10 still derive `allowOnly`, `snapshotOptions.updateSnapshot`, `browser.headless` and `browser.ui` from `isCI` (`defaults`, `index` chunks; `result-import.md`'s fifth, `browser.screenshotFailures`, not re-checked); `canonicalConfig` keys them on purpose (`src/runners/vitest/environment.ts:79-84`) **[src]** | Squeal treats these fields as equal for imported passes only (Squeal); or the export runs with `CI` unset (project; gives up Vitest's CI guards in a gating run) | Passes: none found; a CI pass implies no `.only` and matching snapshots. Failures must not import as current. Browser-mode projects: not determined |
| Coverage (new) | `coverage.enabled` defaults to true (`src/core/types/policy.ts:389`), and a run with Squeal's provider keys `{provider: "squeal", version}` instead of the project's coverage options (`environment.ts:109-114`). cezar PR shards pass `--coverage.enabled` (the project's provider); merge-group, main and squeal CI runs have no coverage. So no CI key equals a local key in either project **[src]** | The CI test step runs under Squeal's coverage provider (about +8% CPU, wall within noise: spec 015). Or Squeal leaves coverage out of the import comparison and stores imported results without coverage records | None for outcomes (coverage does not change a pass); files read "no coverage" until a local run |
| Observed sets | Per store, "merged and never pruned" (`src/core/keys/observed.ts:11-17`); 1,740 of 2,143 cezar and 997 of 1,732 squeal test files have observed paths **[src][exp]** | The CI run records observed reads (Squeal's recorder) and the bundle carries its sets (`result-import.md` Q1). A local store whose set for a file holds extra paths computes another key: a miss, not a wrong pass. The spec must settle the rule (for example: accept when the local set is a subset of the bundle's) **[inf]** | None for misses; a subset rule is safe only if CI hashed every path the local key hashes |
| Squeal key format | Formats must be equal; `KEY_FORMATS_READ_AS_ONE` is empty at format 21. Daemons of 0.1.414 and 0.1.416 ran side by side on 2026-11-07 (`squeal ps`) **[src][exp]** | CI pins the Squeal release developers run; a format raise voids bundles until the next main CI run | None |
| `.git` by kind, line endings, install | 8 cezar and 18 squeal test files observe `.git` (a clone has a directory, a worktree a file); GitHub's Linux runners leave `core.autocrlf` off; both CIs install the pinned pnpm from a frozen lockfile (cezar 12.11.2, squeal 12.15.0, as `packageManager`) **[src][exp]** | Keep all three (`result-import.md` Q1) | None |

## 4. Producing the bundle without adding CI wall time

**What CI on main runs today [src][exp]** (`results/ci-jobs.txt`). squeal: every main push that is not docs-only runs the whole Vitest config in three shards on Node 22.19 (131 of 131 runs; wall p50 930 s, test step p50 780 s per shard, 2,301 s per run), `test/e2e/**` included, which Squeal excludes locally. cezar: since 2026-11-01 the suites run in the merge group on the exact SHA that becomes main: Vitest (4 projects, 4 shards, test step p50 592 s, 2,291 s per run) and browser E2E (4 shards, p50 588 s, 2,396 s per run), node:test in "Unit, build, and package" (210 s). 47 of 362 merge groups (13%) reused a PR run's suites instead (`pr-test-proof`); that PR run is a `pull_request_target` run, a weaker source than a push to main. Locally, cezar's browser group is `at: manual`, so a bundle would also make those checks current without a run.

| Option | Test seconds added | CI wall added | What it needs | Fits any project? |
|---|---|---|---|---|
| A. Squeal runs the suite in the gating test job | Squeal's tiering and keying overhead: not determined, because no CI run was allowed (`ci-reuse.md` assumed 30 s per job) | yes, in every shard | The CI job runs `squeal`, with the developers' Node, Squeal's coverage provider, `CI` normalized | yes, for runners Squeal supports |
| A'. A separate incremental Squeal run per main commit, keeping the previous commit's results | cezar 37 commits a day × 604 files re-keyed = **82 CI-hours a day**; squeal 11 × 524 = **7.6** (`rekey.cjs`, local median seconds) | none (own job) | as A | yes, but it costs 3 to 6 times (cezar) and 4 to 8 times (squeal) the local seconds it saves, because hub files re-key most of each suite on almost every main commit **[exp][inf]** |
| B. The gating run records what Squeal needs: a machine report (`--reporter=blob`/json), Squeal's recorder for observed reads, Squeal's coverage provider | none; coverage about +8% CPU (spec 015); the recorder's cost not determined | about the coverage cost | A report reader per runner; closures from the graph; the key rule for observed sets (question 3) | yes, through a wrapper command per runner **[inf]** |
| C. A job or `workflow_run` workflow after the tests: download shard reports, compute keys, write `refs/notes/squeal` | none | none in a separate workflow; the bundle arrives 1 to 3 min later (setup outside test steps: p50 24 to 31 s cezar, 55 s squeal) | write access to one ref, from the default branch only | yes |

Key computation itself is small: 841 files inherited by lookup in 930 ms (`001-core-loop/reviews/wave-4.5.md`), a closure walk of 632 files with Vite start in 13.6 s (`001-105/notes.md`), an import of one export in 0.4 s (`result-import.md` Q4) **[exp], older versions**.

## Recommendation for Squeal

1. **Conditional go.** The prize is real where the human expected it: in cezar, CI on main had already run the content of 20% (clean runs) to 37% of local background seconds, and 26 to 41% since the 2026-11-06 switch, when that work became catch-up after rebases. Its merge queue makes main's results available 1.4 min after landing. In squeal the prize is 7 to 15%, and 42% of it is lost to its 16-minute main CI. Write a spec only for B plus C: reuse the run main CI already does, add no test run, publish one bundle per main commit from the default branch. Option A' fails the load goal: an incremental CI run costs more test seconds than it saves.
2. **It gives nothing until environments meet.** Neither project's CI keys match a developer key today, for three independent reasons (Node, coverage provider, `CI`), plus the observed-set rule. The project-side requirement (one pinned Node for CI tests and developers, a wrapper in the CI test step) is the human's decision; the Squeal side is the `CI` normalization for passes and the observed-set rule.
3. **Smallest first slice:** a key-equality proof before any transport. `squeal export <commit>` writes a bundle (keys, passes, closures, observed sets, environment descriptor) from a store, and `squeal import <file>` adds passes whose key equals the locally computed one, under an "imported" origin; `status` names each environment part that differs ("CI ran Node 26.13.0, this machine 24.22.1"). Trial it on cezar: one merge-group run with the wrapper, then count matching keys in a developer worktree at the same commit. The transport (`refs/notes/squeal`, `workflow_run`) comes second.
4. **What it would save on this host:** about 14 to 27 file-hours a day (cezar 13 to 25, squeal 1 to 2), a mean of 0.6 to 1.1 vCPU, 5 to 9 file-hours of it above 16 busy vCPUs. Against 92 Squeal worker-hours a day, that is about 15 to 30% of Squeal's work. The range assumes every environment part is fixed and today's closures.

## Open questions

1. Squeal's own overhead in a CI test step (wrapper, recorder, keying): not determined, because no CI run or test run was allowed; the trial in recommendation 3 measures it.
2. Dirty runs: not determined per run, because removed worktrees keep no uncommitted state; the range brackets it.
3. Imported results from a merge group that reused a PR run: trust not decided (spec question).
4. Browser-mode Vitest projects under the `CI` normalization: not determined (neither project uses Vitest browser mode).
5. The after-switch window is 0.86 days (cezar) and 1.2 days (squeal); its shares need a longer window.

## Sources

- Stores: `~/projects/{squeal,cezar}/.git/squeal/store.sqlite` (+`-wal`, `-shm`) and `runs/*/report.json`, copied 2026-11-07 23:12Z; sar `/var/log/sysstat/sa31`, `sa01`–`sa08`.
- GitHub (read only): `repos/hearsay-tools/cezarion/actions/workflows/346945062/runs` (485 main pushes, 366 merge groups), `repos/hearsay-tools/squeal/actions/workflows/374500850/runs` (132 main pushes, 95 `cand/**` pushes), their `jobs`, and the logs of jobs 128550113283, 128550113674, 128550113206 (cezar) and 128549784439, 128549784455 (squeal).
- cezar `fcf2a5227`: `.github/workflows/ci.yml`, `.github/scripts/queue-ci-proof.cjs`, `package.json`, `squeal.config.json`; `fc5c2c5e0` (browser `at: manual`, lookup-only start).
- squeal `571824713`: `.github/workflows/ci.yml`, `package.json`, `squeal.config.json`, `src/core/keys/environment.ts`, `src/core/keys/observed.ts`, `src/core/keys/key-format.ts`, `src/runners/vitest/environment.ts`, `src/core/types/policy.ts`.
- Vitest 5.0.3 and 4.1.10 `dist/chunks` (installed copies): `allowOnly`, `updateSnapshot`, `browser.headless`, `browser.ui` from `isCI`.
- Earlier findings: `result-import.md`, `remote-store.md`, `ci-run.md`, `ci-reuse.md`; `011-core/research/new-worktree-baseline.md`, `load-slowdown.md`; `015-coverage-complexity/spec.md` (coverage cost).
