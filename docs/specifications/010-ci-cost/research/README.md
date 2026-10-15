# Research brief for spec 010: CI cost

Read `docs/vision.md`, `docs/styleguide.md` and `docs/process.md` first (steps 5, 6 and "Test runs on a shared host": what the process reads from CI), then `../status.md` and `.github/workflows/ci.yml`.

The human, 2026-10-15: CI takes too long and saturates the organisation's concurrency limit. Each run starts two Node jobs (22 and 24) of about 20 minutes each. CI runs on every branch push with no cancellation of superseded runs; the latest 100 runs included 26 extra runs for commit SHAs already tested, commonly the same SHA pushed to a task branch and to main.

The coordinator's first look (`gh run list --workflow ci.yml --limit 100`, 2026-10-15 16:50 local): the 100 runs span 09:34 to 14:47 UTC that day, 59 on `main`, 24 on `cez/*`, 17 on `cand/*`, all `push`; 80 head commits are titled `docs...`; run wall time p50 29 min, p90 75 min (queueing included). In one green main run the Test step took 19.6 of the job's 20.2 minutes; lint, typecheck, build, npm ci and the Pythons take seconds. `main` has no branch protection. The repository is public, owned by the organisation `hearsay-tools`.

Each topic below is one researcher task. Write your findings to `research/<topic>.md` in this folder. Commit when done.

## Rules for findings documents

- Length: 1 to 3 pages. Structure: Questions answered (a table), Findings per question, Recommendation, Open questions, Sources.
- Mark every finding `verified by experiment`, `read in official docs`, `read in source code` or `inferred`. Numbers name the runs they come from.
- Evidence comes from GitHub's record (`gh run list`, `gh run view --log`, `gh api`) and GitHub's documentation. Read-only on GitHub: no pushes, no workflow edits, no reruns or cancellations. A CI experiment costs the concurrency this spec is about; propose it as a wave-0 measurement instead.
- No full local test runs: the host is shared and loaded (`docs/process.md`, test runs on a shared host). A single test file run locally is fine when it answers a question.
- Do not design the workflow. Answer, measure, recommend; the coordinator writes the spec.
- Do not touch anything outside `docs/specifications/010-ci-cost/research/`.

## Topic: ci-test-time

Why a Node job's Test step takes about 20 minutes, and what would shorten it or cut its job count without losing a signal.

1. Per-file durations from the logs of about ten recent green runs per Node version: the top 20 files and their share; which are e2e (`test/e2e`), harness fixtures (Pi, OpenCode, Codex), pytest or slow-suite files. The worker count Vitest uses on a GitHub `ubuntu-latest` runner, and the critical path: the longest file against total file time over workers.
2. Is the step CPU-bound or waiting (fixed sleeps, polls, timeouts, idle daemons)? Compare wall time against summed file time.
3. Which failures in the last few hundred runs happened on only one Node version (the board names several Node 22 ones)? What would running the full suite on one Node and a subset on the other lose?
4. Options, each with its estimated wall-time and job-minute effect and what it loses: one Node for the full suite; `--shard` across jobs (wall time against concurrency); e2e and other slow files in a job that runs only on `cand/*` and `main`; Vitest pool or isolation settings, from docs and CI logs only; larger runners, if the organisation's plan has them.
5. Reruns: how many recent runs are a second attempt (`run_attempt` > 1), and which tests caused them.

## Topic: ci-run-triggers

Which runs are redundant, and which GitHub mechanisms remove them without losing what the process reads from CI.

1. Classify the last 200 runs or three days, whichever is more: branch family (`main`, `cand/*`, `cez/*`, `exp/*`, `hold/*`, other); docs-only change against the branch's previous run; SHA already tested elsewhere, and whether that run was green; superseded (a newer run on the same branch started before it finished). Job-minutes and queue time (created to started) per class.
2. Who pushes `cez/*`, `exp/*` and `hold/*` branches, and does anything in the process read their CI? What does the process read: `cand/*` branch CI before landing, main's last landing before the next (process step 5, `.agents/skills/coordinator/SKILL.md` section 6).
3. Exact semantics, from GitHub's docs, of: `paths-ignore` on push (multi-commit and new-branch pushes, force pushes, the diff size limits, what a skipped workflow shows in `gh run list`); `concurrency` with `cancel-in-progress` (per-ref groups, what a cancelled run shows, whether cancelling on `main` loses a landing's result); `branches` filters; skipping an already-tested SHA (a first job that asks the API for a green run of this workflow on the same SHA and gates the rest, a third-party action such as `fkirc/skip-duplicate-actions` with its supply-chain cost, or triggering only on the branches the process reads).
4. The `version` job compares `github.event.before` on main pushes. Which mechanism above would drop that check for a pushed range, and how to keep it?
5. The organisation's concurrent-job limit for its plan (from docs; `gh api orgs/hearsay-tools` if readable) and whether other repositories in the organisation share it, from their visible run counts.

## Topic: ci-pr-flow (step two, the human 2026-10-15)

After approving D1 to D6 as a first step, the human asked two things: could some of the suite run only at release, and should `main` get branch protection, with CI only on pull requests to main and in a release workflow. Today there is no release workflow: releases are by hand (`docs/process.md` step 6a). 11 release tags in 2026-10-09 to 10-14, none since 0.1.168 while main reached 0.1.196. Cezarion, in the same organisation, runs CI on `pull_request` and main pushes and has `release.yml` and `nightly.yml`; read them as a precedent. Spec 010 D1 to D6 are the baseline to compare against.

1. Branch protection and rulesets on a public organisation repository on the Free plan: what is available (require a pull request, required status checks, up-to-date requirement, linear history, merge queue, bypass lists, path-restricted rules). Every session pushes as `wjarka`: what does a rule protect when its only pusher can bypass it, and can a rule bind that account without blocking coordinators from merging their own pull requests with no human approval?
2. Landing the reviewed SHA: the process lands `cand/<version>` by fast-forward, so main's commit is the one reviewed. Which GitHub merge methods keep that SHA (merge, squash, rebase, merge queue), and can a protected main still accept a fast-forward of a pull request's head?
3. Docs: main took 429 docs-only pushes in 81 hours from several coordinators, landed directly by process step 5. Under a pull-request rule, what does a docs commit cost (a pull request each, auto-merge, a bypass by path)? A required check whose workflow a `paths` filter skipped stays pending: which designs avoid blocking docs pull requests (job-level skips, which count as success, against workflow-level filters)?
4. Two coordinators land concurrently. Two pull requests green against an older main can merge into a red main: what do the up-to-date rule and the merge queue cost in extra runs per landing, against what D1 to D6 leave (the landing re-test, open question 1)?
5. Release-only or scheduled suites: which test families could leave per-landing CI for a release or a nightly run on main (e2e, pytest, harness fixtures: 119 files, 1,190 s, `ci-test-time.md` 1), and what that delays. Count from the run record how often a failure in those families first showed on `main` or a `cand/*` run and was fixed before the next release would have caught it. The coordinators' local gate already runs the full suite on Node 24 before each candidate: what does CI add beyond it, from the failures it caught that the gate passed (Node 22, clean environment, runner timing)?
6. Recommendation: the trigger and protection design for step two, as a change to D1 to D6, with runs and job-minutes per landing against D1 to D6, and what the process (`docs/process.md`, human-owned) would have to change. Changing a repository setting is not part of this topic: read-only on GitHub, `gh api` reads only.
