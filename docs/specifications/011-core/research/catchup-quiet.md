# 011-416: a shorter catch-up quiet for a large backlog

Researcher of row 011-416, 2026-11-19. Brief: `research/catchup-quiet-brief.md`. Read: `docs/vision.md`, `docs/styleguide.md`, `research/stored-nothing.md` finding 4 (row 011-153, where the 120 s came from), `research/broad-change-throughput-2.md` (row 011-400, where the 13% came from) and its probes, and the Squeal source named below at `7d02e6671` (0.1.570). Probes: `research/probes/catchup-quiet/`.

**Records.** Copies of the squeal and cezar stores and their run reports, taken at 21:42Z (README there). The stores keep revisions of live worktrees only, so the window is what the live worktrees hold: squeal 2026-11-16 21:27Z to 11-19 21:26Z (3 days), cezar 2026-11-15 23:53Z to 11-19 20:58Z (4 days).

**Lab VM.** The 12-vCPU lab VM (the shared notes' topic note), 2026-11-20 03:39Z to 05:54Z, after the coordinator's go; no other task on it (`arm.sh` checks `~/work` and the process list before each edit and waited for a one-minute load under 1). Load before each edit: 0.63 to 0.99; busy cores in the 15 s before it 0.03 to 0.08, except the first run's 2.55 (a fresh daemon's start). Squeal **0.1.570** with one changed line per copy (`CATCHUP_QUIET_MS = 12e4` → `60e3`, `30e3`; `vm/results/sha256.txt`), squawk at `c11e4edf0`, Vitest 4.1.10, Node 26.13.0, the run-loop group held as 011-400's H0. Work directory `~/work/8fdf8a51`, removed at 05:55Z with no process left.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Gaps between edits during agent turns | Between edits before a catch-up start (revisions that reach a test file): squeal 265 gaps, **69% under 30 s, 11% 30 to 60 s, 5% 60 to 120 s**; cezar 765 gaps, **52%, 19%, 17%**. The rest were 120 s or more with nothing queued yet | verified by replay of records |
| 2 | Backlog at each catch-up start | squeal: 16 catch-ups started after a quiet, **11 with more than 200 files** (216 to 1,249). cezar: 42, **3 with more than 200** (219 to 293), 4 more with 100 to 200, most with 1 to 90 | verified by replay of records (lower bound for 7 catch-ups a later edit cut) |
| 3 | Time saved and CPU wasted per quiet and threshold | **30 s above 200 files**: squeal's 11 large catch-ups each start 90 s sooner (990 s in 3 days) for at most 787 file-s wasted (2.8% of their 27,625 file-s); cezar's 3 start 90 s sooner (270 s) for none. **60 s above 200**: 60 s sooner each, at most 415 file-s (1.5%) and none. With no threshold, cezar's 42 catch-ups waste 1,001 (60 s) and 2,175 file-s (30 s): the threshold removes all of it | verified by replay of records (model) |
| 4 | The 011-395 broad edit at 120, 60 and 30 s | 892 files each run. Last result after the edit: **120 s: 821 and 827 s; 60 s: 856 and 743 s; 30 s: 765 and 746 s**. 30 s gives results **69 s sooner (8%, 56 to 81 s)** with no more CPU (5,271 and 5,276 CPU-s against 5,728 and 5,755); 60 s gives 25 s on average, inside its own runs' 113 s spread. With a second edit 150 s after the broad one (one run each), 30 s cut a 93-file tier (68 files) and finished **49 s later with 1,327 CPU-s more** than 120 s | verified by experiment (n = 2 per quiet; n = 1 for the second-edit runs) |
| 5 | Recommended rule | Catch-up waits **30 s instead of 120 s when its lane's queued catch-up holds more than 200 test files** at the moment the wait starts or starts again; 120 s otherwise. It pays modestly: about 70 s on each broad change the agent leaves alone, against a cancel's cost when the agent edits again 30 to 120 s later, which the records show is rare with such a queue (23 times in squeal's 3 days, never in cezar's 4) | inferred from 1 to 4 |

## 1. Gaps between edits

`bursts.mjs` reads, per live worktree, the watch revisions whose changed paths reach a test file (a stored closure, the path itself, or a declared input of `squeal.config.json`; editor scratch only is skipped, as `quietQueued` does, `src/core/scheduler/quiet.ts`). A burst is the revisions after the previous catch-up start up to the one that began the quiet before the next. Gaps inside bursts (`results/bursts-sweep.txt`, `burstGaps`, `gaps`):

| Gaps | squeal (265) | cezar (765) |
|---|---|---|
| under 30 s | 182 (69%) | 401 (52%) |
| 30 to 60 s | 28 (11%) | 146 (19%) |
| 60 to 120 s | 12 (5%) | 130 (17%) |
| 120 s or more, nothing queued | 43 (16%) | 88 (12%) |

A 30 s quiet starts catch-up in each gap of 30 to 120 s that has something queued (squeal 40, cezar 276), and a 60 s quiet in each gap of 60 to 120 s (12 and 130); the next edit then cancels the running tier (`cancelsBacklog`, `src/core/scheduler/backlog.ts:44`: an edit's work queued in the tier's lane). Cezar's agents leave more such gaps. *Verified by replay of records.*

## 2. The backlog at each catch-up start

A recorded catch-up start is a run that began 119 to 126 s after the last revision that reached a test file: the 120 s of `CATCHUP_QUIET_MS` (`src/core/scheduler/quiet.ts:28`) plus the 1 s recheck and the tier pick. Its episode is every run from it until the next revision; F, the files they held, is the backlog then (a lower bound when the next edit cut the episode, 7 of the 14 large ones). `results/bursts-<repo>-30@200.jsonl`:

- squeal (16 starts): F = 437, 364, 216, 330, 297, 452, 1,249, 404, 1,083, 768 and 679 files; 5 with 8 to 92. The large ones ran 501 to 7,793 s (median 1,232 s) at 0.3 to 2.0 files at once on this loaded host.
- cezar (42 starts): F = 266, 219 and 293 files; 4 more with 100 to 200; the rest 1 to 90.
- New failures in the large ones (`fails.mjs`, `results/fails-*.jsonl`): 4 of 14 found one, first at 130, 1,161, 3,355 and 4,985 s after the start. A shorter quiet moves each by 120 − Q' s.

*Verified by replay of records.* The histogram of every run's time since the last edit (`results/episodes-*.hist.txt`) shows the spike at 119 to 126 s: squeal 24, cezar 72 runs.

## 3. Time saved and CPU wasted

The model (`bursts.mjs` header; inferred from `quiet.ts`, `refinement.ts:278-299`, `edit-cut.ts`, `backlog.ts`, `revision.ts:82`):

- **Saved.** In a catch-up whose queue holds more than N files, the start comes 120 − Q' s sooner, and with it each result.
- **Wasted, gap inside a burst.** Each gap g of Q' to 120 s with more than N files queued starts catch-up for g − Q' s at the episode's rate p; the next edit cancels it. The share ρ of the queue that later edits of the burst re-key is wasted; of the rest only the files in flight, p × min(g − Q', median file) / 2.
- **Wasted, the sooner start.** When the next edit cut the episode, the extra (120 − Q') × p file-s are wasted for the share of F that revisions of the next 2 hours re-key.

ρ comes from the stored closures, which count a re-key even when another worktree already stored the new key, so the waste is an upper bound. One lane per worktree. *Verified by replay of records (model).*

| Rule | squeal: large catch-ups, sooner in total | early starts in gaps | waste, file-s | cezar: large, sooner | early starts | waste |
|---|---|---|---|---|---|---|
| 120 s (today) | 0 | 0 | 0 | 0 | 0 | 0 |
| 60 s above 200 | 11, 660 s | 7 | ≤ 415 | 3, 180 s | 0 | 0 |
| **30 s above 200** | **11, 990 s** | **23** | **≤ 787** | **3, 270 s** | **0** | **0** |
| 30 s above 100 | 11, 990 s | 23 | ≤ 787 | 7, 630 s | 5 | ≤ 116 |
| 30 s above 500 | 4, 360 s | 13 | ≤ 245 | 0 | 0 | 0 |
| 60 s always | 16, 960 s | 12 | ≤ 1,052 | 42, 2,520 s | 121 | ≤ 1,001 |
| 30 s always | 16, 1,440 s | 40 | ≤ 2,158 | 42, 3,780 s | 256 | ≤ 2,175 |

At 0.32 to 0.59 CPU-s per recorded second (`stored-nothing.md` 4), squeal's ≤ 787 file-s at 30 s above 200 are ≤ 250 to 460 CPU-s in 3 days, against 27,625 file-s those 11 catch-ups ran. The threshold is what keeps the 120 s's saving (row 011-153: 540 to 1,360 CPU-s per repository in 72 h): without it, cezar's frequent small catch-ups waste 1,001 to 2,175 file-s, as `stored-nothing.md` 4 found for 60 s (cezar 1,677 → 447 s saved). Between 100 and 200 files the choice moves only cezar's 4 middle catch-ups.

What a sooner start is worth: 90 s is 1.2 to 18% of a large squeal catch-up's wall (median 7%), and 10% of 011-400's H0 (902 s, `broad-change-throughput-2.md` 1). 60 s is two thirds of that.

## 4. The broad edit on the lab VM

`vm/run-all.sh` ran eight arms, one after another, each a fresh daemon on the warmed clone, one edit of `packages/contract/src/ci-wait.ts`. `vm/arms.mjs` reads their timelines (`vm/results/arms.jsonl`; seconds after the edit):

| Arm | Catch-up start | Last result | CPU-s (scope) | Vitest file-s | Tiers | Files cut |
|---|---|---|---|---|---|---|
| Q120a | 162.6 | 821.1 | 5,728 | 4,711 | 14 | 0 |
| Q60a | 103.3 | 855.8 | 6,306 | 5,273 | 26 | 0 |
| Q30a | 82.5 | 764.7 | 5,271 | 4,269 | 28 | 0 |
| Q30b | 62.8 | 745.6 | 5,276 | 4,211 | 26 | 0 |
| Q60b | 95.9 | 742.5 | 5,056 | 4,207 | 21 | 0 |
| Q120b | 154.9 | 827.1 | 5,755 | 4,823 | 16 | 0 |
| F30 (second edit at 150 s) | 70.9 | 907.3 | 6,610 | 5,708 | 19 | 68 |
| F120 (second edit at 150 s) | 277.0 | 858.4 | 5,283 | 4,469 | 14 | 0 |

- **The quiet moves the start as designed.** The catch-up began 120, 60 or 30 s after the edit's first tier started (`refinement.ts:298`, `quietCaughtUp` after the runner part); at 30 s that falls when the edit's own three tiers end (57 to 82 s), so it started as they ended. *Verified by experiment.*
- **30 s: 69 s sooner, not 90.** It started 80 to 92 s sooner, but took 682 and 683 s from start to the last result against 659 and 672 s at 120 s: about 17 s more, while it ran beside the node:test lane, which ends at 222 to 261 s in every arm. *Verified by experiment; cause inferred.*
- **No CPU cost without a second edit.** CPU follows the Vitest file-seconds, which vary from run to run by up to 1,066 file-s (Q60a against Q60b, the same quiet). The 30 s runs are the two lowest of the six. *Verified by experiment.*
- **60 s is not separable from noise at n = 2.** Q60a ran 12% more file-seconds than the 120 s mean, and 11 four-file tiers beside its second wide one; Q60b was the fastest arm. *Verified by experiment; the cause of Q60a's slow run not determined.*
- **A second edit 150 s later (F30, F120).** At 30 s the catch-up had run one 200-file tier and was 49 s into a 93-file one when the edit came; the tier stopped with 25 files done and 68 cut (`backlog.ts:44`, an edit's work queued in the lane). Catch-up began again at 190 s (the second edit's tier at 160 s, plus 30 s), and the last result came at 907 s, against 858 s at 120 s, with 1,327 CPU-s more. The cut tier alone bounds the work lost at about 49 s × 9 files at once, 440 worker-s (inferred); the rest is the same per-file-time spread the Q pairs show. So the second edit took the 30 s quiet's whole gain at n = 1, and its CPU cost is between 0 and about 1,300 CPU-s. *Verified by experiment (n = 1); split inferred.*


## Recommendation for Squeal

**A 30 s catch-up quiet when the lane's queued catch-up holds more than 200 test files when the wait starts or starts again; 120 s otherwise.** Evidence: on the VM a broad edit's last result comes 56 to 81 s sooner (8%) with no more CPU; in the records 11 of squeal's 16 catch-ups and 3 of cezar's 42 had such a queue, and the early starts it adds inside an agent's edits cost at most 787 file-s in 3 days (squeal) and none (cezar). The tradeoff that decides it: each time the agent edits again 30 to 120 s after a broad change, the early catch-up is cut, and that one edit can cost the whole gain and up to about 1,300 CPU-s (F30, n = 1). The records say that is rare with a large queue: squeal's agents left 23 such gaps in 3 days, cezar's none. A product row should state the count, the moment it is read (`BacklogQuiet.caughtUp` and `queued`, `src/core/scheduler/quiet.ts`), and test both quiets on one lane.

Not recommended: 60 s (its gain is inside its own noise here) and any shorter quiet without a threshold (cezar's small catch-ups would waste 1,001 to 2,175 file-s in 4 days, most of what the 120 s saves).

If the human weighs 70 s per broad change as too little for a second number in the scheduler, keep 120 s: the data allow either, and the larger costs of a broad change are elsewhere (`broad-change-throughput-2.md`: tier width and per-file time).

## Open questions

- The count the rule reads: the lane's queued catch-up files when the wait starts or starts again (`BacklogQuiet.caughtUp` and `queued`) is the natural point; whether a lane that runs its backlog in slots (it never waits, `quietCaughtUp`) needs anything is not determined.
- A daemon's queue after its start or a pull (catch-up revisions of 10 or more keyed paths) starts no wait today (`revision.ts:82`); unchanged by this rule.
- The second-edit cost rests on one run per quiet; repeating F30 and F120 (about 35 min on the VM) would split the cut's cost from per-file noise.
- The records hold 3 to 4 days of live worktrees only: removed worktrees lose their revisions (`stored-nothing.md` 4 said the same). 14 large catch-ups is a small sample; the waste bound is the sturdier number.

## Sources

- Squeal source at `7d02e6671` (0.1.570): `src/core/scheduler/quiet.ts` (`CATCHUP_QUIET_MS`, `BacklogQuiet`, `quietQueued`, `quietCaughtUp`), `refinement.ts:255-330`, `edit-cut.ts:60-170`, `backlog.ts:1-60`, `decide-yields.ts:200-225`, `yields.ts:150-165`, `store-decision.ts:24-161`, `revision.ts:60-110`, `editor-scratch.ts`.
- Records: copies of `~/projects/squeal/.git/squeal/store.sqlite` and `~/projects/cezar/.git/squeal/store.sqlite` (with `-wal`, `-shm`) and their `runs/*/report.json`, 2026-11-19 21:42Z; `squeal.config.json` of both repositories.
- `research/stored-nothing.md` 4 and `probes/stored-nothing/catchup.mjs` (the 120 s's saving), `research/broad-change-throughput-2.md` 1 (the 13%), `probes/broad-change-throughput-2/` (the VM probe this one copies).
- VM runs: `probes/catchup-quiet/vm/results/` (per arm `arm.txt`, `load.txt`, `edits.tsv`, `tsv`, `queue.tsv`, `workers.tsv`, `timeline.json`, `tiers.json`, `refusals.json`, `status-*.txt`; `arms.jsonl`; `sha256.txt`).
