# 020-26c: the cezar proof of records beside the project's V8 coverage (draft diff)

Worker c1ad4425, 2026-11-12. Brief: `brief.md`. Spec 020 D19 (D19.7: "The Cezar proof (020-26c) runs a second provider-only run as the control"). The diff is `cezar-ci.diff`. Nothing was pushed. Coordinator 3739e45a puts it into the cezar PR.

## Base

The diff is against cezar commit `0d738684f74061a63f732f16a2220e788cbe5589` (branch `squeal-ci-action`, parent `249c8783b`), not cezar `origin/main`. The coordinator changed the base during the work (agreed with 3739e45a). That commit replaces every "Fetch the Squeal release" step with "Set up Squeal" (`uses: hearsay-tools/squeal/ci@v0`) and calls plain `squeal`. The new job does the same: no `SQUEAL_TAG`, no `SQUEAL_COMMIT`, no pin edit.

`0d738684f` itself does not cherry-pick cleanly onto current cezar main `42c28fa2a` (conflicts in `ci.yml`, `ci-squeal-results.workflow.test.cjs` and `docs/sdlc/ci.md`). So it is not tested whether this diff applies after that rebase. Its hunks touch only: the `workflow_dispatch.inputs` block after `squeal_gate_trial`; the place after the `squeal-gate-trial` job's last step; three lines of `ci-squeal-results.workflow.test.cjs`; and `docs/sdlc/ci.md` after the "Squeal quality gate trial" section.

## What the diff does

The proof runs only when someone asks for it:

```sh
gh workflow run ci.yml --ref <branch> -f squeal_coverage_proof=true
```

In that run, Vitest shard 1/4 runs three more times, in parallel, on the dispatched commit. Each run uses `npm test -- --shard=1/4 --maxWorkers=4 --coverage.enabled`, which is the shard command of a dispatch, with the same `VITEST_FILE_DURATION_CAP=1`:

- (a) `squeal`: under `squeal ci record`. Squeal 0.1.443 reads the project's V8 provider's payloads into its parts (D19.1).
- (b) `v8`: the command alone.
- (c) `v8-control`: the command alone again, the run-to-run control.

Each run uploads its `coverage-final.json`, its times and, for (a), its parts. A compare job then writes a job summary and uploads the comparison as JSON. Nothing gates on any of it. The rest of the dispatch runs as a bare dispatch does, including the four shards and their V8 coverage artifact.

## Files

| File | Change |
|---|---|
| `.github/workflows/ci.yml` | New input `squeal_coverage_proof`. New jobs `squeal-coverage-proof` (a matrix of three runs) and `squeal-coverage-proof-compare`. No existing job or step changes. |
| `.github/scripts/squeal-coverage-proof.cjs` | New, 240 lines: the comparison. It reads the three downloaded artifacts, prints Markdown and writes `comparison.json`. It exits 0 for every input. |
| `.github/scripts/squeal-coverage-proof.test.cjs` | New, 4 tests: statements compared by location relative to each run's checkout; the parts summary (records, reasons, collector, `node:inspector`, cost counted once per command); the full summary and JSON; missing runs, reports and parts. |
| `.github/scripts/ci-squeal-coverage-proof.workflow.test.cjs` | New, 7 tests: the input and its only readers; both `if` conditions over every event; the matrix, permissions, `continue-on-error` and checkout; artifact names against every download pattern in `ci.yml`; the run step with a fake `npm` and `squeal` (the command equals the dispatch shard command, the exit code, report, parts and times are kept, the step exits 0); a run without a report; the compare step with the real script and with a `node` that fails. |
| `.github/scripts/ci-squeal-results.workflow.test.cjs` | The new jobs join three lists: the `.node-version` readers (`squeal-coverage-proof`), the users of Squeal's action (`squeal-coverage-proof`), and `SQUEAL_JOBS` (both). So "never gates a merge", "pinned actions" and "no expression in a script" cover them. |
| `docs/sdlc/ci.md` | New section "Squeal coverage proof" after "Squeal quality gate trial". This is outside the brief's list (ci.yml, tests, scripts). The PR owner can drop it, but cezar documents every CI job there. |

## Input, jobs and steps

`P` below means `github.event_name == 'workflow_dispatch' && inputs.squeal_coverage_proof == true && inputs.pr_number == ''`. With `== true`, a string `'true'` does not count. Pull request, merge group and push runs have no `inputs`, so `P` is false for them. A dispatch with `pr_number` (a release PR) takes no proof, as with the gate trial (020-08c, option A).

| Added | Runs on | Notes |
|---|---|---|
| `on.workflow_dispatch.inputs.squeal_coverage_proof` | | boolean, default `false` |
| job `squeal-coverage-proof`, "Squeal coverage proof `<run>`" | `P` | matrix `run: [squeal, v8, v8-control]`, `fail-fast: false`; no `needs`, so it starts at once; `timeout-minutes: 30`; job-level `continue-on-error: true`; `permissions: contents: read` |
| 1. Check out the dispatched commit | | `github.sha`, no stored credentials |
| 2. Set up pnpm | | 12.11.2, as the shards |
| 3. Set up Node.js | | `.node-version`, as the shards |
| 4. Install pnpm dependencies | | `pnpm install --frozen-lockfile` |
| 5. Build server dependencies | | `npm run build:server`; the unit fixtures read the built server modules |
| 6. Set up Squeal | `matrix.run == 'squeal'` | `hearsay-tools/squeal/ci@v0`, after Node, as in every Squeal job |
| 7. Run Vitest shard 1/4 with V8 coverage (`shard`) | | see below |
| 8. Upload the proof run | `always()` | artifact `squeal-coverage-proof-<run>`, 14 days |
| job `squeal-coverage-proof-compare`, "Compare the Squeal coverage proof" | `!cancelled() && P && needs.squeal-coverage-proof.result != 'skipped'` | `needs: [squeal-coverage-proof]`; `timeout-minutes: 10`; job-level `continue-on-error: true`; `permissions: contents: read` |
| 1. Check out the comparison script | | `github.sha`, sparse `.github/scripts`, no stored credentials |
| 2. Set up Node.js | | `lts/*`, as `vitest-coverage-merge`; the script needs no package |
| 3. Download the proof runs | | pattern `squeal-coverage-proof-*` into `$RUNNER_TEMP/squeal-coverage-proof` |
| 4. Compare the proof runs | `always()` | `node .github/scripts/squeal-coverage-proof.cjs --input … --json …/comparison.json >> $GITHUB_STEP_SUMMARY` |
| 5. Upload the comparison | `always()` | artifact `squeal-coverage-comparison`, 14 days |

Every step of both jobs sets `continue-on-error: true`.

The compare job's `if` starts with the status function `!cancelled()`. Without it GitHub adds `success()`, and one run that failed or timed out would skip the comparison of the other two (cezar's rule). It runs after the three runs end in any way except skipped, and not in a cancelled workflow run.

### The run step

1. Sets the command to `npm test -- --shard=1/4 --maxWorkers=4 --coverage.enabled`. In the `squeal` run it becomes `squeal ci record --out "$RUNNER_TEMP/squeal-coverage-proof/parts" -- <that command>`.
2. Times it with Bash's `time` keyword (`TIMEFORMAT='%3R %3U %3S'`). That gives the wall time and the user and sys CPU time of the command and of every process it waited for, Vitest's child processes included (checked: a grandchild's busy loop counted in full). The command's stderr still goes to the log.
3. Copies `.ai/qa/coverage/coverage-final.json`, or warns that there is no report.
4. Writes `run.json` (`format: "squeal-coverage-proof-run/1"`): `run`, `command`, `exitCode`, `wallSeconds`, `userSeconds`, `sysSeconds`, `root` (`$GITHUB_WORKSPACE`), `cpus`, `cpuModel`, `loadBefore`, `loadAfter`. The raw `time.txt` stays beside it.
5. Exits 0. The test verdict is in `exitCode` and in the summary, not in the job's colour.

The artifact `squeal-coverage-proof-<run>` holds `run.json`, `time.txt`, `coverage-final.json` and, for `squeal`, `parts/squeal-part-*.json`.

## Why nothing can gate

- Only a manual dispatch with the input runs the proof. Pull requests, merge groups and pushes never run it. cezar's docs say a dispatched run does not satisfy a PR's required checks ("Diagnostic dispatch").
- Both jobs are outside `verify.needs`, outside every other job's `needs`, and outside `REQUIRED_QUEUE_JOBS`. `ci-squeal-results.workflow.test.cjs` asserts all three through `SQUEAL_JOBS`. A mutation that put the compare job in `verify.needs` failed "the Squeal jobs never gate a merge".
- Every step continues on error, the run step exits 0 whatever the tests do, and the comparison script exits 0 for every input. Job-level `continue-on-error` covers a timeout too.
- Only the two new jobs read `squeal_coverage_proof` (a test asserts it). The four shards, the coverage merge, the gate trial and the Squeal export run as in any dispatch, and the proof's artifact names match none of their download patterns (`vitest-coverage-shard-*`, `squeal-parts-shard-*`, `squeal-results`). The comparison's own artifact does not match `squeal-coverage-proof-*`, so a rerun of the compare job does not read it.

## How to read the summary

The compare job's summary has three parts.

**Covered statements.** One row for (a) against (b), one for (b) against (c). A statement is covered when its count is above 0. Statements are matched by source location (`line:column-line:column`), and files by path relative to each run's checkout, so different ids or runner paths do not count as differences.
- "Covered state differs": the statements covered in one run and not the other, with the share of the statements compared, then each direction.
- "Files that differ", "Files in one report only", "Statements in one map only": a file or statement map that differs means the reports are not of the same code. Expect 0.
- Below the table, up to 20 differing files per pair, with "only in the first / only in the second" counts. `comparison.json` lists all.
- Reading: the (b)-against-(c) row is the run-to-run noise. A difference between (a) and (b) is Squeal's only if it is clearly above that row. The research saw 14 of 97,234 statements (10 files, all process, timer and server code) differ between a tee run and a V8-only run, with no control (`research/ci-coverage-both.md` Q5). This row is that control.

**Squeal's records in (a)'s parts.**
- Parts, their format, Squeal and Vitest versions, and how the run ended.
- The coverage header: `collector` (expected `v8`, with `@vitest/coverage-v8` 4.1.10, cezar's version), provider and record versions, any note. `off: project-coverage (<note>)` means Squeal yielded (D19.2), for example a Squeal behind `v0` older than 0.1.443 or an untested Vitest version.
- Test files in the parts, how many have a record, and the reasons for the rest (`inspector`, `filtered`, `not-whole`, `isolate-false`, `child-process`, `unmapped`; "none named" when the part gives none).
- `node:inspector`: the test files whose worker loaded it (`inspector.loaded`) and those no watched worker saw (`inspector.unknown`), up to 20 each.

**Time.** One row per run: exit code, wall, CPU (user + sys), CPUs, CPU model and load before and after. Then (a) against (b) and (c) against (b), in seconds and percent. Then Squeal's own time from (a)'s parts (018-29's `cost`): time in its hooks over its processes and threads, as a share of the test files' summed durations, and its time after the command.
- The three runs run on three runners. Compare the CPU model column first: when it differs, the time differences mix hardware with Squeal's cost. Squeal's own time from the parts does not depend on that.
- One dispatch gives one pair of each. For a spread, dispatch more than once and read each summary.

## The PR

- Apply `cezar-ci.diff` on the PR branch: `git apply cezar-ci.diff` at `0d738684f`. After a rebase onto main, use `git apply --3way` and check the four places named under "Base".
- In Verification, cite the bare `gh workflow run ci.yml --ref <branch>` (cezar's required proof of a `ci.yml` change). Start the proof dispatch only after that run ends: both dispatches of a branch share the concurrency group `ci-CI-refs/heads/<branch>` with `cancel-in-progress`, so one would cancel the other.
- The proof needs a Squeal of 0.1.443 or later behind `hearsay-tools/squeal/ci@v0`. The summary's parts line names the version it got.
- Cost per proof dispatch: the dispatch's own full matrix plus three `ubuntu-24.04` runners for one shard each, with install and server build. The research's shard 1/4 took 687 to 824 s of wall time on this host (`research/ci-coverage-both.md` Q5); GitHub's runners differ.

## Checks run

All in scratch clones under `/tmp/w020-26c/` of `/home/agent/projects/squeal/.ai/cezar/t/3739e45a/cezar-pr` at `0d738684f` (nothing run in that path itself; deleted afterwards). Tests ran with `node --test` under `env -i` with a temporary HOME, TMPDIR and git config. `node_modules` was a symlink to `~/projects/cezar/node_modules`, so cezar's `scripts/test-home-env.mjs` (which refuses a symlinked `node_modules`) was not loaded; its git settings were set by hand. No Vitest shard ran locally.

| Check | Result |
|---|---|
| Workflow tests at the base, before the change: `node --test .github/scripts/*.workflow.test.cjs` | 185 of 185 pass |
| actionlint 1.7.12 with shellcheck 0.11.0 (cezar's pins, SHA-256 checked), `SHELLCHECK_OPTS=--severity=warning`, at the base | exit 0 |
| `git apply --check cezar-ci.diff`, then `git apply`, in a fresh clone at `0d738684f` | clean |
| `node --test .github/scripts/*.workflow.test.cjs .github/scripts/squeal-coverage-proof.test.cjs` in that tree | 196 of 196 pass (185 plus 7 plus 4) |
| actionlint, same settings, in that tree | exit 0. With every shellcheck level, the only notes are the three SC2016 infos the base has too (on two existing steps), none on the new steps. |
| Mutation: the compare job added to `verify.needs` | "the Squeal jobs never gate a merge" fails, as it should; reverted |
| `node .github/scripts/check-citations.cjs --base HEAD^1` | "no bare issue or PR citation added" |
| `complexity-gate.mjs --base HEAD^1 --head HEAD` | "Checked 109 changed functions in 4 files: none over 20 is new or more complex" |
| `check-clones.cjs --base HEAD^1 --head HEAD` | "Clone pairs: 53; violations: 0" |
| The run step's first draft, through its test | failed: `jq --args` read `--out` in the command as its own option. Fixed by passing the command as a JSON array. |
| End to end on real Squeal output: this worktree's bundled CLI (0.1.443) and Vitest 5.0.3 with `@vitest/coverage-v8` 5.0.3 on a 3-file fixture (one test file imports `node:inspector`). The run step and the compare step were extracted verbatim from the patched `ci.yml` and run three times, then on the three artifacts. | All three steps exit 0. Part header: `collector: "v8"`, `collectorVersion: "5.0.3"`, `inspector.loaded: [test/inspector.test.ts]`, `cost` present. Summary: 0 of 4 statements differ in both pairs; records 2 of 3, without 1 (`inspector 1`); Squeal's share 47.8%, the same figure `ci record` printed. |

Not run: cezar's `npm run lint` (oxlint and its own rules need a real install), `ci-test-sequencer.test.cjs` (loads Vite, which refuses the symlinked `node_modules`, as 020-08c found), and a fixture on Vitest 4.1.10. cezar's 4.1.10 is in `~/projects/cezar/node_modules`, and a fixture linked there would write Vitest's cache under `~/projects/cezar`. The fixture's Vitest cache in this worktree's `node_modules/.vite` was removed afterwards.

## Decisions and open points

1. **Trigger**: a new boolean input that works only without `pr_number`, the same rule the parent chose for the gate trial (020-08c, option A).
2. **One matrix job** with three runs, not three jobs: one definition, so the three cannot drift apart. Run names `squeal`, `v8`, `v8-control` are the brief's (a), (b), (c).
3. **No `needs`** for the runs: they start at once, beside the dispatch's own matrix, and do not wait for preflight. A failed preflight does not stop the proof.
4. **The runs never fail their job.** The run step keeps the exit code in `run.json` and exits 0; the summary shows it. This follows the gate trial. A failing test in a run shows in the summary only, and in the dispatch's own shard 1/4.
5. **Same environment as the shard**, including `VITEST_FILE_DURATION_CAP=1`. Its reporter fails a file at 60 s, in all three runs alike.
6. **A script, not inline jq**, for the comparison: statement matching by location is too long for a `run:` block, and a script has a unit test. It uses only Node built-ins, so the compare job installs nothing.
7. **The compare job runs after any result except skipped.** A run that timed out still leaves the other two to compare.
8. **The summary also names** the Squeal and Vitest versions, the CPU model, CPU count and load of each runner. These were not in the brief; they make a time difference readable.
9. **Risk: hardware.** The three runs are on three runners, possibly with different CPUs. The summary shows the models; the control pair shows the size of the noise for one dispatch only.
10. **Risk: browser and `isolate`.** None of cezar's unit project configs sets `isolate`, so `isolate-false` should not appear. `packages/web` runs in a DOM environment, not browser mode, so its files should get records. Not measured.
11. **Not in scope**: whether (a)'s records equal those of Squeal's own provider. The research checked that on a fixture (Q1.5); this proof checks the report, the records' count and the cost on a real shard.

## Next

- 3739e45a rebases `squeal-ci-action` onto cezar main, applies the diff (`--3way` if the context moved), pushes, dispatches the bare run, then the proof run, and cites both.
- The measurements D19.7 and the research's open question 5 wait for come from that proof run's summary: the (a)-against-(b) row beside the (b)-against-(c) row, the share of test files with a record, and Squeal's own time. The tolerance between two reports of the same run is then a decision for spec 020.
