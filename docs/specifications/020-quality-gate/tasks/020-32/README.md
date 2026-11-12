# 020-32: the Cezar trial of the existing configuration for its packaged tests (draft diff)

Worker 5180f9e2, 2026-11-12. Brief: `../wave-11.md`, section "020-32". Issue #194; research `../../research/issue-194.md` (case 2, question 5) and `../../research/build-wrapper.md`. Spec 020 D12 (child-process coverage) and D15 (`prepare`). Nothing was pushed. Spec 018's coordinator (3739e45a) opens the Cezar pull request.

The diff is `cezar-ci.diff`, against Cezar `origin/main` `924575538`. The parent (31e1d860) decided two points during the work ("Decisions" 1 and 2).

## Survey: the packaged suite on Cezar `origin/main`

Read in a scratch clone `/tmp/w5180f9e2/squawk` of `hearsay-tools/squawk` at `origin/main` `924575538` (nothing written under `~/projects/cezar`).

| # | Question (brief) | Answer | Tag |
|---|---|---|---|
| 1 | Does the suite split into a build plus a plain `node --test` run? | **Yes.** `npm run test:package` runs `node scripts/test-package.mjs`. The script checks that each argument is a `.test.ts` file under `packages/cezar/test/e2e/`. It runs `npm run build` at the repository root when the stamp `node_modules/.cache/cezar-test-package/stamp.json` does not match the build inputs (`needsBuild`). Then it runs `node --import ../../scripts/test-home-env.mjs --import tsx --test <files>` in `packages/cezar`. That is the `argv` and `cwd` of the existing `test:unit` entry in `squeal.config.json`. The script has no build-only mode; the root `build` script ends with `node scripts/test-package.mjs --record-build-stamp`. | read in source code |
| 2 | Does the TypeScript test run under node:test? | **Yes**, through `--import tsx`, as the 12 `test/unit/*.test.ts` files of the `test:unit` entry already do. | read in source code and config |
| 3 | Does `scripts/release.mjs` run unbundled in the child? | **Yes.** `release.test.ts` `runScript` starts `execFile(process.execPath, ['--import', <test/fixtures/release-switch-off.mjs>, scripts/release.mjs, ...args], { env: { ...process.env, ... } })`. The child is a plain Node process that runs the source file itself, and it inherits the test's environment, so `NODE_V8_COVERAGE` reaches it. But `release.mjs` imports `packages/cezar/dist/**/*.js`. Those are `tsc` outputs, one per source file (`sourceMap: true`, `outDir: dist`, `rootDir: src`), and `dist/` is ignored by git. Squeal's child record names the scripts V8 ran (`ownRecord` in `src/core/code/coverage/own.ts`): `scripts/release.mjs` and the `dist` files, not `packages/cezar/src/**/*.ts`. So this test can give child evidence for `scripts/release.mjs` only. Functions in `packages/cezar/src/release/*.ts` keep the evidence of their own Vitest tests (for example `src/release/stable.test.ts`). | read in source code (Cezar, Squeal) |

Other facts found:
- #194's change is cezarion#3297, merged as the single commit `b12aed82b` (parent `d67a30872`), 11 commits behind `origin/main`. It changes 23 files, among them `scripts/release.mjs` (41 lines) and `packages/cezar/test/e2e/release.test.ts` (50 lines).
- The gate reads `prepare` (D15.2) and `coverage.children` (D12.1) at the merge base (`src/cli/code-gate.ts` reads the policy at `mergeBase(root, ref)`). A dispatch of the pull request branch that adds the entry would read `not-prepared` for the packaged files and children off, and that branch changes no function in the packaged suite.
- `npm --prefix ../.. run build`, run in a workspace directory, runs the root `build` script (probe with npm 11.20.0 on a two-package workspace).


## What the diff does

The trial runs only when someone asks for it. The primary trial run replays #194's own change, cezarion#3297 (`b12aed82b`), on Cezar's real packaged suite:

```sh
gh workflow run ci.yml --ref <branch> -f squeal_package_trial=true \
  -f squeal_package_trial_commit=b12aed82bd9e3f7d96d8fd868fd641c9d874b307
```

Without `squeal_package_trial_commit`, the trial measures the dispatched commit against `origin/main`:

```sh
gh workflow run ci.yml --ref <branch> -f squeal_package_trial=true
```

The job runs `squeal code`, the one-shot gate an agent runs before a PR, with two keys added to `squeal.config.json`:

```json
"coverage": { "children": true },
"nodeTest": [ ..., { "name": "test:package", "cwd": "packages/cezar",
  "argv": ["--import", "../../scripts/test-home-env.mjs", "--import", "tsx"],
  "include": ["test/e2e/*.test.ts"],
  "prepare": { "command": ["npm", "--prefix", "../..", "run", "build"], "timeoutSeconds": 600 } } ]
```

The entry is `npm run test:package` without its wrapper: the wrapper's `cwd` and `argv` (the same as `test:unit`'s), the files the wrapper accepts, and the root build it runs when its stamp is stale, as `prepare`. `coverage` keeps its other keys; an existing `test:package` entry is replaced.

Cezar's committed `squeal.config.json` does not change (decision 2). The gate reads both keys at the merge base (D15.2, D12.1), so the job builds two local commits in the runner with `git commit-tree` (decision 1):
- **base**: the merge base (of the measured commit and `origin/main`, or the given commit's first parent), with the two keys added to its own `squeal.config.json`;
- **head**: the measured commit's tree, with the two keys added to its own `squeal.config.json`, whose parent is that base.

The branch `squeal-package-trial-base` names the base. The job checks out the head and runs `squeal code --base squeal-package-trial-base --json --timeout 1200`. So the merge base the gate reads holds the keys, and the changed functions are the measured commit's, never the config. The rest of the dispatch runs as a bare dispatch does.

## Files

| File | Change |
|---|---|
| `.github/workflows/ci.yml` | New inputs `squeal_package_trial` and `squeal_package_trial_commit`. New job `squeal-package-trial`. No existing job or step changes. |
| `.github/scripts/ci-squeal-package-trial.workflow.test.cjs` | New, 9 tests, below. |
| `.github/scripts/ci-squeal-results.workflow.test.cjs` | The new job joins three lists: the `.node-version` readers, the users of Squeal's action and `SQUEAL_JOBS`. So "never gates a merge", "pinned actions", "one Squeal pin" and "no expression in a script" cover it. |
| `docs/sdlc/ci.md` | New section "Squeal packaged test trial" after "Squeal coverage proof". Cezar documents every CI job there. |

The 9 tests:
1. Both inputs (boolean `false`, string `''`), read only by the new job; its `if` over every event: only a dispatch with the boolean `true` and no `pr_number`.
2. Permissions, no token, `continue-on-error` on the job and every step; the checkout and history fetch equal the other gate jobs'; the trial commits come before pnpm, Node, install and the gate; the gate runs only when the commits step succeeded; Squeal's action equals the shards'.
3. The trial entry against Cezar's own files: `cwd` and `argv` equal `test:unit`'s; `include` is the wrapper's `suite` directory; the wrapper's `node --test` command line is the entry's `argv`; `prepare` runs the root `build` script; and the committed config has no `test:package` entry and no `coverage.children`.
4. The commits step on a real git repository: base = merge base + keys, head = measured tree + keys on that base; the only file between base and head is the measured change; the only file between the measured commit and head is `squeal.config.json`; the base branch; a clean tree; the configs in the artifact.
5. The replay mode: dispatched from `main`, measures the given commit against its first parent, and replaces a `test:package` entry the config already has.
6. The input is refused before any fetch unless it is a full lowercase 40-character SHA: an option (`--upload-pack=…`), a branch name, a short SHA, a SHA with a newline, an uppercase SHA; a full SHA that is not in the repository fails at the fetch.
7. The gate step with a fake `squeal`: its command, and exit codes 0, 1, 3 and 2 kept while the step exits 0.
8. The summary on a fixture report: the commits, the verdict, each run with `prepare` and child counts, and the function table (a `pass` that no packaged test loads is left out).
9. The summary without a report (exit 2 with the stderr tail) and without trial commits.

## Input, job and steps

`T` below means `github.event_name == 'workflow_dispatch' && inputs.squeal_package_trial == true && inputs.pr_number == ''`. With `== true`, a string `'true'` does not count. Pull request, merge group and push runs have no `inputs`, so `T` is false for them. A dispatch with `pr_number` (a release PR) takes no trial, as with the gate trial (020-08c) and the coverage proof (020-26c).

| Added | Runs on | Notes |
|---|---|---|
| `on.workflow_dispatch.inputs.squeal_package_trial` | | boolean, default `false` |
| `on.workflow_dispatch.inputs.squeal_package_trial_commit` | | string, default `''`; a full commit SHA |
| job `squeal-package-trial`, "Squeal packaged test trial" | `T` | no `needs`, so it starts at once; `timeout-minutes: 45`; job-level `continue-on-error: true`; `permissions: contents: read` |
| 1. Check out the dispatched commit | | `github.sha`, depth 1, no stored credentials |
| 2. Fetch the history the gate compares | | the same command as `complexity-gate` and the gate trial: this commit's history and `main` |
| 3. Build the trial commits (`commits`) | | the local base and head above; refuses an input that is not a full SHA before any fetch; fetches a given commit only when it is not already there; writes `commits.json` and the two `squeal.config.*.json` files |
| 4. Set up pnpm | | 12.11.2, as the other jobs |
| 5. Set up Node.js | | `.node-version` of the measured tree, after the checkout of the head |
| 6. Install pnpm dependencies | | `pnpm install --frozen-lockfile`, the measured tree's lockfile |
| 7. Set up Squeal | | `hearsay-tools/squeal/ci@ebd52be86` (0.1.443), the workflow's one pin |
| 8. Run the Squeal quality gate with the packaged tests (`gate`) | `steps.commits.outcome == 'success'` | keeps `report.json`, `stderr.txt`, `exit-code` and `seconds`, prints the stderr, exits 0 |
| 9. Report the trial | `always()` | bash and `jq`; writes the job summary |
| 10. Upload the trial report | `always()` | artifact `squeal-package-trial`, 14 days |

Every step sets `continue-on-error: true`.

## What the trial can and cannot show

It can show, on Cezar's real suite and on a GitHub runner:
- whether the changed functions of #194's change that read `no-loader` (`publish` and its loop in `scripts/release.mjs`, callbacks in `release.test.ts`) read `pass` or something else with the entry and child coverage. Research case 2 expects `pass`, because the test file changed and so is selected (synthetic fixture, Squeal 0.1.443);
- whether `prepare` builds Cezar in a fresh checkout, and its time (`runs[].prepare`);
- how many child coverage files the run read and dropped (`runs[].children`), and the gate's time against the default 600 s budget;
- that `scripts/release.mjs` is measured as an unbundled child (survey question 3).

It cannot show:
- **An edit to `scripts/release.mjs` alone.** Selection follows the import graph and `--test` (D12.6), so a change that does not touch `release.test.ts` selects no packaged test, and `release.mjs` stays `no-loader` (research case 6, row 020-33's second question). The replay touches both files.
- **The missing pre-run hint** with a second node:test entry (research cases 6 and 9, row 020-33's first question).
- **Coverage of `packages/cezar/src/**/*.ts` through the packaged child.** The child runs `dist/*.js`, so the record names the `dist` paths (survey question 3). Those functions keep their own Vitest evidence.
- **The cost on a developer machine.** In CI the checkout is fresh, so `prepare` always builds. Locally it also always builds, because `npm run build` does not read the wrapper's stamp. One dispatch gives one sample on one runner.
- **The daemon.** It does not open an entry with `prepare` (D15.6), so a daemon in Cezar is unchanged by this trial in any case.
- **The effects of a committed config** (follow-up questions below).

## Why nothing can gate

- Only a manual dispatch with the input runs the trial. Pull requests, merge groups and pushes never run it. Cezar's docs say a dispatched run does not satisfy a PR's required checks ("Diagnostic dispatch").
- The job is outside `verify.needs`, outside every other job's `needs`, and outside `REQUIRED_QUEUE_JOBS`. `ci-squeal-results.workflow.test.cjs` asserts all three through `SQUEAL_JOBS`. A mutation that put the job in `verify.needs` failed "the Squeal jobs never gate a merge".
- Every step continues on error, and the gate step exits 0 whatever the verdict. Job-level `continue-on-error` covers a timeout too.
- Only the new job reads the two inputs (a test asserts it). Cezar's `squeal.config.json` is unchanged, so no daemon, check or other gate run sees the keys.
- The local commits and the branch exist only in the runner's checkout. The job has no write permission and no token.

## How to read the summary

- **Measured**: the measured commit, the ref it was compared with (`origin/main`, or `<sha>^1` for a replay), the merge base, and the two local commits.
- **Verdict** and exit code: 0 pass, 1 violations, 3 incomplete, 2 a setup or usage error. Then the gate's time, the budget (1200 s) and whether it ran out, and whether child coverage was read at the base (expect `true`: if `false`, the local base did not work).
- **Changed functions** by state, and paths not counted.
- **One line per runner**: files selected, completed, not finished and failed, the run time, and for node:test the child coverage files read and dropped. Under it, each `prepare`: command, outcome (`passed`, `failed`, `timed-out`, `not-at-base`), exit code, time, and the selected files that did not run because of it. `not-at-base` means the local base did not carry the keys.
- **Function table**: every changed function that a packaged test loads (`loaders.expected` or `loaders.measured` under `packages/cezar/test/e2e/`), and every function that is not `pass`, up to 60 rows: state, gap, lines covered, CRAP and the packaged loaders. For #194, read the rows of `scripts/release.mjs` and `release.test.ts`.
- The artifact has the whole report, the gate's stderr (the D14.4 pre-run lines and the `prepare` output), and the two configs the gate read.

## The PR

- Apply `cezar-ci.diff` on the PR branch: `git apply cezar-ci.diff` at `origin/main` `924575538`. If main has moved, use `git apply --3way`. The hunks touch only: the `workflow_dispatch.inputs` block after `squeal_coverage_proof`; the place after the `squeal-coverage-proof-compare` job; three lists and one comment of `ci-squeal-results.workflow.test.cjs`; and `docs/sdlc/ci.md` after "Squeal coverage proof".
- In Verification, cite the bare `gh workflow run ci.yml --ref <branch>` (Cezar's required proof of a `ci.yml` change). Start the trial dispatch only after that run ends: both dispatches of a branch share the concurrency group `ci-CI-refs/heads/<branch>` with `cancel-in-progress`, so one would cancel the other.
- The trial needs Squeal 0.1.432 or later (D15) behind the workflow's pin. The pin is 0.1.443 today.
- Cost per trial dispatch: the dispatch's own matrix plus one `ubuntu-24.04` runner for up to 45 minutes: install, the root build in `prepare`, and the tests the gate selects. The replay of `b12aed82b` changes 23 files, so the gate also runs the Vitest and node:test files those select, as in #194's run.

## Checks run

All in scratch clones of `hearsay-tools/squawk` under `/tmp/w5180f9e2/` (nothing run or written under `~/projects/cezar`). Tests ran with `node --test --test-concurrency=2` under `env -i`, with a temporary HOME, TMPDIR and git config that has the settings of Cezar's `scripts/test-git-env.mjs`. `node_modules` held copies of `yaml` 2.9.0 and `@babel/parser` 8.0.7 from Cezar's install, so `scripts/test-home-env.mjs`, which requires a full workspace install, was not loaded. The one-minute load was 30 to 79 on 24 CPUs from 11:22Z to 12:45Z.

| Check | Result |
|---|---|
| Workflow tests at the base `924575538`: `node --test .github/scripts/*.workflow.test.cjs` | 218 of 218 pass |
| `git apply --check cezar-ci.diff`, then `git apply`, in a fresh clone at `924575538` | clean |
| The same workflow tests in that tree | 227 of 227 pass (218 plus 9) |
| The ci.yml readers outside the workflow tests (`ci-package-manager`, `coderabbit-wait`, `queue-metrics`, `release-bump-pr`, `release-finalization`, `check-citations`, `change-surface`), with the workflow tests | 393 of 394 pass. The one failure is `vitest-file-duration.test.cjs` "the cap fails a real coverage-enabled Vitest run", which starts a real Vitest; Vitest is not in the copied `node_modules`. It reads none of the new job. |
| actionlint 1.7.12 with shellcheck 0.11.0 (Cezar's pins, SHA-256 checked), `SHELLCHECK_OPTS=--severity=warning` | exit 0. With every shellcheck level, one new note: SC2016 (info) on the summary step's single-quoted `jq` program, the same note the gate trial's summary step has. |
| Mutation: the job added to `verify.needs` | "the Squeal jobs never gate a merge" fails; reverted |
| Mutation: the SHA check as `grep -Eqx` on `printf '%s\n'` | the input test fails (a SHA followed by a newline passed the check); the job uses bash's `[[ =~ ]]` instead |
| `node .github/scripts/check-citations.cjs --base HEAD^1` | "no bare issue or PR citation added" |
| `complexity-gate.mjs --base HEAD^1 --head HEAD` | "Checked 45 changed functions in 2 files: none over 20 is new or more complex than at the merge base" |
| `check-clones.cjs` | not run: `jscpd` is not in the copied `node_modules`. It scans only `packages/`, which the diff does not touch. |
| npm `--prefix`: `npm --prefix ../.. run build` in a workspace of a two-package probe | runs the root `build` (npm 11.20.0) |

**Not run: `e2e.sh`** (in this folder). It runs the job's three scripts, "Build the trial commits", the gate step and "Report the trial", taken verbatim from the patched `ci.yml`, with real Squeal 0.1.443 on the synthetic #194 fixture (`../../research/probes/issue-194/fixture`, the fixture's own entry in place of Cezar's): (A) the dispatched commit against `origin/main`, (B) the replay mode, (C) a control with the keys committed on the branch only and the literal `squeal code --base origin/main`, expected `not-prepared` with children off. It checks the summary's `jq` program against a real report, which the fixture report in test 8 only imitates. The brief allows a live probe only below a one-minute load of 24; the samples were 79, 61, 35, 39, 65, 60 (11:22Z to 11:46Z), then 47 (12:02Z), 38 (12:22Z) and 30 (12:45Z). Run it with `sh e2e.sh <patched Cezar clone with node_modules/yaml> <squeal.mjs>`; it refuses at a load of 24 or more. Until it runs, the summary's field names rest on Squeal's `src/core/code/gate/report.ts` and `prepare.ts` types, read at `472a13730`. The gate's `report.json` in the artifact is complete whatever the summary shows.

Not run: Cezar's `npm run lint`, `ci-test-sequencer.test.cjs` (loads Vite), and any build or test of the packaged suite: the trial runs on GitHub.

## Decisions

1. **Base and change (the parent, 2026-11-12, request 14be9bbf: option A).** Local base and head commits, plus the optional `squeal_package_trial_commit` replay input. The replay of cezarion#3297 is the primary trial run. Rejected: the literal `squeal code --base origin/main` on the PR branch, which reads `not-prepared` with children off and measures no packaged function.
2. **Where the keys live (the parent, request 38e2e585: option B).** Cezar's `squeal.config.json` stays unchanged; the job adds the keys to both local commits. "The human approved a trial, not a change to every Cezar run." The keys are added to each commit's own config, so a measured commit that changed other keys keeps its change.
3. **`prepare` command (the parent agreed):** `npm --prefix ../.. run build`, 600 s. It works on old trees, so the replay of `b12aed82b` builds. No `--build-only` in `scripts/test-package.mjs`.
4. **Entry name `test:package`**, after the npm script, as `test:unit`.
5. **Budget 1200 s**, twice the default, so a slow build still leaves a report. The report has every run's time, so the result against 600 s can be read.
6. **No `needs`**: the job starts at once, beside the dispatch's own matrix.
7. **The input takes a full SHA only**, checked before any `git` command reads it.
8. **Node and dependencies of the measured tree**: the commits step runs before pnpm, Node and install.
9. **The artifact keeps the two configs the gate read** and `commits.json`, so the run can be checked without the log.

## Follow-up questions for a committed config

For a later Cezar PR that commits the two keys, after the report (the parent asked to name these):
- (a) `coverage.children: true` applies to every runner. Every Cezar daemon re-keys its coverage results once, because the coverage marker gains `children` (D12.5), and every run pays about +26% CPU per child process (D12.8). Cezar's tests start many Node children. Not checked: whether it changes the keys of the shared results that the merge-group shards publish.
- (b) Agents' pre-PR `squeal code --base origin/main` runs the packaged tests whenever a change selects one, with a full root build each time. That is the #194 fix, and its cost.
- (c) The daemon does not open the entry and notes it once (D15.6).
- (d) A `--build-only` mode in `scripts/test-package.mjs` that reuses `needsBuild` would skip a fresh build on a developer machine. Old trees lack it, so it does not suit a replay.

## Next

- 3739e45a applies the diff to a Cezar PR branch, pushes, dispatches the bare run, then the replay command above, and cites both.
- The coordinator reads the replay's summary for #194: the rows of `scripts/release.mjs` and `release.test.ts`, the `prepare` time and the gate time.
