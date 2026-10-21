# 011-68: the shipped yield rule on cezar's recorded runs (011-51's test 10)

Researcher R1 of 011 wave 8, 2026-10-21, worktree `cez/304a4d78` at 5824e355 (the wave 8 brief R1). Read: `docs/vision.md`, `docs/styleguide.md`, board rows 011-68, 011-51 and 011-54, `research/running-tier-yields.md` (questions 3 and 4, the replay's method), `probes/running-tier-yields/mid-tier.mjs`, spec 011 C4 step 5 and C15 as amended 2026-10-21, `013-vitest-runner/research/issue-62.md`, and the shipped rule in `src/core/scheduler/yields.ts` and `tiers.ts` at tag `squeal--v0.1.237`.

Load and isolation: **no live check ran.** The one-minute load was 18.9 to 45.8 on 24 CPUs during the session (16:45 to 17:05 local, `/proc/loadavg` and `sar -q`), and 13.9 to 67.1 in every ten-minute sample since 14:00 local. Today it was below 8 only from 00:50 to 08:50 local (33 samples). Every number is a replay of recorded data, read only: cezar's store, copied once through a `readOnly` connection at 14:53:13Z (6,426 runs, 2026-10-14T19:55Z to 10-21T14:53Z); cezar's run logs (`report.json`); the named `squeal status --wait` calls in cezar's Claude Code and Codex transcripts (1,000 naming a test path). Probes: `probes/yields-replay/` (README lists each).

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | The three rules on cezar | 352 revisions and 131 named-wait episodes landed during a fast Vitest tier in 6.7 days. Named wait behind the tier: p50 71 s, p90 344 s, total 16,672 s under 0.1.236; p50 3 s, p90 77 s, total 4,174 s under 0.1.237 and 011-54 alike. The named verdict p50 falls from 430 s to between 82 s and 307 s (two models). 0.1.237 cuts 118 files by supersession and 198 by yields (15,719 file-seconds run again); 011-54 cuts 131 and 195 | verified by replay (model) |
| 1' | The shipped rule live | Cezar's 0.1.237 and 0.1.238 daemons, 13:05Z to 14:53Z: 11 tiers of up to 4 files had an event. 6 were cancelled (3 supersessions, 3 yields), 1 was refused by the one-cut mark. The model decides all 11 as the daemons did. Event to run end p50 1.3 s, p90 7.7 s (n 6), at load 17 to 46 | verified from the store |
| 2 | The duration source | The scheduler's estimate is Vitest's module duration (ratio 1.000 over 22,723 file runs). A one-file run's wall exceeds it by p50 0.47 s, p90 0.97 s, max 3.18 s for files of 30 s or more. Neither source changes any of the 203 yield decisions at 30 s | verified by replay |
| 3 | The live check | Not run: the load was 18.9 to 45.8 during the session, never below 8 | not determined, because of load |
| 4 | Whether 30 s holds | Yes. 60 s throws away 17% less work (12,983 against 15,719 file-seconds) for 4% more edit wait in total, a named-verdict p50 45 s later in the optimistic model, and none in the conservative one. 15 s gains 100 s of edit wait for 920 file-seconds more | verified by replay (model) |

## 1. The three rules, replayed

Method, as `running-tier-yields.md` finding 4, with three changes. (a) Supersession is cumulative: the revisions during a tier's run re-key files one after another, as `Tier.changes` collects them. (b) A yield's mark on a file ends when its key moves or a later run of it ends with its module, as `#forget` does; the earlier replay never ended a mark. (c) The window is every tier started before 0.1.237's release (12:53:22Z), so the recorded timeline is 0.1.236's (the tag's commit time; cezar's first 0.1.237 daemon started at 13:05:14Z). The rules (*read in source code*, `yields.ts` at `squeal--v0.1.237`):

- **0.1.236**: an edit's tier runs to its end; a backlog tier is cancelled as recorded.
- **0.1.237**: cancel when the revisions during the run re-keyed every file of the tier, ended ones included. Otherwise, while an edit's work, a promoted file or a recreate waits, yield when the largest last-known duration among all its files, less its elapsed time, exceeds 30 s, once per file and key.
- **011-54**: as 0.1.237, but supersession needs only the files whose module has not ended. **011-54u**: the remainder over the unfinished files too (the wording row 011-54 would restore).

A file has ended when its recorded module duration is at most the elapsed time, in a tier of at most 23 files (cezar's `maxWorkers`, all start at once). Tier kind is not stored: a tier of more than 4 files or a checkpoint's counts as the backlog's. The backlog's turn cannot be told apart, so the model lets it yield (*inferred*). The cancel costs 3.1 s (`running-tier-yields.md` 1).

| Rule, at 30 s | Free cancels (files cut) | Yields (files run again; file-s; lane-s run again) | Edit's wait for the tier p50 / p90 / total | Named wait behind the tier p50 / p90 / total | Named verdict p50 / p90: shift; next |
|---|---|---|---|---|---|
| 0.1.236 | 0 | 0 | 45.6 / 489 / 49,702 s | 71.4 / 344 / 16,672 s | 430 / 3,577 s |
| 0.1.237 | 54 (118) | 81 (198; 15,719; 9,126) | 3.1 / 29.8 / 10,589 s | 3.1 / 76.5 / 4,174 s | 307 / 3,577; 82 / 731 s |
| 011-54 | 58 (131) | 80 (195; 15,639; 9,100) | 3.1 / 13.7 / 10,276 s | 3.1 / 76.5 / 4,174 s | 307 / 3,577; 82 / 731 s |
| 011-54u | 58 (131) | 77 (190; 15,202) | 3.1 / 29.1 / 10,844 s | 3.1 / 76.5 / 4,236 s | 307 / 3,577; 82 / 787 s |

**The named verdict** has two models, and the truth lies between them. *Shift*: the recorded verdict less the blocking-tier time the cancel saves; what ran after the tier still runs. *Next*: the named file runs right after the cancel. Most of a recorded verdict is not the blocking tier: 17 of 131 episodes waited over 1,800 s, behind timeouts and the named file's own long tier. By the tier behind it: 84 episodes behind a tier of up to 4 files went from p50 429 s to 231 s (shift) or 72 s (next); 47 behind a backlog-sized tier from 469 s to 469 s or 278 s.

**What each rule cuts** (0.1.237 at 30 s; `results/replay.txt`). All 54 free cancels hit tiers of up to 4 files: they free 7,394 lane-seconds and lose no valid work. Yields to an edit's work: 28 tiers, 85 files, 2,285 lane-seconds run again for 6,690 freed. Yields to a named wait: 38 small tiers (84 files, 4,790 lane-seconds again, 6,741 freed) and 15 backlog-sized tiers (29 files, 2,051 lane-seconds again, 2,250 freed). The backlog yields nearly break even on lane time. They buy the named file's earlier verdict and nothing else. No yield was to a recreate alone: each of the 20 recreating revisions also queued an edit's work or was catch-up.

**0.1.237 against 011-54.** In 6.7 days, 011-54 adds 4 free cancels and 13 files cut free. The edit's wait totals 313 s less (3%), and its p90 falls from 29.8 s to 13.7 s. Named waits do not change: no episode differs. 011-54u (the remainder over unfinished files) yields 3 fewer times and throws away 437 file-seconds less. It costs 568 s of edit wait and 56 s at the named verdict's p90. The all-files remainder counts an ended file that ran faster than its last duration, so it errs toward yielding.

**Against `running-tier-yields.md`.** Its window ended at 08:12Z with 66 episodes; this one has 67 before 08:12Z and 131 in all. Its 4,454 file-seconds were the yields to an edit's work (4,536 here). Yields to named waits add 11,183. The named wait behind the tier now falls by 75% (16,672 s to 4,174 s), against 52% there. The cumulative supersession and the ended marks account for the difference (*inferred*).

**Live, under the shipped rule** (`observe.mjs`, `results/observe.txt`). 12 cezar worktrees ran a 0.1.237 or 0.1.238 daemon after 13:05Z, with 64 fast tiers until the copy. 11 tiers of up to 4 files had a revision or a named wait during their run, all but one in worktree bc70c03f. The daemons cancelled 6: 3 supersessions (79095ce9, fdd2792b, dd6e1d8f) and 3 yields (71f6f511, 0e21a264, 5a82a880). They let 9f663acb run 86.9 s: it held the 4 files 0e21a264 had cut 11 s before, so the one-cut mark refused it. Two named waits named files that already had a current result, so nothing was promoted. With the mark and that check, the model's decision matches all 11. Each cancel saved an estimated 36 to 66 s of lane time. Event to run end: p50 1.3 s, p90 7.7 s (n 6). The load at the tiers' start was 17 to 46 (sar). All 6 reports say "run cancelled: an edit arrived during a backlog tier", whatever the cause; row 011-56 makes a cancel name it. A backlog cancel, a7efe311, is published in the `yields` meta row as `{"kind":"yields"}`, since `TierYields.check` gives a cancel and a yield the same standing (*read in source code*).

## 2. The duration source

*Verified from the store* (`replay.mjs`). The scheduler's estimate is `durationOf`, the sum of a file's results. It equals Vitest's module duration in the report: ratio p10, p50 and p90 1.000 over 22,723 file runs. So W1's fact holds on cezar: the estimate was already the whole file. The 3.5 s of gh-62 is the file-level row alone.

The run log has no per-file times, so a wall exists only for one-file runs (run end less start, start-up and post-run checks included). Over 149 such runs, the wall less the estimate is:

| Estimate | n | Wall − estimate p50 / p90 / max |
|---|---|---|
| under 10 s | 48 | 0.61 / 1.22 / 3.34 s |
| 10 to 30 s | 12 | 0.76 / 2.06 / 3.12 s |
| 30 s or more | 89 | 0.47 / 0.97 / 3.18 s |

The p90 ratio of 1.616 comes from files under 10 s, where the fixed cost dominates. The yield compares a remainder over 30 s, so only files of 30 s or more matter. As the wall source, the replay takes a one-file run's wall, else the estimate plus 1.1 s. Over the 203 yield checks of 0.1.237 at 30 s, the remainder moves by p50 1.1 s, max 3.2 s, and **no decision changes** (81 over 30 s by either source; 0 of 195 for 011-54). At a 0 s threshold the wall gives 4 more yields. 013-03's wall time will therefore not move the 30 s decision on cezar. The one gap the remainder has is the tier's start-up (about 0.5 s), which its elapsed time counts and no file's duration does. It is of the same size.

## 3. The live check

Not run. The brief allows it only at a one-minute load below 8. The load was 18.9 to 45.8 during the session, and no ten-minute sample since 14:00 local was below 13.9 (`results/env.txt`). The live observation in finding 1 is the nearest evidence: cezar's own daemons at load 17 to 46. It is not a controlled check. `probes/yields-replay/README.md` gives the recipe for a night run.

## 4. Whether 30 s holds

0.1.237's rule, the store's estimate, the whole window (`results/replay.txt`):

| Threshold | Yields | Files run again | File-s lost | Edit's wait p90 / total | Named wait behind p90 / total | Named verdict p50 / p90 (next) |
|---|---|---|---|---|---|---|
| 0 s | 124 | 750 | 17,278 | 10.5 / 10,048 s | 70.6 / 3,671 s | 72 / 666 s |
| 15 s | 91 | 222 | 16,639 | 19.7 / 10,489 s | 76.5 / 4,020 s | 76 / 666 s |
| **30 s** | **81** | **198** | **15,719** | **29.8 / 10,589 s** | **76.5 / 4,174 s** | **82 / 731 s** |
| 60 s | 66 | 159 | 12,983 | 35.4 / 11,001 s | 78.1 / 4,211 s | 127 / 926 s |
| 120 s | 55 | 134 | 10,616 | 64.9 / 11,287 s | 98.3 / 4,816 s | 145 / 999 s |

From 30 s to 60 s: 2,736 file-seconds (17%) and 39 reruns fewer, for 412 s (4%) more edit wait and 37 s more named wait in total. The named verdict's p50 moves 45 s in the *next* model and not at all in the *shift* model. From 30 s to 15 s: 100 s less edit wait for 920 file-seconds more. The largest step is from 0 s to 15 s (528 fewer reruns), where tiny remainders cut many short files. 30 s sits between the steps, and neither duration source nor 011-54 moves it. The gap between 30 s and 60 s is a few percent of wait against 17% of rework, and the replay's cascades are not modelled (below). That is not enough evidence to move it.

## Recommendation for Squeal

Keep the yield at 30 s and the remainder over all the tier's files, as shipped. 0.1.237 already gives the gain on cezar. The named wait behind a tier falls from 16,672 s to 4,174 s in total (p90 344 s to 77 s), and the edit's wait from 49,702 s to 10,589 s. The cost is 198 files run again (15,719 file-seconds) in 6.7 days. Live, the daemons did what the model says in 11 of 11 tiers.

Land 011-54 for its correctness and its cause text (B2, 011-56), not for speed. On cezar it adds 4 free cancels in 6.7 days and 3% less edit wait, and no named wait changes. When 011-54 restores "unfinished" in C4 step 5, restore it for the supersession test only. The remainder over unfinished files (011-54u) waits longer (edit wait +568 s, verdict p90 +56 s) to save 437 file-seconds. 013-03's wall time needs no threshold change: it moves no decision.

The named verdict's remaining wait is not the blocking tier. Behind a tier of up to 4 files, the conservative model still leaves p50 231 s. That is the named file's own long tier and what queues before it (`running-tier-yields.md`, open question 5; 001-184).

## Open questions

- **The live check** below load 8 has not run (finding 3).
- **Cascades.** The replay does not move later events after a cut. 9,126 lane-seconds run again delay other work, spread over 6.7 days.
- **The backlog's turn** is not stored, so the model may let a turn tier yield that the rule keeps. At most the 15 backlog-sized yields are affected.
- **Wall times in multi-file tiers** are not in the run log, so the wall source there is the estimate plus 1.1 s (*inferred*). After 013-03, the reporter's module stamps give them. Re-run `replay.mjs` with them then.
- **Live sample size.** The live observation is 6 cancels in one worktree in two hours.

## Sources

- Squeal at `squeal--v0.1.237` (0dacd9a6) and 5824e355: `src/core/scheduler/{yields,tiers,backlog,files,records}.ts`, `src/runners/vitest/run.ts` (`CANCELLED`).
- Cezar: `.git/squeal/store.sqlite` (copied read-only 2026-10-21T14:53:13Z), `.git/squeal/runs/*/report.json`, `squeal.config.json` (`tierSize` 4).
- Transcripts, read only: `~/.claude/projects/-home-agent-projects-cezar*/*.jsonl`, `~/.codex/sessions/2026/10/*/*.jsonl` (1,782 status waits, 1,000 naming a test path).
- Load: `/proc/loadavg`, `/var/log/sysstat/sa14` to `sa21`.
- Spec 011 C4 step 5, C15; board rows 011-51, 011-54, 011-56, 011-68, 013-03; `research/running-tier-yields.md`; 013 `research/issue-62.md`; `reviews/0.1.237.md` B2.
- Probe: `probes/yields-replay/` (README, scripts, `results/`).
