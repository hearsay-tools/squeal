# tiered-pre-pr: cheap checks on edit, heavy tests on demand or before a PR

Researcher task 65b4575c for spec 026, 2026-11-23, 22:35Z to 23:00Z. Brief: `README.md`, "Topic: tiered-pre-pr". Source read at `1bbd7b4c5` (Squeal 0.1.611); the fixture ran the worktree's committed plugin build, 0.1.611. Data: read-only copies (`VACUUM INTO` under `$TMPDIR`) of `~/projects/squeal/.git/squeal/store.sqlite` and `~/projects/cezar/.git/squeal/store.sqlite`, taken 22:46Z and deleted after use, with each run's `report.json` read in place; git history of both repositories; `ps` of live daemons at 22:47Z. One-minute load during the fixture runs: 3.5 to 12.6. Durations from the stores are the daemons' own records under this host's load. Probes: `probes/tiered-pre-pr/` (throwaway, README there).

**Verdict.** Today's `checks` key already expresses "cheap on edit, heavy on demand": test groups at `manual` or `stop`, an oxlint group at `edit`, complexity on. It does not make the daemon cheap. The Vitest host that keys tests (0.5 to 0.6 GB per Squeal worktree, 1.1 GB per cezar worktree, live) starts at daemon start and reopens on every edit, a README edit included, whatever the moments say. The pre-PR side has a second, larger problem: a run that makes every re-keyed file current is close to a full suite on both repositories, because static closures are wide. A Squeal release range re-keys a median 1,512 test files (90% of the suite's file-seconds); a cezar PR re-keys a median 819 of about 2,000 files even with CI imports (74%). Today's live daemons spend about two-thirds of a full suite per worktree, so a closure-complete pre-PR run saves no CPU. Only a narrow pre-PR run (the branch's changed test files and namesakes, 1 to 3% of the suite) is cheap, and no command selects it from a base ref today.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | All test groups off `edit` | The Vitest keying host still starts at daemon start and on every edit (seven paths, all independent of `at`). Complexity and oxlint work on edit with no runner host. Hook latency unchanged: 98 to 134 ms in both policies | verified by experiment; read in source code |
| 2 | Churn vs branch delta | Squeal: 52% of 317.5 local file-hours in 7.9 days ran at intermediate keys, 46% at the final key. cezar: 39% and 58% of 291.8. A closure-complete pre-PR run is 38% (one commit, p50) to 90% (a release range, p50) of Squeal's suite and 74% (one merged PR, p50, CI imports applied) of cezar's. A narrow run is 0.05% to 1.3% | verified by experiment (store copies) |
| 3 | Pre-PR commands and gaps | `run <group> --wait` is closure-complete; `run <group> <paths>` is narrow but needs the agent to list paths; `code --base` is closure-complete, JS/TS-only, runs no `manual` group by default and so hides a broken test; imports carry no coverage; a macOS laptop imports nothing from Linux CI | verified by experiment (fixture); read in source code and specs; inferred (macOS) |
| 4 | Value lost without edit-time push | Not measured directly. A replay put about 4 failures a day a median 2.5 to 3 min later (p95 12 to 18 min) when a Stop check and the agent's own asks remain. Lint and complexity catch a different class: 70% of Squeal's edit failures are in tests that bundle, read or spawn code | read in this repository's research (verified there by replay and transcripts); inferred |
| 5 | Product shape | Keep `checks` as the policy. Three fixes: moment-aware runner keying, a narrow pre-PR selection from a base ref, and a `code --base` scope that does not hide `manual` test failures | inferred |

## Q1. What runs when no test group is at `edit`

**Experiment** (`run.sh`, logs `run-manual.log` and `run-edit.log`). Fixture: 12 Vitest files, a `unit` group at `manual` (variant `edit` for comparison), `{ "name": "lint", "lint": ["oxlint"], "at": "edit" }`, `complexity.threshold` 3, `shared.ref` `refs/squeal`, `runner.hostIdleMinutes` 1. `verified by experiment`.

| Step | `manual` processes (RSS) | `edit` processes (RSS) |
|---|---|---|
| After start, before any edit | daemon 172 MB, `runner-host --runner vitest` 165 MB, store process 105 MB | the same: 173, 165, 107 MB |
| 1 s after an edit to `src/m1.js` | the same three, 446 MB | plus a second `runner-host` 167 MB and a test worker 76 MB: 693 MB |
| `squeal run unit src/m1.js --wait` | +1 lane `runner-host` 173 MB; 1,320 ms | 340 ms (the file had run on edit) |
| 80 s idle after the group run | daemon and store only, 267 MB (host closed) | 271 MB |
| After an edit to `README.md` only | `runner-host` back, 161 MB | back, 157 MB |

- The `manual` policy ran no test between edits. It reported the oxlint finding and the complexity crossing in the next PostToolBatch hook: `FAIL complexity: classify (src/complex.js:1) is 6, over 3` and `FAIL lint: src/m1.js (oxlint): 1 finding`. The same hook said "no test group runs after each edit, so silence between edits is not a pass". The edit had broken `test/m1.test.ts`; only the narrow run found it.
- PostToolBatch latency: 98 to 126 ms (`manual`, load 3.5 to 7.0) and 107 to 134 ms (`edit`, load 7.5 to 11.1) over 7 edits each. No difference.

**Source** (`read in source code`, 0.1.611). The daemon's runner is a recovering adapter that creates the Vitest instance on the first keying call (`src/core/daemon/runner.ts`). Under `squeal daemon` it lives in a `runner-host` process (`src/core/runner-host/vitest-host.ts`). Its graph comes from a live Vitest: `createVitest` (`src/runners/vitest/adapter.ts:253`), `importClosure` (:544), `globTestSpecifications` (:585). Paths that start or reopen it, none reading a group's `at`:

1. Daemon start: `baseline` calls `readEnvironments` and `listTestFilesOf` (`src/core/scheduler/bootstrap.ts:135-136`), and closures for files without one.
2. Every content revision: `fetchRunnerPart` calls `runner.invalidate` (`src/core/scheduler/refinement.ts:119`), then `environment` (:129), `affected` (:166, unless the stored graph answers) and `closure` (:177). A path no test reads still makes a revision.
3. Touched files whose bytes did not change (`queueTouched`).
4. Observed-path growth from another worktree (`queueObserved`).
5. A CI import that names files: the import itself re-keys from committed blobs with no runner, then `queueObserved` (`src/core/scheduler/imports-waiting.ts:81-92`) wakes the host; with no host yet, every project is re-keyed.
6. The once-per-version import re-walk when idle (`import-rewalk.ts`).
7. `run --all`, `squeal run <group>` and Stop's request, which also open a lane instance (closed 60 s after its last tier, `SLOW_RELEASE_MS`, `src/core/scheduler/slow-release.ts:9`).

The keying host closes after `runner.hostIdleMinutes`; the default is `min(10, max(2, round(totalmem / 8 GiB)))` (`src/core/daemon/host-idle.ts:24`): 8 min on this 62 GiB host. An agent that edits more often than that keeps it up all session. This worktree's daemon, where only files under `docs/` changed, held a 602 MB Vitest host at 22:47Z, 641 s after the host started, past the 8 min idle close.

**Live sizes** (`ps`, 22:47Z, `verified by experiment`): Squeal worktrees' Vitest keying hosts 527, 583 and 602 MB; their daemons 351 to 386 MB. One cezar worktree: Vitest host 1,142 MB, a second Vitest instance 491 MB, two node:test hosts 104 and 126 MB, daemon 627 MB. One store process per repository: 208 to 216 MB.

Complexity and lint use no runner (`src/core/code/`, `src/core/lint/provider/oxlint/spawn.ts`); `read in source code`. There is no Biome lint provider: `lint.tools` accepts `eslint` and `oxlint` only (`src/core/daemon/policy-lint.ts:19`).

## Q2. Churn during a session against the branch delta

**Local churn** (`churn.mjs`, `churn-out.txt`), 2026-11-16 00:00Z to 2026-11-23 22:45Z. For each (worktree, test file), the last run is "final"; an earlier run at another key is "intermediate"; an earlier run at the final key, or whose key a later run at the same key replaced, is "repeat". File-seconds are `report.json` `fileDurations` summed. `verified by experiment`.

| Store | Worktrees (> 60 file-s) | File-hours | Final | Intermediate | Repeat | Per worktree file-s p50 / mean | Churn share per worktree p50 / p75 |
|---|---|---|---|---|---|---|---|
| squeal | 220 | 317.5 | 46.0% | 52.3% | 1.7% | 1,720 / 5,193 | 8% / 25% |
| cezar | 239 | 291.8 | 58.4% | 39.4% | 2.2% | 2,236 / 4,393 | 17% / 42% |

Churn is concentrated in long sessions: half the worktrees spend under 8% (squeal) or 17% (cezar) on intermediate runs. "Final" also holds files re-keyed by rebases onto main, which a CI import could settle; the stores do not separate the two. cezar: 9,708 of 55,496 runs have no `report.json` left, so its figures are low by up to that share.

**Branch delta.** cezar has a CI import for nearly every main commit (`imports`, `import_files`; 295 imports). For the last 30 consecutive imported commits (2026-11-22 22:06Z to 2026-11-23 22:23Z), `delta.mjs` (`delta-cezar.txt`) counts a file as settled when its key equals the previous commit's import. Squeal has no CI export (`refs/squeal` holds no ref), so `closure-delta.mjs` (`closure-delta-squeal.txt`) counts files whose stored closure list (`test_files.closure_paths`: static imports plus declared inputs) holds a changed path. A "narrow" run is the changed test files plus namesakes of changed sources; it leaves out direct importers, so it is a lower bound of 019 D6's narrow run. Durations are each file's median local file time in the window. `verified by experiment`.

| Sample | Must run, files p50 / p90 | Must run, file-s p50 / p90 | Full suite file-s | Narrow, files / file-s p50 |
|---|---|---|---|---|
| cezar, 30 merged PRs, CI imports applied | 819 / 1,367 | 4,864 / 6,099 | 6,593 | not computed |
| squeal, 30 product commits on main | 311 / 1,289 | 2,964 / 6,526 | 7,843 | 2 / 4 |
| squeal, 15 release-to-release ranges | 1,512 / 1,733 | 7,005 / 7,323 | 7,817 | 37 / 99 |

- Wide closures cause this. In cezar, a 2-path commit (`f83a3eb92`, one source and its test) changed the keys of 786 `server` files with the same closure list and environment. In Squeal, one type-only file, `src/core/types/store.ts` (`50cb64b4f`), re-keys 1,700 test files.
- An environment change re-keys a whole project: 2 of 30 cezar pairs changed every project's environment (1,811 and 1,960 files must run); 4 more changed `server`'s.
- Wall time is file-seconds divided by the workers that run them; at 8 workers, cezar's p50 must-run set is about 10 min and Squeal's release range about 15 min (`inferred`).

**Comparison.** A closure-complete pre-PR run costs 4,864 (cezar) to 7,005 (Squeal) file-seconds per PR at the median. Today's live daemons spend a mean of 4,393 and 5,193 file-seconds per worktree, intermediate runs included. Moving tests from edit to a closure-complete pre-PR run therefore saves no CPU on these repositories and adds a 10 to 15 min wait before each PR. A narrow pre-PR run costs 4 to 99 file-seconds, under 2% of today's spend, and leaves the rest to CI, which runs the full suite anyway (`inferred`).

## Q3. Pre-PR commands today and their gaps

- **`squeal run <group> --wait`** runs every file of the group that is not current (019 D6): the closure-complete set above. CI imports make untouched files current only when the environment matches (018 D10: platform, arch and the full Node version must be equal; `src/core/keys/environment.ts:45-47`). `read in source code`.
- **`squeal run <group> <path>... --wait`** is narrow (changed test files, namesakes or direct importers, then the `runner.tierSize` shortest other importers). It is cheap, but the agent must name the paths; no form takes a base ref. Its answer names the group's other files the paths reach. `read in source code` (help text, 019 D6).
- **`squeal code --base <ref>`** runs with no daemon. Gaps, from the fixture (`code-base.log`, `verified by experiment`) and spec 020 (`read in official docs`, this repository):
  - With the group at `manual`, it ran no test and printed `Code gate: violations ... unit (manual) did not run: 1 test file loads changed code; add --group unit to run it`. The broken `test/m1.test.ts` showed only as `f1 ... incomplete: a test file that loads it is in a check group this run left out`. With the group at `stop`, or with `--group unit`, it ran the file and reported `test/m1.test.ts: failed: f1`. Default scope is every test group not at `manual` (020 D14.1).
  - It selects by import closure and declared inputs (020 D3.1), so its run is the closure-complete set (38 to 90% of Squeal's suite), within a 600 s default budget.
  - It judges JS/TS functions only (020 D2.1). A non-JS change (`src/data.json` in the fixture) selects tests only through closures or declared inputs and appears in no verdict line. Tests that spawn or bundle the code, 70% of Squeal's edit failures (`../../011-core/research/edit-relevance.md` Q1), are selected only where declared inputs name the sources. pytest is out of scope (020 non-goals).
  - CI imports carry no coverage records ("Imported files keep no coverage; records travel in parts only", 020 D13.2). Without `--parts` from `ci record`, `code --base` re-runs every selected file. That is fine only for a narrow selection.
- **macOS laptops** (`inferred` from 018 D10 and `environment.ts`): `platform` and `arch` differ from Linux x64 CI, so no imported pass is current. Every pre-PR run on a Mac is closure-complete against local results only. Not tested here.

## Q4. What dropping edit-time push loses

No experiment compares agents with and without edit-time push. What is measured, from this repository's research (tags as given there):

- Today a failure arrives a median 80 s after its edit (`../../011-core/research/manual-mode.md` finding 4). Agents' own runs before Squeal could answer are 55% of their runs (`../../011-core/research/host-load/011-181.md` finding 2).
- With edit-time runs replaced by the agent's asks, a Stop check and resumes, about 25 failures in 6.4 days (4 a day) arrived later: median 2.5 to 3 min, p95 12 to 18 min, max 28 min. The agent asked first for 60% of the 289 files edited in those periods (`manual-mode.md` Q4; counts verified on transcripts, delays inferred). Without a working Stop check, a broken test can go unreported: in `../../019-run-triggers/lessons.md` (c5) the agent never heard of the test it broke.
- In cezar, node:test at Stop would move 254 distinct failures a week from mid-turn to a pause (`../../019-run-triggers/research/runner-trigger.md` finding 5).
- Countable savings of background work: at most 0.25 h/day, against a cost of 0.65 to 0.96 h/day (`../../011-core/research/load-slowdown.md` Q4).

What cheap on-edit checks keep (`inferred`): their speed (complexity 1.9 ms median per file, 015 lessons; oxlint about 80 ms CPU per file, `../../017-lint-checks/research/oxlint-provider.md`), and little of the test value. 70% of Squeal's edit failures are in tests that load the edited file without calling it or spawn the CLI; lint does not see them. Complexity output changed code in 5 agent sessions in one working day (`../../015-coverage-complexity/lessons.md`, round 1). ESLint lines changed no agent's code in 10 sessions (`../../017-lint-checks/lessons.md`, round 1).

## Recommendation for Squeal (proposals only)

1. **Keep `checks` as the policy surface.** This shape needs no new key:
   ```json
   "checks": [
     { "name": "unit", "runner": "vitest", "at": "manual" },
     { "name": "lint", "lint": ["oxlint"], "at": "edit" }
   ],
   "complexity": { "enabled": true }
   ```
2. **Make runner keying follow the moments.** While no test group is at `edit` or `pause`, re-key edits from stored closures only (the static content re-key and the stored graph, row 021-30), and defer runner keying (paths 1 to 6 of Q1) to the first request that needs it: `squeal run`, a path wait, Stop's request, the commit report. This removes 0.5 to 1.1 GB per worktree on this host. The daemon (350 to 630 MB) and the store process stay; reaching near zero means no daemon for such a policy, an open question below.
3. **Add a narrow pre-PR selection from a base ref**, for example `squeal run <group> --base <ref> --wait`: the narrow run of every path changed since the merge base. At the median it costs 0.05% (one commit) to 1.3% (a release range) of a full suite, 4% at p90; the closure-complete form costs 38 to 90%. Name the rest as CI's, never as passed (vision principle 2).
4. **Do not make `stop` the default moment for the heavy group on large repositories.** Stop waits for every not-current file of a `stop` group (019 D4), that is the closure-complete set: 10 to 15 min at 8 workers per PR here. A Stop that runs the turn's narrow set fits better (`manual-mode.md` recommendation: "Stop check promotes the turn's unchecked edits").
5. **Fix `code --base` under a tiered policy.** It hides a broken test in a `manual` group behind `incomplete`. Either the verdict line names failed or not-run tests first, or a policy with no test group at `edit` puts `manual` groups in the gate's default scope.

## Open questions for the human

1. Is "narrow before the PR, the rest in CI" acceptable as the meaning of "heavy tests before a PR"? A closure-complete local run costs as much as today's live daemon.
2. Should a policy with no edit-time tests run without a daemon at all (lint and complexity in the hook process), to reach near-zero idle memory? Not measured: hook latency of in-hook oxlint and counting.
3. Should closures narrow first? A type-only import re-keys 1,700 Squeal files; cutting type-only edges from keys would shrink every pre-PR set. That is a key-format change.
4. Not determined: how often a narrow pre-PR run misses a failure CI then finds, because no store links local branches to their CI outcomes.

## Sources

- This repository at `1bbd7b4c5`: `src/core/daemon/runner.ts`, `src/core/daemon/host-idle.ts`, `src/core/daemon/policy-lint.ts`, `src/core/scheduler/bootstrap.ts`, `src/core/scheduler/refinement.ts`, `src/core/scheduler/imports-waiting.ts`, `src/core/scheduler/slow-release.ts`, `src/core/keys/environment.ts`, `src/core/shared/served.ts`, `src/runners/vitest/adapter.ts`, `src/core/lint/provider/oxlint/`; `squeal --help` of the committed build.
- Specs: `../../019-run-triggers/spec.md` (D1, D4, D6), `../../020-quality-gate/spec.md` (D2, D3, D13, D14), `../../018-ci-and-shared-results/spec.md` (D10, D11), `../../018-ci-and-shared-results/status.md` (row 018-52).
- Research: `../../011-core/research/manual-mode.md`, `edit-relevance.md`, `load-slowdown.md`, `host-load/011-181.md`; `../../019-run-triggers/research/runner-trigger.md`, `../../019-run-triggers/lessons.md`; `../../018-ci-and-shared-results/research/live-saving.md`; `../../015-coverage-complexity/lessons.md`; `../../017-lint-checks/lessons.md`, `research/oxlint-provider.md`.
- Data: store copies of `~/projects/squeal/.git/squeal/store.sqlite` and `~/projects/cezar/.git/squeal/store.sqlite` (2026-11-23 22:46Z); their `runs/<id>/report.json`; `git log` of both repositories.
- Probes and their output: `probes/tiered-pre-pr/`.
