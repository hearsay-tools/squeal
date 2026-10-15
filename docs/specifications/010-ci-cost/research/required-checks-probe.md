# required-checks-probe: can main require a check without pull requests?

Researcher, Opus 5.5, 2026-10-15, row 010-13. Probed inside `hearsay-tools/squeal` by the human's leave: branches `probe/010-13-src`, `-target` and `-side`, the throwaway workflow `probe-010-13.yml` on them only, and ruleset 25193915 whose `include` was `refs/heads/probe/010-13-target` alone, `required_status_checks` on the context `probe-check`, no bypass actors (`current_user_can_bypass: never`). Pushes as `wjarka`, an admin, over HTTPS. No pull request, no other branch, ruleset 25176438 untouched. Sources, transcript and timings are under `probes/010-13/`; every push below quotes `transcript.txt`.

The probe job is a single `echo`. CI's own workflow did not run on these branches (D1: push on `main` and `cand/**` only).

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Fast-forward of a SHA green in a `push` run on another branch | Accepted. Refused with no run ("is expected"), a red run ("is failing"), a queued or running one ("is in progress"), and a run from `workflow_dispatch` only ("is expected") | verified by experiment |
| 2 | Job skipped by `if`; workflow skipped by `paths` | A job skipped by its `if` (`conclusion: skipped`) satisfies the rule. A workflow skipped by `paths-ignore` leaves no check, and the SHA is refused ("is expected") | verified by experiment |
| 3 | Push to green check, under the pool's load | Median 10 s over 13 runs, 19:50 to 21:09 UTC. 9 of 13 took 9 to 12 s; 4 took 63 to 147 s, each while squeal or cezarion CI runs held the organisation's runners | verified by experiment |
| 4 | What the docs did not say | Only the pushed head is checked: unchecked and red commits inside the range pass. `strict` has no effect on a direct push, even a forced one. The context is the job name: a renamed workflow still satisfies it, a `Workflow / job` context never matches. An empty commit starts no run under a `paths` filter. Pinning `integration_id` 15368 (GitHub Actions) works | verified by experiment |

## 1. Which pushes the rule accepts

Every push is `git push origin <sha>:refs/heads/probe/010-13-target`, a fast-forward unless named. Rejections read, in full apart from the URL line:

```
remote: error: GH013: Repository rule violations found for refs/heads/probe/010-13-target.
remote: - Required status check "probe-check" is expected.
 ! [remote rejected]   <sha> -> probe/010-13-target (push declined due to repository rule violations)
error: failed to push some refs to 'https://github.com/hearsay-tools/squeal.git'
```

| Test | SHA | Check on the SHA when pushed | Result, rule message |
|---|---|---|---|
| T1 no run | c698121d | none (never pushed) | refused, "is expected", exit 1 |
| T2 green push run on `-src` | 257ce57f | `success`, push run 38798952010 | accepted `74e37f00..257ce57f`, exit 0 |
| T3 red | 78e8f049 | `failure`, run 38799172158 | refused, "is failing" |
| T4 queued | 747e8e44 | `queued`, run 38799250034 | refused, "is in progress" |
| T4 running | 747e8e44 | `in_progress` | refused, "is in progress" |
| T4 after it finished | 747e8e44 | `success` | accepted `257ce57f..747e8e44`; the range holds red 78e8f049 |
| T5 `[skip ci]` push, no run | e3e52d38 | none (0 runs for the SHA) | refused, "is expected" |
| T5 `workflow_dispatch` only | e3e52d38 | `success`, run 38799718721, event `workflow_dispatch` | refused, "is expected", twice, 7 s and 16 s after the check completed |

- **Dispatch runs do not count** (verified; read in official docs, troubleshooting required status checks): checks count only from runs triggered by "`push`, `pull_request`, `pull_request_review`, `pull_request_target`, `deployment`, `deployment_status`"; a `workflow_dispatch` check "do[es] not satisfy a required status check in a branch ruleset". `schedule` is not on the list either, so the nightly (D7) never makes a SHA landable.
- **The check follows the SHA, not the branch** (verified, T2): the run was on `probe/010-13-src`, the push went to `-target`. This is what lets a green `cand/<version>` SHA fast-forward main.

## 2. Skipped jobs and skipped workflows

| Test | SHA | Check | Result |
|---|---|---|---|
| T6 job skipped by `if: !contains(..., '[probe-skip]')` | c4aca167 | `completed`, `conclusion: skipped`, run 38799834321, 5 s after the push | accepted `747e8e44..c4aca167` |
| T7 change only under `probe-docs/`, workflow `paths-ignore: ["probe-docs/**"]` | 88c21961 | none; 0 runs for the SHA 92 s after the push | refused, "is expected" |

This confirms the docs (`ci-pr-flow.md` 3): "A workflow is skipped by path filtering, branch filtering, or a commit message: Associated checks stay in a 'Pending' state"; "A job is skipped by a conditional: The job reports 'Success'". Under a required check, D2's workflow-level `paths` filter would leave every docs-only SHA unlandable on main; the skip has to move into a job that always runs and reports.

## 3. Time from push to a green check

Push to `probe/010-13-src`, then the run's creation, the job's start and its completion (GitHub's timestamps; `samples.tsv` and the transcript). Load is the count of queued and running Actions runs in squeal and in cezarion when the sample was pushed (`sample.sh`); the T-rows did not record it, and the CI runs of both repositories that overlapped are named instead.

| Sample | SHA | Pushed (UTC) | Run created | Job started | Completed | Push to green | Load sq q/r, cz q/r | Other CI holding runners |
|---|---|---|---|---|---|---|---|---|
| P0 | 74e37f00 | 19:50:58 | +4 s | +60 s | +63 s | **63 s** | not recorded | squeal main 38794558547 (to 19:52:09); cezarion CI on 3 branches |
| T2 | 257ce57f | 20:04:04 | +3 s | +76 s | +80 s | **80 s** | not recorded | squeal `cand/006-89` 38798899196 created 20:03:44; cezarion on 3 branches |
| T3 | 78e8f049 | 20:05:41 | +3 s | +6 s | +9 s | 9 s (red) | not recorded | |
| T8 | 50d49901 | 20:12:46 | +4 s | +7 s | +10 s | 10 s | not recorded | |
| T9 | ccf2f6b0 | 20:13:15 | +4 s | +7 s | +11 s | 11 s | not recorded | |
| T10 | 66f28060 | 20:13:45 | +5 s | +9 s | +12 s | 12 s | not recorded | |
| 1 | a7e62bf7 | 20:14:45 | +3 s | +7 s | +10 s | 10 s | 0/0, 3/4 | |
| 2 | e694696a | 20:23:01 | +3 s | +143 s | +147 s | **147 s** | 1/0, 4/2 | squeal main run created 20:21:27; cezarion on 4 branches |
| 3 | abc19ebe | 20:33:36 | +3 s | +6 s | +9 s | 9 s | 0/0, 3/4 | |
| 4 | 7d6c46c5 | 20:41:54 | +3 s | +7 s | +9 s | 9 s | 0/0, 3/3 | |
| 5 | e6a372f6 | 20:50:10 | +3 s | +119 s | +121 s | **121 s** | 0/0, 5/3 | cezarion on 5 branches; squeal `cand/0.1.198` created 20:50:59, during the wait |
| 6 | f71e4067 | 21:00:16 | +3 s | +6 s | +9 s | 9 s | 0/1, 3/3 | |
| 7 | 98f9df02 | 21:08:32 | +4 s | +8 s | +10 s | 10 s | 0/0, 3/3 | |

Over the 13 runs: median 10 s, 9 of 13 within 12 s, 4 of 13 between 63 and 147 s. The T4 sleeper started 9 s after its push; the job-skipped T6 reported 5 s after its push, without a runner.

- The job itself runs 3 to 4 s from start to completion; everything else is the run's creation (3 to 6 s after the push) and the wait for a runner.
- All four long waits fell while full CI runs of squeal or cezarion were starting or queued (named in the table): the shared organisation pool, which D5's shards help fill. The load counts at push time did not predict them: cezarion showed 3 queued runs in fast samples too. `ci-run-triggers.md` 5 measured a queue p90 of 8.8 min when the pool was full.
- All samples are from one evening, 19:50 to 21:09 UTC (21:50 to 23:05 in Warsaw), not the busy European working day the 100-run window of the brief covered (09:34 to 14:47 UTC). Daytime waits are not determined.

## 4. What the docs did not say

- **Only the head SHA is checked** (verified). T2's range held c698121d (no run), T4's held 78e8f049 (red), T6's held e3e52d38 (dispatch only), T8's held 88c21961 (no run): all accepted. The docs' "when you update a branch, we still check all the commits in the specified range" concerns rules such as signed commits, not required checks. A docs commit batched under a checked head needs no check of its own.
- **`strict` does nothing to a direct push** (verified, T10). With `strict_required_status_checks_policy: true`, a fast-forward of green 66f28060 was accepted, and so was a forced, non-fast-forward push of green 84bb9e72 (built on 50d49901, not containing the target's head): `+ 66f28060...84bb9e72 (forced update)`. On main, `non_fast_forward` in ruleset 25176438 and git's own fast-forward check do that job; strict adds nothing.
- **The context is the job's name** (verified, T8 and T9). After the workflow's `name:` changed to `Probe 010-13 renamed`, 50d49901 was accepted under the context `probe-check`. The context `Probe 010-13 renamed / probe-check` (the form the Actions UI shows) refused green ccf2f6b0 with "Required status check "Probe 010-13 renamed / probe-check" is expected"; the same SHA was accepted a second later under `probe-check` pinned to `integration_id` 15368, the GitHub Actions app (`gh api apps/github-actions`). So any workflow in the repository with a job of that name satisfies the rule. Pinning the app keeps out commit statuses that "any person or integration with write permissions" can set (read in official docs, available rules for rulesets); posting such a status was outside this probe's writes, so not tested.
- **An empty commit starts no run under a `paths` filter** (verified). c698121d, `git commit --allow-empty`, pushed to `-src` at 19:52:33, had no run 11 min later; the next commit, touching one file, ran in 80 s. CI's `paths: ["**", "!docs/**", ...]` should behave the same (inferred), so an empty commit is no way to give a candidate a fresh SHA for a push run.
- **Untouched**: main was never pushed to, and ruleset 25176438's `updated_at` is still 2026-10-15T18:59:09+02:00 after the probe (cleanup listing below).

## Recommendation

Step two works as `ci-pr-flow.md` recommendation 4 sketched, with three corrections.

1. **The mechanism holds.** A ruleset on main with `required_status_checks` (one aggregate context, pinned to `integration_id` 15368, `strict` off since it does nothing here), and no pull-request rule, accepts a fast-forward of a SHA green in any `push` run and refuses everything else with a clear GH013 message. Main's own push run then becomes redundant and can go.
2. **D2 must become a job-level skip.** A workflow skipped by `paths` makes a SHA unlandable (T7). The workflow runs on every push it is meant to gate, docs included, and one always-reporting aggregate job is the required context; the suites skip by `if` for a docs-only change (T6 passes).
3. **D6's `gh workflow run` fallback no longer lands anything** (T5). A candidate pushed at a SHA that started no push run (status.md, the `cand/010-probe` edge probe) needs a push-triggered run some other way; an empty commit will not start one (section 4).

Cost per landing, from `ci-pr-flow.md`'s window W (16 landings) and main's first run under D1 to D5 (38794698066, about 23 job-minutes):

- **D1 to D6 today**: one candidate run plus one main run, about 46 job-minutes, for every landing.
- **Step two, reviewed SHA kept** (3 of 16): the candidate run only, about 23 job-minutes, landed at once.
- **Step two, rebased over docs only** (12 of 16): the candidate run plus one short run on the rebased SHA, about 23 job-minutes plus seconds, if the aggregate skips the suite when the diff to a green SHA is docs only (open question 1 of `ci-pr-flow.md`). Without that gate, a second full run, as today.
- **Step two, rebased over code** (1 of 16): two full runs, as today.
- **Every docs commit**: one short run before it lands, about 4 s of runner time; the wait was 10 s at the median and up to 147 s in these samples, and the 8.8 min queue p90 of `ci-run-triggers.md` when the pool is full. Main took a docs push every 156 s at the median in W, so a docs commit that waits a minute will sometimes find main moved, rebase and wait again (inferred). That retry, not job-minutes, is step two's real price.

The `version` job has to move from main pushes to candidates and docs pushes (`origin/main..HEAD`) when main's push run goes (inferred; not probed). `docs/process.md` step 5 ("docs land directly") and step 6 (the rebase before landing) would change as `ci-pr-flow.md` set out.

## Open questions

- Daytime waits under a full pool. Not determined: every sample is from one evening. A day's samples from the next waves' own docs pushes, once step two runs, would settle it.
- Whether a commit status posted through the API (not a check run) satisfies an unpinned context. Not determined, because posting statuses was outside the writes this topic allowed; the docs say it does, which is why the recommendation pins the app.
- How a candidate whose SHA already sits on another branch gets a `push` run under step two. Not determined; the coordinator's choice (push `cand/*` before any other branch, or amend the candidate's commit).

## Cleanup

Ruleset 25193915 deleted, then the three branches, 2026-10-15 21:09 UTC (`transcript.txt`, end):

```
=== 2026-10-15T21:09:04Z gh api -X DELETE repos/hearsay-tools/squeal/rulesets/25193915
exit=0
=== 2026-10-15T21:09:05Z git push origin --delete probe/010-13-src probe/010-13-target probe/010-13-side
To https://github.com/hearsay-tools/squeal.git
 - [deleted]           probe/010-13-side
 - [deleted]           probe/010-13-src
 - [deleted]           probe/010-13-target
exit=0
=== 2026-10-15T21:09:07Z gh api repos/hearsay-tools/squeal/rulesets
[{"id":25176438,"name":"Protect main","target":"branch","source_type":"Repository","source":"hearsay-tools/squeal","enforcement":"active","node_id":"RRS_lACqUmVwb3NpdG9yec5SPFNLzgGAKXY","_links":{"self":{"href":"https://api.github.com/repos/hearsay-tools/squeal/rulesets/25176438"},"html":{"href":"https://github.com/hearsay-tools/squeal/rules/25176438"}},"created_at":"2026-10-15T18:59:09.117+02:00","updated_at":"2026-10-15T18:59:09.142+02:00"}]
=== 2026-10-15T21:09:07Z git ls-remote origin 'refs/heads/probe/*'
exit=0 (no lines: no probe branches)
=== 2026-10-15T21:09:07Z gh api repos/hearsay-tools/squeal/rulesets/25176438 --jq '{name,enforcement,updated_at,rules:[.rules[].type],bypass_actors}'
{"bypass_actors":[],"enforcement":"active","name":"Protect main","rules":["deletion","non_fast_forward"],"updated_at":"2026-10-15T18:59:09.142+02:00"}
```

The probe workflow's 17 runs stay in the Actions history under the names "Probe 010-13" and "Probe 010-13 renamed"; deleting runs was outside the allowed writes.

## Sources

- Experiments: `probes/010-13/transcript.txt` (pushes T1 to T10 with outputs and exit codes, ruleset edits), `samples.tsv`, `probe-010-13.yml`, `ruleset.json`, `probe.sh`, `sample.sh`. Runs 38797209295, 38798952010, 38799172158, 38799250034, 38799718721, 38799834321, 38800111350, 38800175898, 38800241186, 38800242827 and the sampler's seven runs (SHAs in `samples.tsv`).
- GitHub docs, fetched 2026-10-15 via `https://docs.github.com/api/article/body?pathname=…`:
  - `/en/pull-requests/collaborating-with-pull-requests/collaborating-on-repositories-with-code-quality-features/troubleshooting-required-status-checks` ("Checks from some workflow jobs are not evaluated", "Handling skipped but required checks");
  - `/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets` (required status checks, strict and loose, app source);
  - `/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches`.
- GitHub API: `repos/hearsay-tools/squeal/rulesets` (create, update, delete of 25193915 only), `…/commits/<sha>/check-runs`, `…/commits/<sha>/check-suites`, `…/actions/runs?head_sha=…`, `…/actions/workflows/probe-010-13.yml/runs`, `apps/github-actions`; run lists of squeal's CI and cezarion for 19:20 to 21:10 UTC.
- `research/ci-pr-flow.md`, `research/ci-run-triggers.md`, `status.md` and `.github/workflows/ci.yml` at origin/main 8a0c5065.
