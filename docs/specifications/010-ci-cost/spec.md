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

The full suite runs on Node 22. It is the engines floor (`>=22.19` since row 011-86, which the job pins literally: `node-version: 22` installed the newest 22.x, so a break on the floor passed CI, review 0.1.239 B1), it had the only real one-version defect (npm 10.9.9 crashing on an e2e install, `ci-test-time.md` 3), and it has the larger flake share. Node 24 runs only the version-sensitive test files.

Those files are listed in `test/version-sensitive.txt`, which the workflow reads (44 files at 010-10). The list started from `ci-test-time.md` 3, 47 files and 144 s of file time:

- `test/runners/node-test/**` and every other test that runs a real `node --test` (integration, the slow tier, e2e);
- `test/e2e/shipped-plugin` and `pi-update` (`plugin-copy` left the list after review 010-11 N1: it reads no version);
- `test/harness/opencode/bridge*`;
- `test/keys/environment`;
- any other test file that reads `process.version` or `process.versions`.

A guard test fails when a `*.test.ts` file reads either of those and is not in the list. The list's header names the helpers that read the Node version (`test/e2e/install.ts`, `test/helpers/pi.ts`) and the files that use them.

### D5. Three shards

The Node 22 suite runs as three jobs, `vitest run --shard=<i>/3`. A simulation calibrated on the logged file times gives 7.2 minutes of Test wall time, and about 25 job-minutes per run together with the Node 24 job (`ci-test-time.md` 4). `test/harness/opencode-dispose.test.ts` is excluded from the shards and runs alone in shard 3 after its suite: inside a shard it overlaps `scheduler/backlog-tiers`' backlog phase and misses its 2,000 ms barrier (010-16). Each shard passes or fails on its own. There is no merge job, because the process reads a failure by test name from the failing job's log.

Lint and typecheck run once per run, in the Node 24 job. Build and the bundle drift check run once per Node version: in Node 22 shard 1 and in the Node 24 job.

A run's peak goes from 2 jobs to 4, plus the 6-second `version` job on main. Each lasts about 8 minutes instead of 20, so the pool time a run occupies falls from about 40 to about 25 job-minutes.

### D6. Process

The coordinator skill, section 6, gains two rules:

- After pushing `cand/<version>`, confirm a run of that commit exists with `gh run list --workflow ci.yml --commit <sha>` (review 010-11 S1). If there is none, start one with `gh workflow run ci.yml --ref cand/<version>`.
- "Main's last landing" in `gh run list --branch main` now lists code landings only, because docs pushes leave no row.

Branches outside D1 get CI only through `workflow_dispatch`. `docs/process.md` is the human's: the line "docs-only pushes start no CI run" in step 5 is proposed to them, not written.

### D7. Nightly Node 24

The human, 2026-10-15. A `schedule` trigger runs main's head once a night (03:23 UTC) as one job: the whole suite on Node 24, which D4 runs only in part. The candidate and landing jobs do not run on a schedule, and neither does `version`. About 20 job-minutes a day. The run lists under `main` in `gh run list`, so the coordinator reads it with the landings (D6); a red nightly blocks the next landing until its cause is named.

### D12. Issue intake

The human, 2026-10-17. A new issue gets a cheap CI check before any triage session: duplicates close in CI, labels come from CI, and the cockpit's `/coordinator` triage starts only on what is left. Before this, every issue started a full session on the reviewers' model, two of the last four of which ended as duplicates (gh-29 of #5, gh-30 of #6).

- **Port.** `.github/workflows/issue-intake.yml` on `issues: opened`, ported from hearsay-tools/cezarion's Jev path at 10cec2e9: the code-built candidate list, the tool-less Jev call, and the trusted applicator that alone holds `issues: write` and checks every mutation against the label set and the candidate set. No Claude or Codex path and no provider switch. The untrusted bot-actor rejection stays.
- **Candidates.** Open issues, as in cezarion, plus issues closed in the last 30 days. A duplicate of an open candidate closes the issue (`--reason duplicate`, a one-line comment naming the original, the `duplicate` label); a duplicate of a closed one only comments "possibly the same as #N" and leaves the issue open.
- **Labels.** At most one type (`bug`, `enhancement`, `documentation`) and at most one area, from a code-owned list whose descriptions name the owning spec: `area-core` (011), `area-slow-suites` (004), `area-adoption` (005), `area-harness` (002, 008, 009, 012), `area-runner` (003, 007, 013), `area-evals` (006), `area-ci` (010).
- **Trigger.** Every issue intake does not close gets `needs-triage`, including when the Jev step fails: a last step under `if: always()` adds it. The cockpit's triage automation moves from `issue.opened` to `issue.labeled` with `needs-triage`, and the triage session swaps `needs-triage` for `triaged`. Adding the label by hand re-triages an issue.
- **Closing is off until the replay.** A repository variable, `ISSUE_INTAKE_CLOSE_DUPLICATES`, unset by default: a duplicate pick then comments and labels instead of closing. The human turns it on after reading the replay.
- **Replay.** A replay over this repository's issues scores Jev against the human's decisions, not against another model: the area of each issue the board routed to a spec (`gh-N to NNN-MM`), and the duplicate verdicts the board records (gh-30 of open #6; gh-29 of #5, closed; #16 of #3, row 004-65). Every other issue is a non-duplicate, except a pick of an issue the human routed to the same row (#8 and #7, row 011-01): merged without being called a duplicate, it is reported in its own group, out of the right and wrong counts, as a question for the human (amended 2026-10-17, `status.md`). 32 issues with two duplicates can show a wrong close or a wrong area; they cannot tune a threshold, so cezarion's thresholds stand and the replay is rerun as duplicates accumulate.

Landing order: the workflow and the labels first, the automation's trigger second, so no issue goes untriaged between them; `docs/process.md`'s Issue triage gains a line on what CI does. Needs the `TYPESAFE_API_KEY` secret.

## Step two (proposed, not approved)

From `research/ci-pr-flow.md` and `research/required-checks-probe.md` (010-13, verified on throwaway branches). The human decides after 010-20's measurement (2026-10-15).

### D8. A required check on main

Ruleset 25176438 gains `required_status_checks`: one context, the aggregate job `CI passed`, pinned to GitHub Actions (`integration_id` 15368), `strict` off (it does nothing on a direct push). GitHub then refuses a push to main unless the pushed SHA has a green check from a `push` run on any branch: no run, a red, queued or running run, or a `workflow_dispatch`-only run are all refused with a GH013 message. Only the pushed head is checked. Main's own push trigger goes: every SHA that reaches main was checked first.

### D9. Every candidate push runs; the skip moves into the jobs

`push` on `cand/**` keeps no `paths` filter: a workflow skipped by `paths` leaves its SHA unlandable (probe T7). A first job classifies the push and the suites skip by `if`, which counts as passing (probe T6). The suites skip when the diff from `origin/main` to the SHA is docs only, or when the branch's previous head (`github.event.before`) has a green `CI passed` and the diff from it is docs only (a reviewed candidate rebased over docs, open question 1). Any doubt runs the full suite. `CI passed` needs every other job to have passed or been skipped by the classifier. The `docs/**/probes/**` re-include narrows to the one probe path a test reads (`docs/specifications/002-codex-adapter/research/probes/**`).

### D10. `version` on candidates

`version` runs on every candidate push against `origin/main`, inside `CI passed`, since main pushes no longer run.

### D11. Landing docs

A docs commit lands through a branch: push `cand/docs-<id8>`, wait for `CI passed` (seconds of runner time), push the same SHA to main, delete the branch. If main moved meanwhile, rebase and repeat. D6's `gh workflow run` fallback goes, since a dispatch run never satisfies the rule; without a `paths` filter every `cand/**` push starts a run (inferred, checked on the first candidate). `docs/process.md` steps 5 and 6 and the coordinator skill's section 6 change with it.

### Cost

- Code landing: one full run (about 23 job-minutes) instead of two, when the reviewed SHA lands or was rebased over docs only (15 of 16 landings in `ci-pr-flow.md`'s window); two when rebased over code.
- Docs commit: about 4 s of runner time and a wait for a free runner, median 10 s and up to 147 s in 13 evening samples, longer when the pool is full (p90 8.8 min in `ci-run-triggers.md`), plus a retry when main moves first (main took a docs push every 156 s at the median). The wait and the retry, for every coordinator, are step two's price.
- At about 0.9 code landings an hour, step two saves about 20 job-minutes an hour, and a landing can no longer turn main red.

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
