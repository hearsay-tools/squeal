# ci-pr-flow: branch protection, pull requests and release-only suites

Researcher, Opus 5.5, 2026-10-15. Read-only on GitHub: `gh api` and `gh run list` reads only, and nothing was changed, pushed or re-run. No probes; the parsing scripts ran in a scratch directory and are not committed (`ci-run-triggers.md` did the same).

Data sets:

- **R**: all 1,929 CI runs created 2026-10-08 06:26 to 2026-10-15 16:31 UTC. For the 387 failed runs on `main` and `cand/*`, the jobs, and the `FAIL` lines of all 701 failed Node job logs (47 logs from 10-08 and 10-09 had no file line).
- **W**: the window after 81f80792 (review before main), 2026-10-14 22:38 to 2026-10-15 16:31 UTC, 17.9 h. Main took 170 pushes: 16 code, 6 `evals/results` only, 146 docs, 2 re-pushes. 20 `cand/*` branches.
- **C**: cezarion's ruleset 22473654, its `ci.yml`, `release.yml` and `nightly.yml` at main, and its latest 100 merged pull requests (2026-10-05 to 10-15).

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Protection on a Free public org repository; binding the one pusher | Rulesets, required checks, linear history and merge queue are all available. A ruleset with an empty bypass list binds `wjarka`, an admin, and they still merge their own pull requests with 0 approvals: cezarion does exactly that. It guards against mistakes, not against the account, which can edit the ruleset | docs; verified in C |
| 2 | Landing the reviewed SHA | No GitHub merge method keeps the head SHA. A direct fast-forward push is allowed under required checks alone, but under "require a pull request" it may need a bypass (not determined). Today only 3 of 16 landings in W kept the reviewed SHA; 12 were rebased over docs only | docs; verified in R |
| 3 | Docs under a pull-request rule | One pull request per docs landing, 146 in W (about 196 a day). A workflow-level `paths` skip leaves a required check pending forever; a job-level skip counts as success. Rulesets have no bypass by path on a public repository | docs; verified in R |
| 4 | Concurrent landings | 1 of 16 landings in W was rebased over another coordinator's code. No main red came from two green candidates combining. Up-to-date: about 1 in 3 code landings re-tests with 8-minute runs. Merge queue: 1 extra full run per landing plus queued docs | verified in R; inferred |
| 5 | Release-only suites | Keep them per landing: they caught 6 real defects in 8 days, all fixed before the next release. Releases come 2 to 44 h apart and none since 10-14. CI caught 3 the local Node 24 gate passed (Node 22 npm, the runner's environment, likely a clean build) | verified in R |
| 6 | Recommendation | D1 to D6 plus a ruleset blocking force pushes and deletion of main, with no bypass. No required pull requests or checks while docs land directly. A nightly full suite on Node 24. A later option is required checks on main, without pull requests, which would remove the landing re-test | inferred |

## 1. Rulesets and branch protection

- **Availability** (read in official docs, fetched 2026-10-15). About rulesets: "available in public repositories with GitHub Free and GitHub Free for organizations". Merge queue: "available in any public repository owned by an organization".
  - Rules for branch rulesets: restrict creations, updates and deletions; require linear history; require a pull request (0 approvals allowed, "doesn't necessarily have to be approved, but it must be opened"); required status checks, strict or loose; block force pushes; allowed merge methods; merge queue.
  - "Restrict file paths" is a push-ruleset rule, and push rulesets are for "a private or internal repository". There is no path-scoped rule or bypass for this repository.
- **The repository today** (verified, `gh api`): `rulesets` is `[]`, `branches/main/protection` is 404, and `allow_auto_merge` is false. The token is `wjarka`'s (`admin: true`), the organisation role is `admin`, and the scopes have no `admin:org`, so organisation rulesets are not readable.
- **Bypass** (read in official docs).
  - Eligible bypass actors: "Repository admins, organization owners", maintain or write roles, teams, apps. Nobody bypasses unless listed.
  - REST `bypass_mode` is `always`, `pull_request` or `exempt`. "For pull requests only" means "The selected actor is now required to open a pull request ... The actor can then choose to bypass any branch protections and merge that pull request." With `exempt`, "rules will not be run for that actor".
  - Classic branch protection differs: "People and apps with admin permissions to a repository are always able to push to a protected branch" unless admins are included.
- **Precedent** (verified, C). Cezarion's "Protect main" ruleset is active with `bypass_actors: []` and `current_user_can_bypass: "never"`. Its rules: `deletion`, `non_fast_forward`, `pull_request` with 0 approvals and all three merge methods, and `required_status_checks` (an aggregate "Unit, build, E2E, and package" job and an "Automated Code Review" job, strict off).
  - `wjarka` authored 97 and merged all 100 of the latest merged pull requests, open to merge p50 4.5 h, p90 12.8 h. All 30 checked have one parent (squash or rebase).
- **What a rule protects** (inferred). Every session pushes with one admin token. With `wjarka` on the bypass list (`always`), the rules bind no one.
  - With an empty list they bind every session, but the same token can rewrite the ruleset through the API. A ruleset therefore stops accidents (a force push, a deleted `main`, a push that skips a required check), not a session that decides to change it.

## 2. Keeping the reviewed SHA

- **Merge methods** (read in official docs).
  - A merge commit is new (`--no-ff`).
  - Squash makes one new commit.
  - Rebase "Always updates the committer information and creates new commit SHAs".
  - A merge queue's temporary branches "contain a different `sha` from the pull request", and the queue merges the group commit.
  - GitHub offers no fast-forward merge of a pull request. None of these lands the head SHA.
- **Direct fast-forward push** (read in official docs; not verified by experiment).
  - Under required checks alone: "After all required status checks pass, any commits must either be pushed to another branch and then merged or pushed directly to the protected branch", where a passing check is `success`, `skipped` or `neutral`. A green `cand/<version>` SHA can then be pushed to `main` as is. A `push` run counts toward required checks; a `workflow_dispatch` run does not.
  - Under "require a pull request", the docs say only that "you may also need bypass permissions to push the locally merged commit". Whether a fast-forward push of a pull request's green head is accepted without bypass is not determined. It needs a probe on a scratch repository, not on Squeal.
- **What lands today** (verified, R and W). Of the 20 `cand/*` branches in W, 16 landed:
  - 3 as fast-forwards with the reviewed SHA (0.1.184, 0.1.186, 0.1.194);
  - 12 rebased over docs or `evals/results` commits only, so the code is identical to the reviewed tree but the SHA is new;
  - 1 rebased over another coordinator's code (0.1.188, 108 non-docs files).

  The other 4 (0.1.181, 0.1.183, 0.1.189, 0.1.196) were re-cut or are still in review. With docs on main every 156 s at the median (W), "main's commit is the one reviewed" already holds for the code tree, not for the SHA.

## 3. Docs under a pull-request rule

- **Volume** (verified, W). 146 docs pushes in 17.9 h, about 8 an hour, from several coordinators. Under "require a pull request" with no bypass, each becomes a pull request (or a batch of them), a check, and a merge. Auto-merge needs `allow_auto_merge` turned on, and it is offered "only on pull requests that cannot be merged immediately" (read in official docs).
- **Required checks and skips** (read in official docs, troubleshooting required status checks):
  - A workflow skipped by path or branch filtering: "Associated checks stay in a 'Pending' state and block merging".
  - A job skipped by a conditional: "The job reports 'Success'".
  - A job that depends on a failed job: "may not block merging"; the fix is "`always()` with `needs`".

  So D2's workflow-level `paths` filter cannot coexist with a required check. Docs-only changes need a job-level skip and one required aggregate job.
- **Cezarion's shape** (read in source code, C `ci.yml`).
  - A `change-surface` job classifies the pull request's files from the API into `docs-only`, `infra-only` or `full-matrix`, and falls back to `full-matrix` on any API doubt.
  - The suites have `if: surface == 'full-matrix'`.
  - A `verify` job (`needs:` all, `if: always()`) accepts `skipped` only for a docs or infra surface, and is the single required check.
  - Requiring the aggregate rather than matrix jobs also avoids naming each `Node 22` or shard check (inferred).
- **Cost of a docs pull request** (inferred from C's jobs). Two short jobs, the classifier and the aggregate, under a minute of job time and well under 1 job-minute per landing. The real cost is latency: queue plus about 30 s before the merge. When the pool is full, the queue was p90 8.8 min (`ci-run-triggers.md` 5).

## 4. Two coordinators landing at once

- **Measured** (verified, R and W).
  - Of 16 landings, 1 (0.1.188) had another coordinator's code land between its candidate run and its landing.
  - Of 22 code or eval pushes to main, 3 were red, each a single-Node flake: `integration/node-test-packages` on 24, `e2e/stop-gap` on 22, `daemon/escaped` on 22.
  - No main red in R traces to two green candidates combining.
  - D1 to D6's landing re-test re-ran the candidate's exact code tree in 15 of 16 landings.
- **Up-to-date rule (strict)** (read in official docs; numbers verified in W). "More builds may be required, as you'll need to bring the head branch up to date after other collaborators update the target branch."
  - Main moved in the 8 minutes before 7 of 22 code or eval pushes, and in the 20 minutes before 15 of 22.
  - With D5's 8-minute shards, about 1 in 3 code landings would re-test at least once, and more if docs pushes also count. Under today's 20-minute runs it would be 2 in 3 (inferred).
- **Merge queue** (read in official docs). It must trigger on `merge_group`. Each entry is tested on main plus everything ahead of it, so a landing costs its pull-request run plus one `merge_group` run.
  - Docs pull requests queued behind a code entry form groups that contain code, so they get full runs too. W had 2.8 docs pushes within 8 minutes after each code push: about 1 to 3 more full runs per code landing, unless docs bypass the queue (inferred).
  - "Only merge non-failing pull requests" off lets a later green group carry an earlier flaky one.
- **Against D1 to D6**: a candidate run plus a main landing run, two full runs per landing, and the second comes after main moved. A merge queue costs about the same two runs or more, but before main moves. It guards against a collision that happened once in 16 landings and never turned main red in R.

## 5. Release-only or scheduled suites

- **Real defects in the e2e, pytest and harness-fixture families, R** (verified from logs; a defect is a failure on both Nodes, or several runs in a row with a fix commit after):

  | When | Where | Files | Fixed | Caught only by CI? |
  |---|---|---|---|---|
  | 10-13 12:04 | main, Node 22, 3 runs | `e2e/shipped-plugin` (npm 10.9.9 crash) | 65acfe0b, same day | yes: Node 22 |
  | 10-14 14:36 to 17:17 | main, both, 23 runs | `integration/pytest` | 0.1.173 (007-28, 007-29), about 3 h | unknown |
  | 10-14 22:26 | cand/0.1.181, both | `e2e/pytest`, `runners/pytest/fixtures` | re-cut | no: the review also failed it |
  | 10-14 23:48 | cand/0.1.184, Node 24 | `harness/opencode/bridge-client` | a436948b, before landing | yes: "CI's environment lacks" a proxy URL |
  | 10-15 00:23 | cand/0.1.185, both | `harness/{codex,opencode,pi}` package bundles, `harness/plugin` | 574200da, before landing | likely: a clean checkout and build |
  | 10-15 14:19 | cand/0.1.196, both | `e2e/{lifecycle,node-test,policy,transitions,worktrees}` | repair 001-418 | no: review 001-417 also failed it |

  Every one was fixed before the next release would have run, since there was no release after 10-14 13:08 UTC (0.1.168).

  A release-only cut of these families would have:
  - let 0.1.184 and 0.1.185 land with their defects;
  - moved the pytest and npm reds from main to the release that followed;
  - left 0.1.181 and 0.1.196 to the reviewer alone.

  Outside these, the families had about 12 single-run flakes on main or `cand/*` in R.
- **The delay** (verified, tags). 11 release tags between 10-09 and 10-14, 1.6 to 44 h apart (median about 8 h), and none for the 27 h since. A release-only suite reports a defect up to a day or two after its landing, across every landing in between, and blocks a release made by hand.
- **What CI adds beyond the coordinator's gate** (the gate is the full suite under the host lock on this host's Node, v24.21.0). The 7 red `cand/*` runs in R, all pushed after a green gate:
  - 3 defects CI saw and the gate passed: Node 22's npm, the runner's environment, a clean checkout and build (the last likely, not proven);
  - 2 defects a reviewer's independent run also found;
  - 3 flakes (`daemon/drain` on both, `daemon/escaped` on 24, `e2e/opencode` on 22 with `e2e/stop-gap` on 24).
- **Precedent** (read in source code, C). Cezarion keeps its full matrix per pull request. `release.yml` is a manual `workflow_dispatch` that re-verifies before publishing. `nightly.yml` (cron `17 3 * * *`) re-runs the suite on main only to publish, because "the trunk can still go red through the calendar alone". Scheduled runs use the default branch's latest commit and "can be delayed during periods of high loads" (read in official docs).

## Recommendation

Step two, as a change to D1 to D6:

1. **Protect main with a ruleset, no bypass**: `deletion` and `non_fast_forward`. It costs nothing, needs no process change, and stops the accident a shared admin token makes possible.
2. **Do not require pull requests or a merge queue now.** Docs land about 8 times an hour, so either rule turns each docs landing into a pull request and a check, and the queue adds about 1 to 3 full runs per code landing. They guard against a collision seen once in 16 landings. D2 would also have to become a job-level skip with an aggregate check.
3. **Keep e2e, pytest and the fixtures per landing.** They found 6 real defects in 8 days, 3 of them likely invisible to the host gate. Add a nightly full-suite run on Node 24 on main, about 20 job-minutes a day, to restore what D4 drops from Node 24. Today there is no release workflow to hang it on.
4. **Later option: required checks on main, without pull requests**, if a scratch-repository probe confirms that a ruleset accepts a direct fast-forward of a SHA with a passing required check. Main's push trigger could then go: every main SHA is checked before it lands, so a landing costs one full candidate run (about 25 job-minutes) instead of D1 to D6's two (about 50).

   It needs:
   - the open question 1 gate, which passes a rebased SHA when its diff to a green-tested SHA is docs only (12 of 16 landings in W);
   - a check on each docs commit before it lands (two short jobs, plus a retry when main moves first);
   - the `version` job moved from main pushes to candidates (`origin/main..HEAD`).

   `docs/process.md` step 5 would then read "docs commits land after a short check" instead of "land directly", and step 6's rebase would push only a checked SHA.

## Open questions

- Does a ruleset with required checks accept a direct fast-forward push of a checked SHA, and does a "require a pull request" ruleset accept a fast-forward push of a green pull-request head without bypass? Not determined, because the docs hedge ("may also need bypass permissions") and an experiment is a GitHub write. Probe it on a scratch repository.
- Was the `integration/pytest` red of 10-14 reproducible on the host gate? Not determined. Its fix (a per-run bytecode prefix) suggests runner timing or cache state.
- Would coordinators batch docs commits if each one needed a pull request? It is a process question, not a measurement.

## Sources

- GitHub docs, fetched 2026-10-15 via `https://docs.github.com/api/article/body?pathname=…` (availability lines from the rendered pages):
  - `/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/{about-rulesets,available-rules-for-rulesets,creating-rulesets-for-a-repository}`;
  - `…/managing-protected-branches/about-protected-branches`;
  - `…/configuring-pull-request-merges/{managing-a-merge-queue,about-merge-methods-on-github}`;
  - `/en/pull-requests/collaborating-with-pull-requests/incorporating-changes-from-a-pull-request/{about-pull-request-merges,merging-a-pull-request,automatically-merging-a-pull-request}`;
  - `/en/pull-requests/collaborating-with-pull-requests/collaborating-on-repositories-with-code-quality-features/troubleshooting-required-status-checks`;
  - `/en/rest/repos/rules` (`bypass_mode`);
  - `/en/actions/reference/workflows-and-actions/events-that-trigger-workflows` (`merge_group`, `schedule`).
- GitHub API, read-only:
  - `repos/hearsay-tools/squeal` (settings, permissions), `…/rulesets`, `…/branches/main/protection`;
  - `orgs/hearsay-tools/memberships/wjarka`;
  - `repos/hearsay-tools/squeal/actions/workflows/ci.yml/runs?created=…` (R), `…/runs/<id>/jobs?filter=latest`, `…/actions/jobs/<id>/logs`.
  - Runs cited: 38582092315 (6c9fed9e, the first pytest red), 38605425747, 38607309981.
- Cezarion, read-only: `repos/hearsay-tools/cezarion/rulesets/22473654`, `contents/.github/workflows/{ci,release,nightly}.yml`, `gh pr list --state merged --limit 100`, `commits/<sha>` parents.
- Repository at origin/main 2026-10-15: `.github/workflows/ci.yml`, `docs/process.md` steps 5, 6, 6a, `.agents/skills/coordinator/SKILL.md` section 6, `docs/board.md` rows 001-417 to 001-419, tags `squeal--v*`, commits 65acfe0b, a436948b, 574200da, 643752b1, 6c9fed9e.
- `research/ci-run-triggers.md`, `research/ci-test-time.md`, `spec.md` and `status.md` of this spec.
