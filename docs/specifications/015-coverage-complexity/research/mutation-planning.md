# Mutation planning: can Squeal's coverage records plan a StrykerJS run?

**Do not add a planning command now.** Squeal's records do cut the test set: per changed function, to 21% of Vitest `related` on cezar's pull requests (median 5 test files against 55). No false survivor was found. But on the one measured file the cut saved about 14% of Stryker's CPU, because only the dry run gets smaller. It lets none of the 7 pull requests that hit cezar's 150-file cap run. cezar's job runs in CI, where no Squeal store exists. `squeal reach <file> --json` already lists the file-level "called" test files for a local trial.

Researcher, 2026-11-09, 13:15Z to 15:00Z, row 015-125. Read: `docs/vision.md`, `docs/styleguide.md`, this spec's D8, D9, D11 and `status.md`, `research/selection-tools.md` (StrykerJS part), `research/edit-reach.md`, cezar's `stryker.config.json`, `vitest.stryker.config.ts`, `.github/scripts/mutants-{run,scope,related,functions}.*`, `.github/workflows/mutation-report.yml` and `mutants-weekly.yml`. Versions: cezar `7b726e2a2` (main, 2026-11-09 12:00Z), StrykerJS core and vitest-runner 10.1.1 (cezar's pin), Vitest 4.1.10, Squeal plugin build 0.1.419 (committed `plugins/claude-code/dist`). Probes and outputs: `probes/mutation-planning/`.

**Evidence base.** cezar's 123 mutation-report artifacts still stored (runs 2026-10-26 to 11-01, the newest per branch: 52 pull requests, 58 package runs with a Stryker report, 7 skipped for the cap). Each artifact holds Stryker's full JSON report, with each mutant's `coveredBy` and `killedBy`. Squeal's side: copies of cezar's stores, taken 13:29Z. They hold 6,294 coverage records (provider version 4), all recorded 2026-11-09 08:34 to 13:23Z, newest per test file: 1,785 test files.

**Budget overrun.** Stryker used about 120 CPU-minutes, over the brief's 90. The cause was Stryker's fallback in Q4: a test set that reaches no mutant runs every listed test for every mutant. I stopped that run, so its report is missing.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Test-set size | Per package run, medians: `related` 55 test files, Squeal "a function of the file ran" 11, "loaded only" 9, per changed function 5, Stryker's own coverage 3. The cap: 0 of 7 capped pull requests would come under 150. Today 17 of 25 package runs over 150 would. | verified by experiment (store copy, Vitest graph, stored reports) |
| 2 | Safety | 0 false survivors observed. Stored reports, same bytes: all 672 killed mutants had a killer in Squeal's set, or one deleted since. Experiment: 46 mutants, Squeal's 25 files kill 39; the other 53 `related` files reach no mutant. | verified by experiment for B; the related arm inferred |
| 3 | `NoCoverage` | 252 of 4,244 scored mutants (5.9%). Squeal's per-function "no test runs it" predicts 1 of 26 checked at the same bytes. It wrongly marks 0 of 949 covered mutants. | verified by experiment |
| 4 | Cost | Dry run: 78 → 25 files saves 59% CPU and 58% wall time. Mutant runs: no saving, since Stryker runs only covering tests per mutant. `--testFiles` exists since 9.5.0. No option takes outside coverage. | verified by experiment; read in source code |
| 5 | In-place and a live daemon | In place: 2 revisions, test runs at the instrumented revision, 0 transitions. Sandbox: nothing while `.stryker-tmp/` is git-ignored. Squeal watches it when it is not. | verified by experiment |

## Findings

**1. Test-set size.** *verified by experiment.* In all 58 runs, Stryker's dry run ran exactly the `related` set: the report's test files equal the job's `relatedTests` count. Its per-test coverage then needs far fewer files: 537 covering files against 3,035 related (18%). I compared the sets at one revision, `7b726e2a2`, for the 65 package rows whose files still exist. Summed over rows: `related` 4,709 test files; Squeal "called" 1,803 (38%); per changed named function 992 (21%). Medians per package:

| Package (rows) | `related` | Squeal called | Squeal loaded only | Per changed function | Stryker covering (PR head) |
|---|---|---|---|---|---|
| contract (11) | 15 | 1 | 14 | 0 | 0 |
| web (23) | 52 | 11 | 8 | 6 | 5 |
| cezar (24) | 160 | 15 | 62 | 5 | 3 |

The 7 capped pull requests (cezar package, 288 to 386 `related` files then, 618 to 812 now) stay over 150: 517 to 699 files called, 183 to 693 by changed function. So the cap would stop skipping 0 of 7. The cezar package's `related` count roughly doubled between the pull requests and today (for example 106 → 179 for `server/repo-branches.ts`). So 25 of 65 rows are now over 150; 17 of them fall to 150 or fewer by changed function, 14 by file-level "called".

**2. Safety (false survivors).** A mutant can be killed only by a test that runs its code, so B (Squeal's set) can lose a kill only where `related` minus B (C) covers the mutant.

- *Experiment* (`web/src/lib/use-search-params-writer.ts`, 46 mutants, scratch at `7b726e2a2`). B: Squeal's 25 "called" files. Stryker found all 25 covering. Result: 39 Killed, 7 Survived, 0 `NoCoverage`. C: the other 53 `related` files. Squeal's records for 52 of them show the hook's function (lines 29 to 67) with no hit; the 53rd file's record does not name the file. Vitest's own V8 coverage on 3 of them agreed: 0 hits in all three functions. Stryker's C run behaved as when no test reaches a mutant (finding 4). It ran 17 minutes of mutant runs, and I stopped it before its report. So: 0 false survivors on this file. *inferred* from the records, the V8 check and the fallback; Stryker's own C report was not obtained.
- *Stored reports*, mutants in files whose bytes at the PR head equal the record's blob (929 of 4,659 mutants). Of 672 Killed, 663 have a killing test file in Squeal's "called" set. The other 9 were killed only by `routes/tasks-overview.test.tsx`, deleted after those pull requests (cezar #2611), so it has no record: a revision gap, not a missed call. *verified by experiment.*
- *What Squeal's "called" leaves out.* 38 (test, mutant) pairs had Stryker coverage while Squeal records the test as "loaded only". All are module-level mutants (`static: true`, for example regex constants in `task-thread/file-links.ts`) whose module loaded lazily during a test, and all Survived. A plan must keep loaded-only tests for module-level mutants. It must keep test files with no record, unread bytes or `unknown`. With `ignoreStatic: true`, as in cezar, only such mixed mutants are affected. *verified by experiment.*

**3. Uncovered mutants.** *verified by experiment.* In the newest run of each pull request, 252 of 4,244 scored mutants were `NoCoverage` (5.9%; 414 Ignored left out). In the 26 checked at the same bytes, Squeal's per-function state says "no test runs it" for 1. The other 25 sit in functions that ran: a JSX branch, an `?.`, or a default string on a line that ran. Line-level coverage would catch 6 of 26. No covered mutant (0 of 949) is in a function Squeal says no test runs. So Squeal's state is sound but catches few. A record keeps covered lines and a hit per function, not V8's block ranges (`src/core/code/coverage/types.ts`, `CoverageSource`). Sub-line prediction would need a richer record. *read in source code.*

**4. Cost.** *verified by experiment* on the web file, at load 29 to 41:

| Phase | `related` (78 files, 2,651 tests) | Squeal called (25 files, 844 tests) |
|---|---|---|
| Dry run | 588 s wall, 511 CPU-s | 247 s wall, 212 CPU-s |
| Mutant runs (46 mutants) | not completed | 652 s wall, 1,656 CPU-s |

The mutant runs were 89% of B's CPU. Each mutant ran up to 527 tests in 25 files. With `coverageAnalysis: perTest`, Stryker runs only a mutant's `coveredBy` tests (`mutant-test-planner.js`), and C covers none here. So a smaller set saves in the dry run only: about 299 of 2,167 CPU-s (14%) and 341 of 1,240 s wall (27%). *inferred:* `related` total = its dry run + B's mutant runs.

*read in source code* (`@stryker-mutator/core` and `vitest-runner` 10.1.1, `node_modules/@stryker-mutator/*/dist/src`):

- `testFiles` (CLI `--testFiles`, globs) is new in core 9.5.0: absent in 9.4.0, present in 9.5.0 to 10.1.1. The dry run passes it to `VitestTestRunner.dryRun`, which starts Vitest with those files. It also filters mutants planned without per-test coverage. With `vitest.related` true (the default), Vitest's related filter still applies, so a planner should set it false. Per mutant, the runner runs the `coveredBy` test IDs as a name pattern.
- No option takes outside coverage. `executeDryRun` always runs; `dryRunOnly` stops after it and writes no JSON report. Incremental mode needs the dry run too (`selection-tools.md`).
- **The fallback** (`test-coverage.js`): `hasCoverage` is `!!mutantCoverage.static`. When no test in the dry run touches any mutant, Stryker has no coverage. It then runs every listed test for every mutant and reports `Survived`, not `NoCoverage`. *verified by experiment:* in the scratch repository, `testFiles: ["src/other.test.ts"]` gave 26 Survived, each after the whole set. A plan whose set reaches no mutant must skip the package, as cezar's job does for 0 related files.

**5. In-place mutants and a live daemon.** *verified by experiment:* scratch repository, 2 test files, own daemon (0.1.419, `baseline.onStart: lookup-only`, coverage on), Stryker concurrency 2, load 12 to 19.

| Run | Revisions | Runs | Results | Transitions | Coverage records | Daemon CPU |
|---|---|---|---|---|---|---|
| In place, 4 s | +2 | 0 | 0 | 0 | 0 | 0.5 s |
| In place, 12 s (a 1.5 s test) | +2 | +1, at the instrumented revision | +3 | 0 | +1 (instrumented bytes) | 1.1 s |
| Sandbox, `.stryker-tmp/` ignored | 0 | 0 | 0 | 0 | 0 | 0.2 s |
| Sandbox, not ignored | +1 (10 paths under `.stryker-tmp/sandbox-*/`) | 0 | 0 | 0 | 0 | 0.4 s |

In place, Stryker rewrites more than the mutated file. It adds `// @ts-nocheck` to every file its `disableTypeChecks` default matches: here all 4 files under `src/` and `vitest.config.ts`. In the cezar scratch, a stopped run left 276 files changed outside `packages/` (I had already restored `packages/`), `vitest.config.ts` and `vitest.stryker.config.ts` among them. cezar's `restoreTree` checks out only `packages/`. Squeal sees each rewrite as a revision. If the run lasts longer than Squeal's debounce and queue, it runs the re-keyed tests against the instrumented code. Those pass, because a mutant is active only inside Stryker's own runners. After the restore, the original keys find their results again, so nothing reruns. In cezar a long in-place run in a worktree with a live daemon would re-key most of the suite through the root config and run it once. *inferred.* No revision in cezar's store names a Stryker path (894 revisions since 2026-10-14). Squeal watches `.stryker-tmp` only when git does not ignore it (`src/core/watcher/candidates.ts`, `git check-ignore`). cezar ignores `.stryker-tmp/`, `/reports/` and `/stryker-setup-*.js`. In the unignored case, no run started, because the project's `include` did not match the sandbox copy.

## Recommendation for Squeal

No new row. The evidence against a Squeal planning command now:

- **The saving is the dry run only.** Stryker's per-test coverage already narrows each mutant run. On the measured file, Squeal's set cut 59% of the dry run's CPU and about 14% of the whole run.
- **It does not lift the cap where it bit.** 0 of the 7 capped pull requests would have run. It would help today's cezar-package rows (17 of 25 now over 150), because `related` doubled there.
- **cezar runs Stryker in CI,** where no Squeal store exists. A plan needs the records locally, or a store copied to the runner.
- **Existing tools first.** `squeal reach <file> --json --limit <n>` already lists, per route, each test file with its coverage state (`called`, `loaded only`, `not loaded`, `no record`; D11, `src/core/reach/report-types.ts` `NamedFile`) at the worktree's current keys. Stryker 9.5.0 and later take that list through `--testFiles` with `vitest.related: false`. cezar can try it locally without a Squeal change.
- **Rules a trial must keep:**
  - Keep test files with `no record`, `unread` or `unknown`.
  - Keep loaded-only tests for module-level mutants.
  - Skip a package whose set reaches no mutant, because Stryker then reports everything `Survived` at full cost.

Only per-function loaders would be new; they gave 21% against 38%. Raise that only if a local trial shows the dry run matters.

For in-place runs beside a live daemon, the cost is one run per re-keyed test file, and there are no transitions. Note it in cezar's mutation docs: use sandbox mode locally, or `squeal stop --until-start` for the run. No Squeal change is needed. Squeal already skips `.stryker-tmp/` when git ignores it.

Limits: one file for the B arm (46 mutants), and its related arm was not completed. The repo-branches and density files were not run (budget). Squeal's sets come from today's records, against pull-request reports up to 14 days older. The per-mutant checks cover the 929 mutants whose file bytes matched. Squeal's sets read the newest record over all 16 worktrees: 28 "called" pairs came from 4 test files not on main.

## Open questions

- Stryker's report for `related` minus called (C) on the web file: not obtained. I stopped the run at the CPU budget. A rerun with `--mutate` limited to a few lines would cost about 6 CPU-minutes for the dry run.
- Why the cezar package's `related` count doubled between 2026-11-01 and 11-09: not determined.
- Why web `related` names test files whose records do not name the file (median 15 per web row): not determined. Type-only edges in Vite's module graph are a guess, not checked.
- Whether local Stryker runs exist in cezar worktrees with live daemons: not determined. The store shows no Stryker paths, but in-place edits show only as source changes.

## Sources

- cezar `hearsay-tools/cezarion` at `7b726e2a2`: `stryker.config.json`, `vitest.stryker.config.ts`, `.github/scripts/mutants-run.cjs`, `mutants-scope.cjs`, `mutants-related.mjs`, `mutants-functions.cjs`, `.github/workflows/mutation-report.yml`, `mutants-weekly.yml`, `.gitignore` lines 65 to 68.
- Mutation-report artifacts: GitHub Actions runs of `mutation-report.yml` (list in `probes/mutation-planning/results/runs.txt`), `https://github.com/hearsay-tools/cezarion/actions/workflows/mutation-report.yml`.
- StrykerJS 10.1.1 as installed in cezar: `@stryker-mutator/core/dist/src/{process/3-dry-run-executor.js,mutants/mutant-test-planner.js,mutants/test-coverage.js,fs/project-reader.js}`, `schema/stryker-schema.json`; `@stryker-mutator/vitest-runner/dist/src/{vitest-test-runner.js,stryker-setup.js}`, `dist/schema/vitest-runner-options.json`. Core 9.0.0, 9.3.0, 9.4.0, 9.5.0, 9.6.0, 9.6.1 and 10.0.0 from `npm pack`: `dist/src/process/3-dry-run-executor.js`. Upstream: `https://github.com/stryker-mutator/stryker-js/tree/v10.1.1/packages`.
- Squeal: `src/core/code/coverage/types.ts`, `parts.ts`; `src/core/watcher/candidates.ts`; spec 015 D8, D9, D11.
- Earlier research: `research/selection-tools.md`, `research/edit-reach.md`.
- Probes and outputs: `probes/mutation-planning/` (README, scripts, `results/`).
