# 020-08c: the cezar trial of `squeal code --base --parts` (draft diff)

Worker 11797a80, 2026-11-10. Brief: `brief.md`. Spec 020 D13. The diff is `cezar-ci.diff`. Nothing was pushed. Coordinator 3739e45a puts it into the one cezar PR that moves the pin to 0.1.428.

## What the diff does

The trial runs only when someone asks for it:

```sh
gh workflow run ci.yml --ref <branch> -f squeal_gate_trial=true
```

In that run, the four Vitest shards run their tests under `squeal ci record`, without their own `--coverage.enabled`. Squeal's coverage provider then writes coverage records into each shard's parts. A new job runs `squeal code --base origin/main --json --parts <the four shard folders>` on those parts and writes its findings to the job summary. Nothing gates on any of it.

The parent chose this trigger on 2026-11-10 (option A, request 27f50dc3): a new boolean input, `false` by default, that works only without `pr_number`. Every other dispatch stays as it was. That includes the bare dispatch, which proves a `ci.yml` change, and its V8 coverage artifact (cezarion#1958).

## Files

| File | Change |
|---|---|
| `.github/workflows/ci.yml` | New input `squeal_gate_trial`. Six step conditions and the record command change in the `vitest` job. One condition changes in `vitest-coverage-merge`. New job `squeal-gate-trial`. |
| `.github/scripts/ci-squeal-gate-trial.workflow.test.cjs` | New, 5 tests: the trigger; permissions and continue-on-error; the gate step with a fake `node`; the summary on fixture parts and a fixture report; the summary when there is no report. |
| `.github/scripts/ci-squeal-results.workflow.test.cjs` | The record steps run in merge groups and trial dispatches. The recorded command has no coverage flag. The new job is in `SQUEAL_JOBS`, so the "never gates a merge", "pinned actions", "same Squeal fetch" and "no expression in a script" checks cover it. It is also in the `.node-version` reader list. |
| `.github/scripts/ci-coverage.workflow.test.cjs` | A trial dispatch uploads, merges and reports no V8 coverage. A release PR dispatch with the input set keeps its coverage. |
| `docs/sdlc/ci.md` | New section "Squeal quality gate trial". One sentence each in the shard list and in "Vitest coverage artifact". This is outside the brief's list (ci.yml and tests). The PR owner can drop it, but cezar documents every CI job there. |

## Events

`T` below means `github.event_name == 'workflow_dispatch' && inputs.squeal_gate_trial == true && inputs.pr_number == ''`. With `== true`, a string `'true'` does not count, so the condition fails closed. Pull request, merge group and push runs have no `inputs`, so `T` is false for them.

| Job / step | Before | After |
|---|---|---|
| `on.workflow_dispatch.inputs.squeal_gate_trial` | — | new, boolean, default `false` |
| `vitest` / `Run server and cockpit unit suites` (`collect`) | every event except merge group | the same, except `T` |
| `vitest` / `Fetch the Squeal release` (`squeal`) | merge group | merge group or `T`. The pin and fetch script do not change. |
| `vitest` / `Run server and cockpit unit suites with Squeal recording` (`record`) | merge group | merge group or `T`. The command lost its coverage expression: it never added anything in a merge group, and in `T` it must add nothing. |
| `vitest` / `Upload Squeal parts` | merge group | merge group or `T` |
| `vitest` / `Upload shard coverage`, `Report a missing shard coverage report` | PR and dispatch | the same, except `T` |
| `vitest-coverage-merge` | PR and dispatch | the same, except `T` |
| `squeal-gate-trial` (new) | — | `T`, after `vitest` ends as `success` or `failure` |

In all of these, a merge group, a pull request, a push and a dispatch without the input run exactly as before. `squeal-export` and `squeal-publish` run only in merge groups, so they never read trial parts.

## The new job, `squeal-gate-trial` ("Squeal quality gate trial")

`needs: [vitest]`. The `if` starts with `!cancelled()`, because `pr-test-input` and `pr-test-proof` are skipped in a dispatch, and GitHub would otherwise add `success()` (cezar's rule). The job has `permissions: contents: read` and no token, `timeout-minutes: 30`, and `continue-on-error: true` at job level. Steps, each with `continue-on-error: true`:

1. **Check out the dispatched commit**: `github.sha`, depth 1, no stored credentials. This is the commit a bare dispatch's shards test.
2. **Fetch the history the gate compares**: the same command as `complexity-gate`. It fetches this commit's history and `main`, never every branch. `squeal code --base` needs the merge base.
3. **Set up pnpm**, **Set up Node.js** (`.node-version`, as in the shards: a part counts as evidence only when the environments match, D13.2), **Install pnpm dependencies**, **Build server dependencies** (the shards' tests read the built server modules).
4. **Fetch the Squeal release**: the YAML aliases `*squeal-release` and `*fetch-squeal`, so it uses the pin 3739e45a sets.
5. **Download Squeal parts**: `squeal-parts-shard-*` into `$RUNNER_TEMP/squeal-parts`, one folder for each shard.
6. **Run the Squeal quality gate on the shard parts** (`gate`): `squeal code --base origin/main --json --parts "$RUNNER_TEMP"/squeal-parts/squeal-parts-shard-*`. The step stores `report.json`, `stderr.txt`, `exit-code` and `seconds` in `$RUNNER_TEMP/squeal-gate-trial`, prints the stderr to the log, and exits 0 for every verdict.
7. **Report the trial** (`if: always()`): bash and `jq`. It writes the job summary.
8. **Upload the trial report** (`if: always()`): artifact `squeal-gate-trial`, 14 days.

## Why nothing can gate

- Only a manual dispatch with the input runs the trial. Pull requests, merge groups and pushes never run it. cezar's docs say a dispatched run does not satisfy a PR's required checks ("Diagnostic dispatch").
- `squeal-gate-trial` is outside `verify.needs`, outside every other job's `needs`, and outside `REQUIRED_QUEUE_JOBS`. The tests assert all three.
- Every step continues on error, and the gate step exits 0 whatever the verdict. Job-level `continue-on-error` covers a timeout too. So the job is green, and the run does not fail because of it.
- The shards keep their verdict. `ci record` returns the test command's exit code (018 D8), as in every merge group since 0.1.425. If the fetch fails, the shard runs the plain command with a warning. The shards are the only trial steps that can fail the run, and only through their own tests.

## How to read the summary

- **Verdict** and exit code: 0 pass, 1 violations, 3 incomplete. Then the time the gate took, which includes opening the adapters (research open question 2), the base ref, the merge base and the head.
- **Changed functions** by state, paths that could not be counted, and the budget (600 s) with whether it ran out.
- **Selected test files**, as the number taken from the parts, from the stores and run by the gate. A fresh CI checkout has no store, so "from the stores" should read 0. Then one line for each runner (vitest, node-test). node:test files always run in the gate, because `ci record` records Vitest only.
- **Recording cost** in a table, one row for each shard: parts, test files, files with a coverage record, the coverage provider (`squeal, provider N, record N`, or `off: <why>`), Squeal's own time with its process and thread count, that time as a share of the test time (the test files' durations summed over workers, 018-29's definition), and Squeal's time after the command. When a part has no cost, the row reads "not in the parts" (an older Squeal).
- Without a report, the summary gives the exit code (2 is a setup or usage error) and the last 20 lines of the gate's stderr, or says the gate did not run.

A shard's wall time is not in the summary. Compare `gh run view <id> --json jobs` for the trial run with the bare run of the same SHA. The bare run's shards add V8 coverage; the trial's shards add Squeal's provider.

## The PR

- Put the diff into 3739e45a's branch after the pin edit with `git apply --3way cezar-ci.diff`. Plain `git apply` fails there, because the `Fetch the Squeal release` hunk has the old `SQUEAL_TAG` line in its context. Applying the diff first and the pin edit second also works.
- In Verification, cite two runs (the parent's choice): one bare `gh workflow run ci.yml --ref <branch>`, which is the required proof, and one `gh workflow run ci.yml --ref <branch> -f squeal_gate_trial=true`. Both dispatches of a branch share the concurrency group `ci-CI-refs/heads/<branch>` with `cancel-in-progress`. So start the trial after the bare run ends, or one cancels the other.
- Dispatch the trial from a branch that changes code. On `main` itself the merge base is the head, so no function changes and the verdict is a trivial pass.

## Checks run

All in a scratch clone `/tmp/w11797a80/cezar` at cezar `origin/main` `1ed7d04fe` (deleted afterwards). Tests ran with `node --test` under `env -i` with a temporary HOME and git config. `node_modules` was a symlink to `~/projects/cezar/node_modules`, because a separate install was not needed for these tests.

| Check | Result |
|---|---|
| `git apply --check cezar-ci.diff` in a fresh clone at `1ed7d04fe` | clean |
| `git apply --3way` after a 0.1.428 pin edit (placeholder commit) | applies. The resulting `ci.yml` equals the trial file except for the two pin lines. |
| `node --test .github/scripts/*.workflow.test.cjs` with the diff | 184 of 184 pass (179 before plus 5 new) |
| The same in the pin-plus-trial tree | 184 of 184 pass. A first run failed because my all-digit placeholder commit read as a YAML number; with a hex placeholder it passed. |
| `check-citations.test.cjs` | pass |
| `node .github/scripts/check-citations.cjs --base HEAD^1` | "no bare issue or PR citation added" |
| actionlint 1.7.12 with shellcheck 0.11.0, cezar's pins with SHA-256 checked, `SHELLCHECK_OPTS=--severity=warning` | exit 0; `-verbose` confirms that `ci.yml` was linted |
| End to end on real Squeal output: this worktree's bundled CLI (0.1.427) ran `ci record` on a 3-file Vitest fixture, then the gate and report steps extracted verbatim from the patched `ci.yml` | "2 of 2 selected test files read from the parts", verdict pass, and the summary as designed. After one test changed: 1 from parts, 1 run. With a cost header added to the real part: the cost columns filled. |

Baseline before the change: the same workflow tests pass. `ci-test-sequencer.test.cjs` fails in the scratch clone because Vite refuses the symlinked `node_modules`. That is the environment, not the diff, and I ran it once only (it loads Vite).

## Decisions and open points

1. **Trigger**: option A, chosen by the parent (above).
2. **The record command** keeps no coverage expression, so the test now pins "the shard command without its coverage flag" and no longer "the unchanged shard command". In merge groups the command is the same as before.
3. **A trial with cancelled or skipped shards** does not run the gate. One with failed shards does: their parts still list the files, and failed checks read as `incomplete`.
4. **018-29 is not released.** The summary reads `header.cost` = `{ command, hooksMs, threads, afterMs }` and `testFiles[].durationMs`. I took these from the 018-29 worker's uncommitted tree (`e65155e2`, `src/core/ci/parts.ts` `RecordingCost`, `src/core/ci/cost.ts`). If 0.1.428 names them differently, change the `shard_filter` in "Report the trial" and the fixture in `ci-squeal-gate-trial.workflow.test.cjs`. The shard log also prints `ci record`'s own line ("Squeal's recording took …").
5. **Risk: browser tests.** The gate selects from every Vitest project Squeal lists, and cezar's `packages/web/e2e` project is one of them. A change that reaches the web sources may select e2e files. The gate then runs them with no test environment, and the verdict reads `incomplete`. If the first trial shows this, an `exclude` or `excludeProjects` in cezar's Squeal config is the next step. I did not measure it.
6. **Risk: budget.** Files that the parts do not certify run in the gate within 600 s. At `13582fdd` and `afd1b777`, the export left out 119 to 145 of about 1,626 recorded Vitest files because "inputs here are not what their shard read" (018 `research/shared-proof.md` Q2). If the gate refuses them for the same reason, they run in the job, and a change with wide reach can time out (`incomplete`, `timedOut: true`).
7. The `vitest` job's 25-minute dispatch timeout stays. The research's +22% CPU for the provider on short files is within it.

## Next

- After 0.1.428 is tagged: compare the `cost` field names with the release (item 4). Then 3739e45a applies the diff, pushes, dispatches the two runs and cites them.
- The measurement this row exists for (D13.7, research open question 1) comes from that trial run: the summary's cost table, the share of selected files from parts, and the shard times against the bare run.
