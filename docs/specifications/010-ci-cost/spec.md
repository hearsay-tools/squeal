# 010 CI cost

## Problem

CI on `hearsay-tools/squeal` (`.github/workflows/ci.yml` at 6dddcbf4) runs on every push to every branch: two Node jobs (22 and 24) of about 20 minutes each, nothing cancelled or skipped. In the 81 hours to 2026-10-15 14:47 UTC it ran 951 times for 27,790 job-minutes (`research/ci-run-triggers.md` 1):

- 594 runs were docs-only pushes. 106 of them failed on code that was already tested: flakes.
- 342 runs were on `cez/*`, `exp/*`, `hold/*` and tags, whose CI nothing in the process reads.
- 272 re-tested a SHA another ref was testing at the same second, mostly the old coordinator double push to a task branch and `main` (removed from the skill in 81f80792; sessions started before it still do it).

The organisation is on GitHub's Free plan: one pool of 20 concurrent jobs, shared with cezarion. The pool was full for 25.6% of the window, and Squeal's Node jobs then queued (p90 8.8 min, max 72 min; `ci-run-triggers.md` 5).

Each job's Test step is 19.6 of its 20.2 minutes. It almost doubled in five days as the pytest, OpenCode and Pi suites landed: 634 files, about 3,350 s of file time on 3 Vitest workers (`research/ci-test-time.md` 1). Both jobs run all 634 files. Of 112 runs that were red on one Node version only, one was a real version defect; the rest were the same flaky tests drawn twice (`ci-test-time.md` 3).

## Goals

- G1. CI runs where the process reads it: pushes to `main` and `cand/**`, pull requests, and on request. A push to any other branch or a tag starts no run.
- G2. A push that changes only `docs/` (outside `docs/**/probes/**`) starts no run.
- G3. A run costs about 25 job-minutes instead of 40.4, and its Test wall time is under 9 minutes instead of about 19.
- G4. No signal the process reads is lost: every `cand/*` push and every main code landing gets the full suite, the `version` job compares every main push's range, and the version-sensitive tests still run on Node 22 and 24.
- G5. Over three days after landing, CI uses at most 120 job-minutes per hour, against 572 measured after 81f80792.

## Non-goals

- Fixing flaky tests (board Later, "Load-sensitive tests"). This spec only exposes fewer draws.
- Making slow files faster (`scheduler/backlog-tiers` 244 s, `scheduler/timed-out-tier` 126 s). Each is its own row if wanted.
- Vitest pool and isolation settings: `isolate: false` saves about 30 s; `threads` conflicts with tests that call `process.chdir` (`ci-test-time.md` 4).
- A duplicate-SHA gate or `fkirc/skip-duplicate-actions`. D1 removes 266 of the 272 duplicates. The pairs start 1 s apart, so an API gate would have skipped none, and the action needs `actions: write` for third-party code (`ci-run-triggers.md` 3).
- Reusing a candidate's verdict for its landing on main (open question 1).
- The Codex `dist` drift check (board Later, 002).
- Larger runners or a raised limit: not on the Free plan.

## Design

### D1. Triggers

`push` runs only for branches `main` and `cand/**`. A branch filter also stops tag runs. `pull_request` stays: it started no run in the window, and it is how an outside contribution to a public repository gets checked. `workflow_dispatch` is added, so a branch outside the filter gets a run on request with `gh workflow run ci.yml --ref <branch>`.

A push runs the workflow file of its own commit. Branches cut before this lands keep the old trigger until they are rebased. `cand/*` and `main` always build on current main, so that tail affects only `cez/*`, `exp/*` and `hold/*` (`ci-run-triggers.md` 3, inferred).

### D2. Docs-only pushes

`push` and `pull_request` take one `paths` list: `**`, then `!docs/**`, then `docs/**/probes/**`. The probe re-include is there because `test/cli/codex-hash.test.ts` reads a probe log. No other test reads this repository's `docs/` (checked by grep at 9f8ae71f). A skipped push leaves no row in `gh run list`.

The `version` job loses nothing: a docs-only range leaves the bundles unchanged, so the next code push's range still starts at bundles equal to the last checked ones (`ci-run-triggers.md` 4).

GitHub does not document the paths diff for a new branch whose commits are all already on GitHub. Such a branch may see no changed files and start no run. A candidate is a new commit in practice; D6 makes the coordinator confirm its run.

### D3. Cancellation

A newer push cancels a superseded run on `cand/*` and on pull requests. Main runs are never cancelled and never wait for each other: the concurrency group is the ref for those two and includes `github.run_id` on `main`. GitHub cancels a pending run in a shared group even without `cancel-in-progress`. A cancelled main run would skip the `version` check for its range and show `cancelled` where the landing's result belongs (`ci-run-triggers.md` 3, 4). The saving is small (155 job-minutes in the window), but no signal is lost.

### D4. One full Node version

The full suite runs on Node 22. It is the engines floor (`>=22.13`), it had the only real one-version defect (npm 10.9.9 crashing on an e2e install, `ci-test-time.md` 3), and it has the larger flake share. Node 24 runs only the version-sensitive test files.

Those files are listed in `test/version-sensitive.txt`, which the workflow reads (44 files at 010-10). The list started from `ci-test-time.md` 3, 47 files and 144 s of file time:

- `test/runners/node-test/**` and every other test that runs a real `node --test` (integration, the slow tier, e2e);
- `test/e2e/shipped-plugin` and `pi-update` (`plugin-copy` left the list after review 010-11 N1: it reads no version);
- `test/harness/opencode/bridge*`;
- `test/keys/environment`;
- any other test file that reads `process.version` or `process.versions`.

A guard test fails when a `*.test.ts` file reads either of those and is not in the list. The list's header names the helpers that read the Node version (`test/e2e/install.ts`, `test/helpers/pi.ts`) and the files that use them.

### D5. Three shards

The Node 22 suite runs as three jobs, `vitest run --shard=<i>/3`. A simulation calibrated on the logged file times gives 7.2 minutes of Test wall time, and about 25 job-minutes per run together with the Node 24 job (`ci-test-time.md` 4). Each shard passes or fails on its own. There is no merge job, because the process reads a failure by test name from the failing job's log.

Lint and typecheck run once per run, in the Node 24 job. Build and the bundle drift check run once per Node version: in Node 22 shard 1 and in the Node 24 job.

A run's peak goes from 2 jobs to 4, plus the 6-second `version` job on main. Each lasts about 8 minutes instead of 20, so the pool time a run occupies falls from about 40 to about 25 job-minutes.

### D6. Process

The coordinator skill, section 6, gains two rules:

- After pushing `cand/<version>`, confirm a run of that commit exists with `gh run list --workflow ci.yml --commit <sha>` (review 010-11 S1). If there is none, start one with `gh workflow run ci.yml --ref cand/<version>`.
- "Main's last landing" in `gh run list --branch main` now lists code landings only, because docs pushes leave no row.

Branches outside D1 get CI only through `workflow_dispatch`. `docs/process.md` is the human's: the line "docs-only pushes start no CI run" in step 5 is proposed to them, not written.

### D7. Nightly Node 24

The human, 2026-10-15. A `schedule` trigger runs main's head once a night (03:23 UTC) as one job: the whole suite on Node 24, which D4 runs only in part. The candidate and landing jobs do not run on a schedule, and neither does `version`. About 20 job-minutes a day. The run lists under `main` in `gh run list`, so the coordinator reads it with the landings (D6); a red nightly blocks the next landing until its cause is named.

## Testing

- The candidate tests its own workflow, because D1 includes `cand/**`. Its run must show three Node 22 shard jobs and one Node 24 job, and no `version` job. Record each shard's Test wall time.
- A docs-only commit pushed to the candidate after its code commit starts no run.
- One edge probe: push `cand/010-probe` at the candidate's SHA, which is already on GitHub. Record whether a run starts, then delete the branch. The result goes in `status.md`. D6's fallback stays either way.
- The first main landing after this shows the three shards, the Node 24 job and `version`. `version`'s range starts at the previous main push.
- The guard test from D4 runs in the suite.
- The first scheduled run on main after landing shows the one nightly job and is green, or its failures are named in a board row (D7). A schedule cannot be run from a branch, so the candidate does not test it.
- A three-day measurement (row 010-20) covers:
  - runs per day, and job-minutes per hour against G5;
  - p90 queue time for Squeal's Node jobs;
  - whether every `cand/*` push got a run;
  - that no main run was cancelled.

  It compares against `ci-run-triggers.md` 1 and 5 and is written to `lessons.md`.

## Open questions

1. The landing re-test (the human). A main landing whose code equals a green candidate's (a fast-forward, or a rebase over docs-only commits) runs the full suite again. The 16 hours after 81f80792 had 48 candidate runs, each one's landing a repeat. A gate could skip the test jobs when a green `cand/*` run exists for a commit whose diff to HEAD is docs-only, and keep `version`. Decide after 010-20's numbers.
2. Is `maxWorkers: 4` faster than Vitest's default of 3 on a 4-vCPU runner (`ci-test-time.md` open questions)? Measure it on one SHA, three runs each, after 010-20, since the measurement spends concurrency.
3. The organisation's real concurrent-job limit (the human). Combined peaks of 38 jobs contradict the documented 20. Reading it needs `admin:org` or GitHub Support.

## References

- `research/ci-run-triggers.md`, `research/ci-test-time.md` (2026-10-15).
- `.github/workflows/ci.yml` and `scripts/check-version-bump.ts` at 6dddcbf4; commit 81f80792 (review before main; the coordinator push line).
- `docs/process.md` step 5; `.agents/skills/coordinator/SKILL.md` section 6.
- Board Later: load-sensitive tests; 002's Codex `dist` drift.
