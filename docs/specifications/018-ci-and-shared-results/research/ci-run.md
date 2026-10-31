# ci-run: Squeal as the thing that runs tests in a CI job

Researcher findings for spec 018, topic `ci-run` (row 018-01). Examined 2026-10-31: source at 6053220eb (Squeal 0.1.387), the CLI bundle `plugins/claude-code/dist/cli/squeal.mjs` of that commit, Vitest 5.0.3, Node 24.22.1, git 2.43.0. Experiments ran in fixture clones under `$TMPDIR` (`probes/ci-run/`, outputs in `probes/ci-run/results/`). GitHub was read only (`gh run list`, `gh run view --log`, `gh api .../jobs`). Key portability across machines is topic `result-import`; this file does not measure it.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Does `squeal run` work in a fresh CI-like checkout? | Yes, as three commands: `squeal start`, `squeal run --all --wait`, `squeal stop`. Exit 0 pass, 1 known failures, 3 no verdict (also when no daemon runs). Shallow clone, detached HEAD, no git identity, no `XDG_RUNTIME_DIR`, read-only HOME and `CI=true` broke nothing. No JUnit; `status --json` lists known failures only | verified by experiment, read in source code |
| 2 | What a CI user needs | Has: exit code, a deadline (`--wait <ms>`), run logs in the store. Lacks: a CI report format, per-test pass records in JSON, sharding, CI annotations, a one-command run that stops its daemon, and a package a CI job can install | verified by experiment, read in source code |
| 3 | Skipping known results in CI | It works today: a restored store at the same path gave "3 already current, 0 run now". Prior art skips only on declared or observed inputs and then relies on a later full run. A restored failure is also served without a re-run | verified by experiment, read in official docs |
| 4 | This repository, last 20 landings | 67% of test files and 57% of Node 22 test-file seconds kept their key. 88% of that comes from 10 docs-only pushes. On the 8 product landings only 10.5% of seconds kept their key. 1 of 4 CI failures in the window would have been hidden | verified from git, store copy and CI logs; inferred model |
| 5 | Fit with the vision | Not as a runner wrapper or a CI test selector. Only a result producer for `result-import` could fit, and today a CI key never equals a laptop key | inferred |

## Findings

### 1. What exists today

`squeal run --all [--force] [--wait [<ms>]]` asks the worktree's daemon for a full-suite checkpoint over its socket (`src/cli/run.ts`). It starts no daemon. Without a daemon it prints `No verdict: no daemon running for <root>; start one with squeal start` and exits 3 with `--wait`, or exits 1 without it (read in source code; the `--wait` case verified by experiment, `results/run.log`). Without `--wait` it exits 0 once the checkpoint is recorded, before any test ran, so only `--wait` gives a verdict. `squeal warmup` runs `start` and `run --all --wait` in one command, but it re-runs every file, current ones too, to record ignored reads, and it leaves the daemon running (`src/cli/warmup.ts`; verified, `results/warmup.log`).

A CI-like job in a fresh clone of a 3-file fixture: `env -i`, `CI=true`, depth-1 clone, detached HEAD, no git identity (`GIT_CONFIG_GLOBAL=/dev/null`), no `XDG_RUNTIME_DIR`, HOME mode 555 (`probes/ci-run/ci-like.sh`). Verified by experiment:

- `start` exits 0 in 0.3 s. `run --all --wait` exits **1** in 2.3 s with one known failure and prints the verdict line first: `Checkpoint <id> completed at revision 0: 1 known failure: 1 test; 3 test files, 0 already current, 3 run now`, then the status with the failure's message and location. `stop` exits 0. No process was left and nothing was written under HOME.
- The socket falls back to `/tmp/squeal-<uid>` without `XDG_RUNTIME_DIR` (`src/core/daemon/paths.ts`). The store is created at `.git/squeal/` (`store.sqlite`, `code.sqlite`, `runs/`).
- The bundle needs only Node and the project's own `node_modules`: a `git archive` copy of `plugins/claude-code/` outside this repository gave the same exit codes (3, 0, 1, 0).
- `squeal status` and `status --wait` exit **0** with a known failure (`results/restore.log`). A CI step that reads `status` instead of `run --all --wait` passes a red build.

Machine-readable output: `status --json` (`schemaVersion: 1`, 3.3 KB here) carries counts, `fullSuite.atCurrentRevision` and `knownFailures` with message, fingerprint and location, but no per-test pass list (`results/status-run.json`). Squeal replaces the project's Vitest reporters with its own (`reporters: [createSquealReporter(current)]`, `src/runners/vitest/adapter.ts:226`), so a `junit` reporter in the project's config does not run under Squeal (read in source code). Runner output is kept per run as `runs/<id>/vitest.log` and `report.json` in the store directory.

Not tested: macOS and Windows runners, containers without a writable `/tmp`, and the overhead of a large suite under Squeal against `vitest run` (a 3-file fixture says nothing about it).

### 2. What a CI user needs

| Need | Squeal today | Tag |
|---|---|---|
| Exit code | `run --all --wait`: 0, 1, 3. Exit 3 also for "no daemon" and "deadline passed" | verified by experiment, read in source code |
| Report format CI reads (JUnit, GitHub annotations) | None. Project reporters are replaced | read in source code |
| Per-test JSON | Failures only (`status --json`, `failures --json`) | verified by experiment |
| Logs | `runs/<id>/vitest.log` per tier run; `squeal why <check> --include-logs`. A job would upload them as an artifact | read in source code |
| Time bound | `--wait <ms>`: exit 3 at the deadline, "the checkpoint goes on in the daemon". The job must still call `squeal stop` | read in source code |
| Parallelism | Host slots default to CPUs − 1, as Vitest's own default: 3 on a 4 vCPU runner | read in source code (`src/core/daemon/user-config.ts`) |
| Sharding | None for Vitest. This repository's CI runs 3 shards per Node 22 job | read in source code, `.github/workflows/ci.yml` |
| Install in CI | No npm package (`"private": true`). `install.sh` installs through `claude`, `codex` or `pi` on the PATH. A job would download the release tag's `plugins/claude-code/` and run `node .../squeal.mjs` | read in source code and `README.md`; verified that the copied bundle runs |
| Lifecycle | 3 commands plus `stop` in an `always()` step. No single "run and exit" mode | verified by experiment |

### 3. Skipping known results in CI

What Squeal already does, verified by experiment (`probes/ci-run/cache-restore.sh`, `results/restore.log`). The store was saved, the clone deleted, a new clone made at the same path, and the store restored, as a CI cache would. Then `run --all --wait` gave `3 test files, 3 already current, 0 run now` and exit 1 in 0.23 s. The failing file was **not re-run**: a restored failure is served as current. A flaky failure would stay red in every later job until its inputs change or `--force` or `squeal retry` is used. Same path, user, Node and environment, so this measures no portability.

With `CI` unset in that same clone and store, `status` said `3 of 3 test files (3 stale)` and `run --all --wait` ran all 3 again (`results/ci-flag.log`). Vitest sets `allowOnly: !isCI` (`node_modules/vitest/dist/chunks/defaults.D2ip7f-X.js:51`), and Squeal keys the resolved config with `allowOnly` on purpose (`src/runners/vitest/environment.ts:107`, "What `CI` sets stays keyed"). So no laptop key equals a CI key today unless the laptop also sets `CI`. Verified by experiment, read in source code. Whether other inputs differ across machines is topic `result-import`.

How prior art decides a skip is safe:

| Tool, version | Rule | Incomplete inputs | Tag |
|---|---|---|---|
| Bazel 9.3.1 | `--cache_test_results=auto`: re-run when inputs changed, the test is tagged `external`, `--runs_per_test` is set, or "the test previously failed" | Tests "should be hermetic"; the sandbox enforces declared inputs. "Bazel does not track tools outside a workspace ... two users with different compilers installed will wrongly share cache hits" | read in source code (`TestConfiguration.java`), read in official docs |
| Turborepo 2.11.10 | "Turborepo assumes that your tasks are deterministic". Strict env mode passes only declared variables | Strict mode "doesn't guarantee task failure ... you could still ... get unintended cache hits". `--affected` "falls back to running all tasks" on shallow clones | read in official docs |
| Nx 24.0.3 | Hash of declared `inputs` | Ultracache: in CI, "hashes a task from the files it read on a recorded run", "preventing stale cache hits from missing input declarations". Recorded only on Nx Cloud Workers | read in official docs |
| Develocity 2026.3 (Gradle 9.8.2) | Gradle's `Test` task is cacheable. Predictive Test Selection results from "only a subset of all tests or failing tests are never stored in the Build Cache" | Recommends running "remaining tests" later, "post-merge, nightly or ready-for-release". Calibrated to catch "over 99% of non-flaky" failures; "incomplete test task/goal inputs" are "a common reason for incorrect predictions" | read in official docs |
| Launchable | Not determined: the docs page rendered no text without JavaScript | - | - |

Squeal's closure already holds more than declared inputs: imports, declared `inputs`, absent resolution candidates, and, with `observe.runtimeInputs` (default true, `src/core/types/policy.ts:345`), the paths each run was seen to read, stat, list or execute, merged and never pruned (spec 001 D3, task 001-132). That is Nx Ultracache's signal, recorded on every run. It does not cover: environment variables outside the allow-list, gitignored paths ("no input declaration keys a gitignored path", `src/cli/warmup.ts`), paths outside the project, time and network (read in source code).

Evidence that would show a skip is safe enough, and signals that bound the risk (inferred):

- A shadow measurement: on each main landing, compute what an import-and-skip run would skip, and compare each skipped file's outcome with the full run CI does anyway. A file skipped by key whose full-run outcome differs is a false skip: either a flake or a closure gap. Row 011-119 found Squeal right in 100 of 100 scripted local edits (`specifications/011-core/research/watch-mode-comparison.md`); that is selection precision on a laptop, not CI history.
- Bazel's and Develocity's rule: never skip a file whose last result failed. Squeal does skip it today (above).
- A full run on a schedule bounds how long a false skip can live. This repository already runs one nightly, on Node 24 (`ci.yml`, spec 010 D7). Its results have another Node version, so they never match Node 22 keys.
- The environment hash is a blunt bound: here it changed in 4 of 20 landings (finding 4).

### 4. This repository: the last 20 landings

Method (verified from data; the key model is inferred). Landings: the 21 newest `push` runs of `ci.yml` on main, 2026-10-29 15:39 to 2026-10-31 17:44 UTC, 20 transitions (`results/pairs-landings.json`). For each test file, its key is taken as unchanged when no path in its stored closure changed blob between the two commits and the environment inputs did not change: `vitest.config.ts`, the globalSetup file and its imports, `KEY_FORMAT_VERSION`, `VITEST_ADAPTER_VERSION` (`probes/ci-run/same-key.mjs`). Closures are the store's current lists (1,557 test files, read from a copy). `test/e2e/**` is excluded from Squeal here, so it always runs. Weights are per-file times of run 41226020041 (Node 22, 3 shards, 1,377 files, 6,143 s summed; `results/times-node22-summary.json`). `pnpm-lock.yaml` did not change in the window.

| Landings | n | Test-file seconds with an unchanged key | Files | Node 22 job-minutes saved, estimate |
|---|---|---|---|---|
| Docs-only pushes (docs and `docs/**/probes/**`) | 10 | 88.1% (the rest is `test/e2e`) | 98.2% | 328 of 459 |
| One non-docs file (`CLAUDE.md`; one test file) | 2 | 87.5% | 97.8% | 65 of 92 |
| Product landings (releases 0.1.379 to 0.1.387) | 8 | 10.5% (13.8% without the globalSetup closure) | 20.3% | 31 of 367 |
| All | 20 | 57.0% | 67.0% | about 424 of 917 |

Job-minutes: one main run is about 45.9 job-minutes, of which 37.2 are the three Node 22 `Test` steps (run 41226020041). Saved = unchanged share × 37.2, assuming no Squeal overhead and shards that rebalance. Neither assumption was measured.

Why product landings keep so little (verified from the store copy and git):

- 649 of 1,557 stored closures contain `package.json`, and every release bumps its version. That re-keys about half the suite on every release. This is the subject of "results survive releases" (row 011-35).
- In 4 of 8 product landings the environment changed: the globalSetup file `test/global-teardown.ts` imports `src/core/daemon/paths.ts`, which reaches `src/core/types/*`. Any change there re-keys all 1,325+ test files (`probes/ci-run/setup-diff.mjs`). The adapter keys the globalSetup closure by design (`src/runners/vitest/environment.ts:88`).

Most of the apparent saving needs no Squeal: the 10 docs-only pushes re-keyed no test file outside `test/e2e`. CI runs them because `ci.yml` keeps `docs/**/probes/**` in its `paths` filter, since `test/cli/codex-hash.test.ts` reads one probe. A narrower path filter would skip those whole runs, 459 job-minutes, more than the 328 a key skip would save (inferred). That is a spec 010 matter, not 018.

CI failures in the window (47 runs since 2026-10-29 15:00 UTC: 21 main pushes, 2 nightly schedules, 24 candidate pushes; 4 failed; `results/failures.jsonl`):

| Run | Where | Failing file | Key against the import source | A skip would have hidden it? |
|---|---|---|---|---|
| 41205434002 | main push 51b138d2b (docs only) | `test/scheduler/backlog-quiet-exempt.test.ts` ("expected ... length of 1 but got 2") | unchanged since landing 66736c305, which passed | **Yes.** It was a test race, repaired in the test by d0f8149ba (row 011-285, its message cites this run) |
| 41190295201 | nightly, Node 24 | `test/harness/opencode-continued.test.ts` ("Matcher did not succeed in time") | content unchanged since the Node 22 landing, but the Node version differs, so the key differs | No |
| 41174976034 | `cand/0.1.383-r2` | `test/cli/stop-removed.test.ts` | new test file | No |
| 41172825570 | `cand/0.1.383`, Node 24 | `test/runners/node-test/graph-cost.test.ts` (ratio 1.007, expected below 1) | changed | No |

The one hidden failure was a flake on unchanged content. Hiding it would have removed the signal that led to a repair row. No failure in the window was a closure gap. The window holds 4 failures, too few to estimate a false-skip rate. Spec 010 found 437 failed runs in 1,500, mostly flakes (`specifications/010-ci-cost/research/ci-test-time.md`, finding 3).

### 5. Fit with the vision

Principle 5: "Squeal does not replace ... CI. They stay the source of truth for results." What Squeal is not: "a CI/CD platform". This repository's own process requires "passing full-suite CI for the exact commit" before a release (`docs/process.md`, 6a). Inferred, per form:

- **Runner wrapper** (`squeal run --all --wait` instead of `vitest run`): adds a daemon, a store and three commands, and removes JUnit, sharding and annotations. It adds nothing a CI user needs. Reject.
- **Test selector** (import-and-skip): it already works when a store is restored at the same path. Here it would save about 10% of test time on product landings, it would have hidden 1 of 4 failures, and it keeps failures red without a re-run. Its full value needs a skip on main, which the release rule above forbids. It turns "no known failures" into the CI verdict, which principle 2 says is not "everything passes". Reject for main; not worth it for candidates at a 10% saving.
- **Result producer for import**: CI on main records results that a developer's Squeal may import (idea 2). Of the three, it is the only form that serves the vision's goal, which is faster, trustworthy feedback to the agent. CI stays the source of truth and Squeal only reads its output. It fails at the first step today: `CI=true` alone changes every key. Its value depends on `result-import`.

## Recommendation for Squeal

1. Do not ship Squeal as a CI runner or as a CI test selector. A runner wrapper adds nothing; a selector saves about 10% of test time on this repository's product landings, hides flakes and conflicts with the full-suite release rule.
2. If spec 018 goes on, the only form is a result producer for topic `result-import`: a job on main pushes whose output a local Squeal may import. Decide it after `result-import` says whether keys can match across machines. The `CI` variable alone already stops that today.
3. Before any producer is built, the cheapest evidence is a measurement row, proposed here and not run: a shadow job on main for two weeks (about 40 to 80 landings) that computes the keys of the landing, looks them up in the previous landing's results, and compares with the full run's outcomes. Cost, estimated and not measured: one extra job of about 5 to 15 job-minutes per landing (install, listing and keying, no test run), inside the Free plan's 20 concurrent jobs. It measures the false-skip rate this window was too short for.
4. Separate from 018: narrowing `ci.yml`'s `docs/**/probes/**` path filter to the one probe `test/cli/codex-hash.test.ts` reads would save about 46 job-minutes per docs-only push (10 of the last 20 landings). That belongs to spec 010.

## Open questions for the human

1. What did you want from "Squeal in CI": faster CI (a selector), or shared results for developers (a producer)? The data supports only the second, and only if keys can match across machines.
2. Would you accept any CI job on main that skips tests by key, given the release rule "passing full-suite CI for the exact commit"? If not, a selector is out.
3. For a producer: may CI run the suite under Squeal (no shards, no JUnit), or must it keep `vitest run` and Squeal read its output? The second needs a Squeal import of a runner report, which does not exist.
4. Should the docs-probes CI path filter (Recommendation 4) go to spec 010 as a row?

Not determined, because no experiment was cheap here: Squeal's overhead against `vitest run` on a large suite in CI (needs a CI run on a branch: 3 runs each way, about 120 job-minutes); the size of a CI-only store after one full run of this repository; macOS and Windows runners.

## Sources

- Source at 6053220eb: `src/cli/run.ts`, `src/cli/warmup.ts`, `src/cli/start.ts`, `src/cli/main.ts` (help text), `src/core/daemon/paths.ts`, `src/core/daemon/user-config.ts`, `src/core/keys/environment.ts`, `src/core/keys/observed.ts`, `src/runners/vitest/environment.ts`, `src/runners/vitest/adapter.ts`, `src/core/types/policy.ts`, `.github/workflows/ci.yml`, `package.json`, `README.md`, `docs/process.md`, `docs/specifications/001-core-loop/spec.md` (D3, D4).
- Vitest 5.0.3 `dist/chunks/defaults.D2ip7f-X.js:51` (`allowOnly: !isCI`), `dist/chunks/cac.DfDGTQ9W.js:950`.
- Store: a `node:sqlite` `backup()` copy of `<common dir>/squeal/store.sqlite` taken 2026-10-31 22:47 local, read-only, deleted after use. Tables `test_files` (closures) and `results`.
- GitHub, read 2026-10-31: `gh run list --workflow ci.yml` (main pushes, and all runs created after 2026-10-29 15:00 UTC); job logs of runs 41226020041, 41205434002, 41190295201, 41174976034, 41172825570 (`gh run view --job/--log-failed`).
- Bazel 9.3.1: https://github.com/bazelbuild/bazel/blob/9.3.1/src/main/java/com/google/devtools/build/lib/analysis/test/TestConfiguration.java, `site/en/reference/test-encyclopedia.md`, `site/en/remote/caching.md` at 9.3.1.
- Turborepo v2.11.10: `apps/docs/content/docs/crafting-your-repository/{caching,using-environment-variables,constructing-ci}.mdx` at https://github.com/vercel/turborepo/tree/v2.11.10.
- Nx 24.0.3: `astro-docs/src/content/docs/features/cache-task-results.mdoc`, `reference/inputs.mdoc`, `features/CI Features/{affected,remote-cache}.mdoc`, `kb/skip-unaffected-e2e-tests.mdoc` at https://github.com/nrwl/nx/tree/24.0.3.
- Develocity 2026.3, Predictive Test Selection: https://docs.develocity.ai/2026.3/guides/predictive-test-selection/ (redirected from docs.gradle.com). Gradle 9.8.2 build cache: https://docs.gradle.org/9.8.2/userguide/build_cache.html. Launchable: https://help.launchableinc.com/features/predictive-test-selection/ (no text without JavaScript). All retrieved 2026-10-31.
- Earlier findings: `specifications/001-core-loop/research/result-fingerprinting-prior-art.md`, `specifications/010-ci-cost/research/ci-test-time.md`, `specifications/011-core/research/watch-mode-comparison.md`.
- Probes: `probes/ci-run/` (README lists each script and output).
