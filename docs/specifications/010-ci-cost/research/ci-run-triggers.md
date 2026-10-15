# ci-run-triggers: which CI runs are redundant, and what removes them

Researcher, Opus 5.5, 2026-10-15. Read-only on GitHub. Window: all 951 runs of workflow `CI` (id 374500850) created 2026-10-12 05:41 to 2026-10-15 14:47 UTC (81 h), with the jobs of every attempt (`gh api .../actions/runs/<id>/jobs?filter=all`), 2,871 jobs. A job-minute is one job's `completed_at - started_at`. Queue is run `created_at` to its first Node job's `started_at`. "Docs-only" means every file in the two-dot diff from the branch's previous run (or, for a branch's first run, from its nearest already-tested ancestor) is under `docs/` and none under `docs/**/probes/**` (`test/cli/codex-hash.test.ts:19` reads a probe log). The classification scripts are not committed; they ran against the API JSON in a scratch directory.

## Questions answered

| # | Question | Answer |
| --- | --- | --- |
| 1 | Classes of the last 3 days | 951 runs, 27,790 job-min. By branch: main 560, cez/* 316, cand/* 49, exp/* 19, hold/* 4, other 3. Docs-only 594 (17,346 job-min). Same SHA already run elsewhere 272 (7,604), none with a finished green run when it started. Superseded 670 (19,676). Only 117 runs (3,633 job-min) fall in none of these classes. |
| 2 | Who pushes cez/exp/hold, who reads their CI | Coordinators, under one credential. No step of the process reads their CI. It reads `cand/*` CI and main's last landing. |
| 3 | Mechanism semantics | `branches` and `paths` filters create no run at all. `concurrency` cancels pending runs even without `cancel-in-progress`. An API "already green" check would have skipped 0 runs. The third-party action needs `actions: write`. |
| 4 | The `version` job | Cancelling main runs drops its check for the cancelled push's range. Path and branch filters drop nothing. |
| 5 | Concurrency limit | The Free plan allows 20 concurrent jobs. Squeal's jobs queue while the organisation-wide count, cezarion included, sits at 20. Squeal used 69% of the shared job-minutes. |

## 1. Classification (verified by experiment: measured from the run record)

| Class | Runs | Job-min | Queue p50 / p90 (min) | Failed |
| --- | --- | --- | --- | --- |
| main | 560 | 16,410 | 0.1 / 15.9 | 86 |
| cez/* | 316 | 8,837 | 0.1 / 3.5 | 88 |
| cand/* (19 branches) | 49 | 1,891 | 0.7 / 5.5 | 7 |
| exp/* | 19 | 425 | 0.1 / 0.1 | 17 |
| hold/* | 4 | 138 | 0.1 / 0.7 | 3 |
| other (tags `squeal--v0.1.131`, `squeal--v0.1.168`; `wip/cand-185-base`) | 3 | 89 | 0.1 / 1.6 | 1 |
| Docs-only vs the branch's previous run (main 429, cez 156, cand 6, exp 3) | 594 | 17,346 | 0.1 / 12.4 | 106 |
| SHA already run on another ref (cez→main 150, main→cez 104, cand→cez 9, cand→main 3, main→main 3, other 3) | 272 | 7,604 | 0.1 / 6.8 | 57 |
| ...whose earlier run was green by the time this one was created | 0 | 0 | | |
| ...whose earlier run was green at any time | 226 | 6,277 | | |
| Superseded: a newer push to the same branch arrived before it finished (main 494, cez 163, cand 9) | 670 | 19,676 | 0.1 / 12.4 | 121 |
| None of docs-only, duplicate or superseded | 117 | 3,633 | 0.1 / 2.5 | |

- Duplicate pairs are created 1 s apart at the median (p90 3 s, max 77 s), so neither run of a pair has finished when the other starts. Example: runs 38209078365 (`cez/87218933`) and 38209079948 (`main`), same SHA, same second. 24 duplicate runs ended with a different conclusion from the earlier run of their SHA (e.g. 38223426144 success, 38230186654 failure), which marks those tests as flaky.
- Docs-only runs re-test code that is already tested, yet 106 of 594 (18%) failed. Example: run 38230186654, `docs(005): the human keeps 005 held`.
- Main receives a push every 136 s at the median (p25 30 s, p75 538 s). A run takes about 15 min, so 494 of 560 main runs were overtaken before they finished.
- Rates changed with the process. After 2026-10-14 22:38 UTC (commit 81f80792, review before main), 255 runs in 16.2 h: main 156, cand 48, cez 46, hold 4. That is 572 job-min/h, against 286 job-min/h before.
- What would remain under these filters (whole window, then post-81f80792):
  - Pushes to `main` and `cand/**` only: 609 runs, 18,301 job-min. Post-81f80792, 460 job-min/h.
  - Plus skipping docs-only pushes: 174 runs, 5,352 job-min (−81%), split main 131 and cand 43. Post-81f80792, 150 job-min/h.
  - The docs-only filter alone on every branch: 357 runs, 10,444 job-min.

## 2. Who pushes, who reads

- Every run's `actor` is `wjarka`: all sessions push with one credential, so the record cannot tell sessions apart (verified, run record).
- **cez/***. These are Cezar task branches. Each `cez/<id8>` branch is the worktree branch of one task. The three busiest are coordinator sessions: `cez/32f44487` (spec 005 coordinator, 90 runs), `cez/49978180` (86) and `cez/2ab5b448` (52). Their handoffs are in `.ai/cezar/runs/<id>.handoff.md`.
  - The coordinator skill told them to push both refs until commit 81f80792 (2026-10-14 22:37 UTC): `git push origin <branch> && git push origin HEAD:main` (read in source code). This explains the 1-second cez/main pairs. Session transcripts quote that line 188 times.
  - 46 cez runs came after the change, on `cez/2841c17b`, `cez/2ab5b448` and `cez/49978180`. Sessions started before the edit keep the old text, so the old pushes continue (inferred).
  - Cezar also pushes the task branch from the cockpit (`dist/server/git-changes.js:549`) and when it opens a PR (`dist/server/forge/github.js:2440`, installed cezarion; read in source code).
- **exp/***. Coordinators push the eval arms of 001-292 (`docs/specifications/001-core-loop/status.md:224-227`; transcripts show `git push -q origin HEAD:refs/heads/exp/...`). 17 of 19 runs failed and no one reads them.
- **hold/***. The 008 coordinator parks worker branches there (`git push -q origin hold/008-24`).
- **What the process reads** (read in source code):
  - The `cand/<version>` branch CI before landing (`docs/process.md` step 5).
  - Main's last landing, through `gh run list --branch main --limit 3` (`.agents/skills/coordinator/SKILL.md:52`). A red run blocks the next landing.
  - Nothing reads cez/*, exp/*, hold/* or tag runs. The memory note "read branch CI by test name" concerns the integration branch, which is `cand/*` now.
  - With docs-only runs on main, those last three runs are mostly docs runs. Their 18% failure rate can block a landing with a flake on code that is already tested (inferred).

## 3. Mechanisms

Read in official docs (docs.github.com workflow-syntax, fetched 2026-10-15) unless tagged otherwise.

- **`branches`**. "If you set only branch filters ... the workflow won't run for events affecting the undefined Git ref." A `branches:` list therefore also stops tag-push runs, 2 in the window.
  - A push uses the `ci.yml` of the pushed commit: the push trigger "includes workflows that are not merged into the default branch" (events-that-trigger-workflows). Old branches therefore keep the unfiltered trigger until they are rebased (inferred).
- **`paths` and `paths-ignore`**.
  - "When all the path names match patterns in `paths-ignore`, the workflow will not run." To re-include `docs/**/probes/**`, use `paths` with `!`, where "a matching positive pattern after a negative match will include the path again". The two keys cannot be combined.
  - Diff base. Existing branches: "A two-dot diff compares the head and base SHAs directly with each other". A force push is the same two-dot diff against the replaced tip; the docs do not name force pushes. New branches: "A two-dot diff against the parent of the ancestor of the deepest commit pushed."
  - "If there are no files changed, the workflow will not run." Limits: "more than 1,000 commits ... **always** run". A diff timeout always runs. "More than 3,000 files and the files the workflow filter matches are not in the first 3,000 ... will **not** run."
  - What a skip shows: the docs say only that associated checks "remain in a 'Pending' state", which matters for required checks (main has no branch protection). The run record holds no entry at all.
    - Verified in the record. Cezarion's `CI` is branch-filtered to main. Branches `ci/review-inside-ci` and `feat/cez-automation-cli` had commits on 2026-10-15 and only `pull_request*` runs, and all 32 cezarion push runs are on main. So `gh run list` simply has no row.
- **`concurrency`**.
  - "By default, any existing `pending` job or workflow in the same concurrency group will be canceled", even without `cancel-in-progress`. `queue: max` keeps up to 100 pending runs, and "The combination of `queue: max` and `cancel-in-progress: true` is not allowed".
  - The group can be per ref (`${{ github.workflow }}-${{ github.ref }}`). `cancel-in-progress` accepts an expression, e.g. `${{ github.ref != 'refs/heads/main' }}`, and can be set per job (`jobs.<job_id>.concurrency`).
  - A cancelled run has conclusion `cancelled` and its jobs show `X` in `gh run view`. Verified on cezarion run 38738816302, which cancel-in-progress cancelled.
  - Effect here (verified, run record): cancelling superseded runs would have saved 15,655 job-min, of which main 11,985, cez 3,415 and cand 155. On main it would cancel landings.
    - Simulated with a fixed 20-minute duration, only 49 of 560 main runs would have finished (inferred).
    - Even with docs-only pushes skipped, 43 of 131 code runs on main were overtaken by the next code push.
    - The newer run tests a superset, but `--limit 3` would then show `cancelled` rows where the landing's result belongs.
- **Skipping an already-tested SHA**.
  - A first job that asks the Runs API for a green run on `github.sha` would have skipped 0 of 272 duplicates (verified, run record): both runs of a pair start within seconds.
  - `fkirc/skip-duplicate-actions` v5.3.2 (2026-07-19, tag commit b974a939; README read at that tag) matches runs by tree hash. Its `concurrent_skipping: same_content_newer` "ensures that at least one of those workflows will run".
    - It needs `permissions: actions: write` and puts a third-party action, pinned or not, in a job that holds that token.
    - Its `paths_ignore` looks back for "successful checks in your commit-history". A skipped job still produces a run row, unlike a native filter.
  - Restricting the trigger to `main` and `cand/**` removes 266 of the 272 duplicates by itself. The remaining 6 are 3 cand→main and 3 main→main.

## 4. The `version` job (read in source code, `ci.yml:40-58`, `scripts/check-version-bump.ts`; consequences inferred)

The job runs only on `pull_request` or main. It compares `github.event.before..HEAD` over the four `plugins/*/dist` trees.

- **Path filter**. It loses nothing. A skipped push changes only `docs/`, so the next run's range starts at a docs commit whose bundles equal the last code commit's.
- **`branches` filter**. Unaffected, since main stays in the trigger.
- **`cancel-in-progress` on main**. It loses the check: a cancelled push's range is never compared. A later docs push then compares bundles that are equal and passes.
  - Two ways to keep it: leave the `version` job outside any cancelling group (job-level concurrency on `check` only), or compare against the head SHA of main's last successful run instead of `before`.
- **Duplicate-skip gate**. Any gate over the whole run would also skip `version` on main, so it must stay ungated.
- `cand/*` pushes never run `version`. The coordinator runs `npm run check:version -- origin/main` locally (coordinator skill section 6).

## 5. The concurrency limit

- Read in official docs (limits page): standard GitHub-hosted runners, Free plan, "Total concurrent jobs" 20. "GitHub Support **can** increase job concurrency limits".
- `gh api orgs/hearsay-tools` shows plan `free`. Runner and billing endpoints need `admin:org` and were not readable.
- Shared with cezarion (verified, run record). From 2026-10-13 09:00 UTC (the start of cezarion's last 1,000 runs) for 53.8 h:
  - Job-minutes: Squeal 23,479, cezarion 10,498. Cezarion's CI fans out about 12 jobs per run, and earwitness had 1 run.
  - Squeal's queue: 321 of 1,916 Node jobs queued over 5 min (p90 8.8, p99 55, max 72 min).
  - Of the 300 of those inside the window, the combined running count at mid-queue had median 20 and minimum 19. Squeal alone at those moments ran anywhere from 2 to 20 jobs. That fits one organisation-wide pool of 20.
  - The combined count was at or above 20 for 25.6% of the window (13.8 h). It peaked at 38 at 2026-10-14 23:41 UTC (34 cezarion, 4 Squeal), which a hard cap of 20 does not explain.

## Recommendation

1. Trigger `push` on `main` and `cand/**` only, which also stops tag runs. That cuts 342 runs and 9,489 job-min (34%) that nothing reads, and 266 of the 272 duplicate runs.
2. Skip docs-only pushes with a `paths` list: everything, minus `docs/**`, with `docs/**/probes/**` re-included. With (1), 174 runs and 5,352 job-min remain of 27,790 (−81%). After the review-before-main change, the rate falls from 572 to about 150 job-min/h.
   - What it loses: flake reports on already-tested code (106 red docs runs).
   - What it gains: `--limit 3` on main shows code runs only.
3. Cancel superseded runs on `cand/*` only (`cancel-in-progress` as an expression on a per-ref group). Do not cancel on main, and do not put main in a group at all: the default would still cancel its pending runs. It saves little (155 job-min) but costs no signal.
4. Do not add a duplicate-SHA gate or `skip-duplicate-actions`. The duplicates were concurrent, (1) removes them, and the action needs `actions: write` from a third party.
5. Keep `version` ungated and outside any cancelling group. Under (1) to (3) it loses no range.

Wave-0 measurement, after (1) and (2) land, over 3 days:
- runs and job-minutes per day;
- Squeal Node job queue p90;
- that every `cand/*` push got a run.

Also stop the cez/main double push in long-lived coordinator sessions: their skill text predates 81f80792.

## Open questions

- **The binding cap.** The combined peaks of 38 contradict a hard limit of 20. Reading the real limit needs `admin:org` or a support answer.
- **New branches on existing commits.** A new branch whose tip commit is already on GitHub (a `cand/*` pushed at a SHA a `cez/*` already carries) has an undocumented new-branch diff. Under "no files changed", it may not run at all. None of the 49 cand runs had a SHA that had already run. Wave 0 should check it, or the process should keep candidate commits new.
- **The landing re-test.** Main's landing run repeats the candidate's tests whenever the commits since are docs only (48 cand runs post-81f80792). No GitHub mechanism reuses a result across differing trees. Whether a docs-only rebase may inherit the candidate's verdict is the human's process call.
- **The pull_request trigger.** It created 0 runs in the window, so keeping or dropping it is not evidenced here.
- **Old branch heads** keep firing the unfiltered workflow until they are rebased. How many stay alive is unmeasured.

## Sources

- GitHub docs, fetched 2026-10-15 through `https://docs.github.com/api/article/body?pathname=...`:
  - `/en/actions/reference/workflows-and-actions/workflow-syntax` (branches, paths, Git diff comparisons, `concurrency`, `jobs.<job_id>.concurrency`);
  - `/en/actions/reference/limits`;
  - `/en/actions/how-tos/manage-workflow-runs/skip-workflow-runs`;
  - `/en/actions/reference/workflows-and-actions/events-that-trigger-workflows` (push);
  - `/en/actions/concepts/billing-and-usage`.
- `fkirc/skip-duplicate-actions` README at tag v5.3.2: https://github.com/fkirc/skip-duplicate-actions/tree/v5.3.2
- GitHub API, read-only:
  - `repos/hearsay-tools/squeal/actions/workflows/374500850/runs?created=>=2026-10-12`, with the jobs of each run;
  - `repos/hearsay-tools/cezarion/actions/runs` (latest 1,000), with jobs, and `contents/.github/workflows/ci.yml`;
  - `orgs/hearsay-tools`, `orgs/hearsay-tools/repos`.
  - Runs cited: 38209078365, 38209079948, 38223426144, 38230186654, 38372081991, 38684898492, 38701404825, and cezarion 38738816302.
- Repository at 811efaed:
  - `.github/workflows/ci.yml`, `scripts/check-version-bump.ts`, `test/cli/codex-hash.test.ts`, `biome.json`, `tsconfig.json`, `vitest.config.ts`;
  - `docs/process.md`, `.agents/skills/coordinator/SKILL.md`, and commit 81f80792 (coordinator push line);
  - `docs/specifications/001-core-loop/status.md:224-227`.
- Installed cezarion: `dist/server/git-changes.js`, `dist/server/forge/github.js`. Coordinator session transcripts under `~/.claude/projects/-home-agent-projects-squeal*/`.
