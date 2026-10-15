# 010 wave 1 review

## Verification

Candidate: `cand/010-10`, `bf0a41fbd3f6e57d55dd079f89f31d76d937fe04`.
Range: `origin/main...bf0a41fb -- .github .claude test`, with `origin/main` at `f8a9e5f754b9bf74e7fff242481e20e17a6dce13`.
Reviewed 010-10 and 010-12 against spec 010 D1 to D7 and the dated amendments.
The task checkout initially had the docs-only briefing commit `cab33a48`; before verification I created `review/010-11` at the exact candidate. No product files were edited.

```text
$ git rev-parse HEAD
bf0a41fbd3f6e57d55dd079f89f31d76d937fe04

$ npm ci
added 196 packages, and audited 197 packages in 6s
found 0 vulnerabilities
(exit 0; npm also printed deprecation and install-script policy warnings)

$ npm run lint
> biome check .
Checked 1298 files in 365ms. No fixes applied.
(exit 0)

$ npm run typecheck
> tsc --noEmit
(exit 0)

$ npm run build
> tsc -p tsconfig.build.json && npm run build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts && tsx src/harness/pi/build.ts && tsx src/harness/opencode/build.ts
(exit 0)

$ git diff --exit-code -- plugins/claude-code/dist plugins/codex/dist plugins/pi/dist plugins/opencode/dist
(no output, exit 0)
$ git status --short
(no output)

$ flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4
Test Files  636 passed | 1 skipped (637)
Tests       5351 passed | 9 skipped (5360)
Start at    19:28:20
Duration    1000.97s (tests 97%, import 2%)
(exit 0)
```

The independent run above is the review gate, not an inherited Squeal checkpoint. It started at 17:28:20 UTC (19:28:20 host local time) after about eight minutes queued. The host has 24 available CPUs. Observed one-minute load was 7.02 when requested, 5.87 shortly after starting, 52.29 at 17:36 UTC and 94.48 at 17:40 UTC. No tracked edit was made during the run.

Setup printed two fixture `gitdir incorrect` repair messages, three experimental type-testing notices and a notice that it killed one process an earlier run left. The run exited 0. No second full run or targeted rerun was made.

### Candidate CI

`gh run view 38776179771 --repo hearsay-tools/squeal --json headSha,status,conclusion,event,url,jobs` confirms a push run of the exact candidate:
<https://github.com/hearsay-tools/squeal/actions/runs/38776179771>.

Final run conclusion: **failure**. All four intended jobs ran; `version` and `nightly` were skipped as required.

| Job | Conclusion | Test step | Job time |
| --- | --- | --- | --- |
| Node 22 (1/3) | success | 385 s (6:25) | 419 s |
| Node 22 (2/3) | failure | 482 s (8:02) | 509 s |
| Node 22 (3/3) | success | 330 s (5:30) | 359 s |
| Node 24 subset | success | 65 s (1:05) | 93 s |

Job times from each completed job's `startedAt`/`completedAt` sum to **23.0 job-minutes**. All three Test steps were under nine minutes; queue time is excluded. These are measurements of this run, not a three-day cost result, and B1's repair will expand the subset.

**Proven verification failure, cause unverified:** Node 22 shard 2 failed in unchanged `test/harness/opencode-dispose.test.ts`, “serve: an abort of the new turn, then the old Stop’s answer, stores nothing”. Read via the completed job's log (`gh api repos/hearsay-tools/squeal/actions/jobs/116564290732/logs --allow-escape-sequences`):

```text
FAIL test/harness/opencode-dispose.test.ts
Error: before the new turn's request, the plugin killed the held Stop at +2295,
at or after its idle deadline (+2000)
marks, ms since the first idle: idle +0, stop +129 (pid 31448), dispose +181,
input +672, kill +2295 (pid 31448); the held Stop's deadline: +2000
attempt 1 of 3 missed its barriers: kill +2184, deadline +2000
attempt 2 of 3 missed its barriers: kill +2067, deadline +2000
Test Files  1 failed | 211 passed (212)
Tests       1 failed | 1788 passed | 2 skipped (1791)
Duration    480.90s
```

This is evidence of missed timing barriers, not an observed stale-store write. No changed product source is on that path. It is outside this review range; a workflow-induced defect or a flake is not established. The coordinator still needs to resolve or name the red CI result under the landing policy. No GitHub rerun or other write was made.

## Verdict

**FAIL bf0a41fbd3f6e57d55dd079f89f31d76d937fe04**. One proven blocker, one plausible should-fix and one plausible nit. The blocker is the selection contract in amended D4, not an observed Node 24 product failure.

## Blockers

### B1. Proven: the Node 24 list omits real node:test suites required by D4

Location: `test/version-sensitive.txt:35-42`, consumed by `.github/workflows/ci.yml:80`.

D4 explicitly includes “every other test that runs a real `node --test` (integration, the slow tier, e2e)”. Its rationale is the Node 22/24 identity difference. The selected paths cover only some real node:test callers. At least these 14 files execute real `node --test` but are absent from the Node 24 selection:

| Files under `test/` | Evidence of the real runner |
| --- | --- |
| `scheduler/preload-heal.test.ts` | Creates `createNodeTestAdapter` at line 67, delegates `adapter.run` at line 83, then starts both schedulers. |
| `scheduler/preload-refresh.test.ts` | Uses `preload-worktrees.ts`'s real adapter and starts its scheduler baseline. |
| `scheduler/observed-growth.test.ts` | Uses `preload-worktrees.ts`'s `open`, which creates the real adapter and delegates runs. |
| `scheduler/environment-growth.test.ts` | Creates the adapter at line 100 and delegates runs at line 113. |
| `scheduler/environment-growth-wait.test.ts` | Creates the adapter at line 80 and awaits its real report at line 106. |
| `scheduler/environment-growth-siblings.test.ts` | Creates the adapter at line 92 and delegates runs at line 107. |
| `scheduler/environment-growth-same-revision.test.ts` | Creates the adapter at line 89 and delegates runs at line 109. |
| `scheduler/capacity-pool.test.ts` | Gives `openHarness` a real node:test project at line 69 and checks its stored pass. |
| `scheduler/scratch-inputs.test.ts` | The node:test scratch test supplies a real project at line 163. |
| `scheduler/lanes.test.ts` | Supplies a real project at line 105 and tests concurrent stored node:test results. |
| `scheduler/idle-pass.test.ts` | Creates the adapter at line 111 and asserts the baseline called `node-test.run`. |
| `integration/slow-spawn.test.ts` | Starts a daemon with a real slow node:test project at line 59 and waits for its results. |
| `integration/capacity-project.test.ts` | Starts a daemon with real held `node:test` files and checks the running tier's capacity mark. |
| `evals/atomic-scenarios.test.ts` | Directly executes Node with `--test --test-reporter=tap` at line 80, then parses its TAP failures for each fixture scenario. |

`src/runners/node-test/run/run.ts:69-110` is the adapter execution path: it spawns the project Node with `--test` and the shipped reporter. The atomic scenario test runs Node directly. These are real executions, not mock projects or shell-command parsing fixtures.

Discriminating check, with no test execution:

```text
$ npx vitest list --filesOnly $(grep -Ev '^[[:space:]]*(#|$)' test/version-sensitive.txt)
```

The command listed 44 test file paths.

The actual Vitest listing includes none of the 14 paths above. I compared that output with the paths, rather than relying only on the guard's filter simulation. The guard at `test/version-sensitive.test.ts:61` checks direct version reads; those suites need no such read to exercise Node-dependent runner behavior. Its passing result therefore cannot rule out this omission. The nightly eventually exercises them, but D4/G4 require the version-sensitive coverage per candidate and landing too.

Repair sized for one worker: add the missing real node:test callers to `test/version-sensitive.txt`, audit the remaining real adapter/daemon/harness callers for the same omission, and protect that coverage in the guard. Also provision the prerequisites of the resulting subset in `node24`: `scheduler/idle-pass.test.ts` uses `pytestRepos`, calls `uvSync`, and runs pytest alongside node:test. The current comment at `.github/workflows/ci.yml:63` (“None of them needs uv or Python”) will no longer hold. Reuse the existing uv/Python setup or otherwise ensure those tests run rather than skip. Do not add only a path and leave its pytest branch unexecuted.

Done when the actual Vitest listing includes the audited real-runner suites, the guard rejects their omission, and the expanded subset passes on Node 24 with its required tools. Keep the existing direct-version-read and stale-entry guards.

## Should-fix

### S1. Plausible: candidate CI confirmation can accept an earlier run on the same branch

Location: `.claude/skills/coordinator/SKILL.md:50`.

D6 says to confirm the candidate's run. `gh run list --branch cand/<version> --limit 1` does not constrain the SHA or workflow. If queried before the new push's run appears, an older run can satisfy that instruction and suppress the fallback. This is a plausible timing gap; it was not reproduced with a GitHub write and does not block. The command is the one D6 proposed, so this is also an input to improving that instruction.

Small fix: include `--workflow ci.yml --commit <pushed-sha>` and verify the returned head SHA, allowing the run to appear before dispatching. `gh run list --help` confirms both filters exist. Keep the already-demonstrated same-SHA new-branch fallback.

## Nits

### N1. Plausible: drop `plugin-copy` from the Node 24 subset after amending D4

Location: `test/version-sensitive.txt:47-49`.

`test/e2e/plugin-copy.test.ts` tests copying tracked worktree bytes, modes and deletions through Git and filesystem helpers. It does not install a fixture, read a Node version or take a known Node-specific branch. There is no evidence here that its second version draw protects the behaviors D4 names. I recommend removing this entry with a matching spec amendment; it remains in Node 22 and the nightly full suite. Keeping this inexpensive extra file is harmless and conforms to the current explicit D4 list. No defect is claimed.

## What fits

- **Proven, D1/D2:** `push.branches` restricts automatic pushes to `main` and `cand/**`, excluding tags; the ordered `paths` list excludes docs and re-includes probe paths on pushes and pull requests. `workflow_dispatch` is present. GitHub's workflow-syntax docs confirm both branch and path filters must match and later positive patterns re-include paths.
- **Proven, D3:** the exact group is `${{ github.workflow }}-${{ github.ref == 'refs/heads/main' && github.run_id || github.ref }}`; cancellation is `${{ github.ref != 'refs/heads/main' }}`. Main pushes, main dispatches and nightlies each get a separate run-ID group, avoiding pending-run replacement as well as active cancellation. Candidates and pull-request merge refs group by ref. The three shards have `fail-fast: false`.
- **Proven, D4 guard semantics for the current entries:** installed Vitest 5.0.3's `filterFiles` uses case-insensitive path substrings, with additional relative/absolute handling unnecessary for these repository-relative entries. The real listing selects 44 files, consistent with the guard's model. Existing direct version reads are selected; the helper/header exception is explicitly accepted in `status.md`.
- **Proven, D5:** three Node 22 shards cover the full suite. Lint and typecheck occur once in the Node 24 job; build and bundle checks occur in Node 22 shard 1 and Node 24. No aggregation job is needed for this process.
- **Proven, version ranges:** `version` runs only on pull requests and main pushes. It keeps the existing base-SHA/main-`before` comparison and full checkout; neither dispatch nor schedule can pass an empty `before` into it.
- **Proven, D6:** the coordinator text describes docs skips, dispatch fallback and the nightly's landing block. `.agents/skills/coordinator` is the same symlinked skill.
- **Proven, D7 configuration:** cron is `23 3 * * *`. Only `nightly` accepts `schedule`; the shard, subset and version jobs reject it. The nightly installs Node 24, uv and both Pythons and executes the full suite. `gh repo view --json defaultBranchRef` confirms the default branch is `main`. GitHub's schedule docs say scheduled workflows use the latest default-branch commit and cannot run from a candidate. Actual scheduled execution remains unverified until landing.

Official docs read on 2026-10-15:

- <https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax> (paths, branch filters, concurrency).
- <https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule> (default branch, UTC cron, possible delay/drop under load).

## Inputs for the next wave

- Repair B1 in the list, its guard and the Node 24 prerequisites. No source, bundle or version change is needed. Re-review that delta against B1 and read its candidate CI result.
- **Unverified:** the candidate's docs-only follow-up push, the first main landing's `version` range and the first actual nightly. The reviewer was read-only on GitHub and did not run those probes. The coordinator owns those Testing steps; the same-SHA new-branch probe already recorded in `status.md` explains why dispatch fallback remains necessary.
- **Proven for this run:** G3's per-shard Test target and about-25-job-minute cost have the measurements above (maximum 482 s; 23.0 job-minutes). Re-measure after B1 expands the subset. **Unverified:** the three-day G5/queue/candidate-coverage/main-cancellation result, which remains row 010-20.
- S1 can be a small coordinator-instruction repair. N1 requires a spec amendment if accepted. No unrelated product cleanup is requested.
