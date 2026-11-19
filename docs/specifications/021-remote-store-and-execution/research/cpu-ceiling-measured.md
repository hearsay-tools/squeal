# Research: cpu-ceiling-measured

Row 021-19, topic `cpu-ceiling-measured` of `README.md` ("Week-after measurements"). Researcher, 2026-11-19. It extends `cpu-budget.md` (Q1 and its replay) and `../../011-core/research/broad-change-throughput.md` (row 011-395), and does not repeat them. Squeal source and release read: 0.1.563 (`src/core/capacity/{background,cores,pool}.ts`; no capacity change since 0.1.442). Probes: `probes/cpu-ceiling-measured/` (throwaway, README there).

Tags: **[exp]** verified by experiment, **[src]** read in source code, **[inf]** inferred. "Measured" below means read from recorded runs, sar and daemon logs: no load was made on this host.

**Verdict.** On this host, D18's ceiling of 18 never decided anything last week. The user config sets 6 test slots, the rule takes the lower of slots and ceiling, so background work was held at 6 busy CPUs, with one floor tier for all daemons above that. That stricter limit did what a budget does to CPU: background cost 10.4% less per unit of work (the replay predicted 7.6% for 18). It did not cut the host's time above 20 busy CPUs (11.4% → 10.3%, not the predicted 5.2%), because other load alone made those samples. Backlog finish got later than predicted for 18 (p90 66 min against 40). Two thirds of the held time was below 18 busy CPUs, where a ceiling of 18 would have admitted the work. On the quiet 12-vCPU lab VM the default ceiling (9 of 12) made a 1,200-file drain 5.7% slower than share 1.0 (1,033 s against 974 s, two runs each, spread 8 to 9 s) and saved no CPU (6,906 against 6,858 CPU-s). It refused a tier only once per run, for 3 s; the delay comes from narrower grants. Recommendation: keep 75% as the default, and change the rule so that the test-slot setting no longer acts as a busy-CPU ceiling.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | This host, last week | The 18 ceiling never bound: `hostSlots` 6 made the bar 6 busy CPUs (490,833 refusal lines, all naming 6 slots). Background CPU per unit of work −10.4% (replay for 18: −7.6%); host above 20 busy 10.3% (was 11.4%; replay 5.2%); backlog p90 65.6 min (replay 40.1); edit-tier p50 4.29 s (was 4.73). 205 daemon-hours held, 137 of them below 18 busy | exp (records), inf (attribution) |
| 2 | A second machine | Quiet 12-vCPU lab VM, 1,200-file drain: share 0.75 1,037 / 1,029 s, share 1.0 979 / 970 s (−5.7%); CPU-s 6,905 / 6,907 against 6,882 / 6,833; mean busy 6.8 against 7.15, peak 11.0 to 11.2 in all runs; refusals 1 episode of 3 s per 0.75 run, none at 1.0. The ceiling delays results on a quiet machine, by about 6%, and saves nothing there | exp |
| 3 | Recommendation | Keep 0.75. Change the rule: compare the host's busy CPUs with the ceiling only, and the test slots with Squeal's own permits, so `hostSlots` below the ceiling stops being a busy-CPU bar. Log one line per refusal episode, not one per 2 s look | inf |

## Q1. This host, last week

**Window.** 2026-11-14 20:00Z (the host's reboot at 19:57Z; each of the 386 worktrees with runs in it has a daemon log, so every daemon was 0.1.488 or later) to 2026-11-19 08:00Z: 4.5 days, 642 sar samples, 386 worktrees with runs (98 a day), 37,914 backlog tiers, 4,668 edit tiers, 251 `run --all`, 101 baselines. At 08:08Z on 11-19, `squeal ps` showed 10 daemons and load 9.7 on 24 CPUs. Over the window a mean of 1.75 daemons had a tier running and 1.9 waited on the background rule (below); the host's mean busy CPUs were 9.5. Earlier daemons (11-12 to 11-14) wrote no log, and the store has pruned the runs of the no-budget week, so that week's figures come from `cpu-budget.md`, recorded or from its replay of `none`. **[exp]**

**The ceiling that bound was 6, not 18.** The user config on this host is `{"capacity":{"hostSlots":6}}` since 2026-11-13 22:22Z (file time). A backlog tier takes a permit only while the host's busy CPUs are below `min(hostSlots, backgroundShare × CPUs)` = min(6, 18) = 6 (`cores.ts` `gatedPermits`) **[src]**. Above that, the floor lets one background tier run, with its fewest workers, across all of the user's daemons, and only while no daemon holds a background permit (`pool.ts` `#gated`) **[src]**. `research/issue-225.md` (011, 2026-11-15) found the same mechanism. Every one of the 490,833 refusal lines in the window reads "ceiling 18 (0.75 of 24 CPUs, 6 test slots)" **[exp]**. So this week measured a background limit of 6 busy CPUs with a one-tier floor. It did not measure D18's 18.

| Measure | 2026-11-04 to 11 (no budget) | Replay, ceiling 18 (`cpu-budget.md`) | 2026-11-14 to 19 (measured, limit 6) |
|---|---|---|---|
| Host time above 16 / 18 / 20 busy vCPUs | 25.3 / 17.7 / 11.4% (recorded) | 28.5 / 14.7 / 5.2% | **24.0 / 16.1 / 10.3%** |
| Samples above 20 busy with other load ≥ 12 cores | 106 of 107 | | 66 of 66; other load a mean 20.3 cores, Squeal's tests 2.3 |
| Above 16 busy: other load, Squeal background | 14.9, 4.5 cores | | 17.1, **2.5** cores |
| Background CPU per unit of work (011 curve) | 1.343 | 1.241 (−7.6%) | **1.203 (−10.4%)** |
| Background CPU, core-hours a day | 60.3 (422 h in 7 days) | | 46.1 |
| Background work, isolated core-hours a day | 46.9 (328 h) | | 38.3 (−18%) |
| Background tier wall p50 / p90 | 10 / 88 s | | 6.9 / 42.4 s |
| Tier finish from arrival p50 / p90 | 10.4 / 92 s (replay `none`) | 17.1 / 190 s | 8.8 / 77 s |
| Tiers that start within 2 s of the previous tier's end in their worktree | 75% | | 50.4% |
| Backlog (chain) finish, work-weighted p50 / p90 | 11.7 / 29.5 min (replay `none`) | 13.7 / 40.1 min | **14.7 / 65.6 min** |
| Edit tiers a day; wall a day; p50; mean | 552; 1.83 h; 4.73 s; 11.9 s | p50 4.36 s (wall −7.2%) | 1,037; 2.99 h; **4.29 s**; 10.4 s |
| Refusals logged | none (no ceiling) | | 490,833 lines, 21,613 episodes, 205 daemon-hours held |

Method, all in `probes/cpu-ceiling-measured/host/q1.py` **[exp]** on the records, with the attribution **[inf]**:

- Tier kinds, the split of sar `%nice` into background and foreground, and "per unit of work" are `cpu-budget/replay.py`'s. Squeal's test processes run at nice 10, so `%nice` is Squeal's test CPU.
- A chain is `cpu-budget.md`'s: a background tier that starts within 5 s of the previous one's end in its worktree. Under the ceiling a held tier starts later, so the chain also continues when that worktree's daemon logged a refusal episode in the gap that ended within 5 s of the start. Without that rule chains break at each hold: p50 4.3, p90 20.0 min. That figure understates.
- Refusal episodes: a daemon logs a refused look every 2 s, so lines less than 5 s apart from one daemon form one episode.

**CPU per test file against its fast reference.** Ratio of a file's duration to the 25th percentile of its own durations in the 7 days before (`background-backoff/signal.py`'s reference), 208,084 background file records. Median ratio by host busy band (0–6, 6–12, 12–16, 16–20, 20–24): 0.98, 1.01, 1.16, 1.40, 2.34. Relative to the lowest band, that is 1.03, 1.18, 1.43, 2.38. The 011 curve at the band middles gives 1.09, 1.17, 1.35, 2.09. The curve still holds below 20 busy, and its top is steeper this week **[exp]**. The median background file ran at 1.07 of its reference, an edit-tier file at 1.31.

**Refusals.** 490,833 lines in 4.5 days (109,000 a day). The log files rotate, so this is a lower bound, but 852 of 883 logs started inside the window. Busy CPUs read p10 7.5, p50 15.2, p90 22.8; 35% of the lines read 18 or more. In 21,613 episodes the held time was p50 5.7 s, p90 90 s, maximum 40.6 min. The sum is 205 daemon-hours, a mean of 1.9 daemons waiting at any time. Of those 205 hours, **137 (67%) were held in episodes whose mean busy read was below 18**. A ceiling of 18 would have let that work run **[exp]**.

**What is the rule's effect and what is the workload.** **[inf]**

- *The rule's effect:* background CPU per unit of work fell 10.4%, more than the replay's 7.6% for 18. That matches a stricter limit: the replay's ceiling of 14 gives 1.200. Background's cores above 16 busy fell from 4.5 to 2.5. The backlog p90 of 65.6 min lies between the replay's ceilings 16 (55.6) and 14 (78.2), not near 18 (40.1). Still, 31% of background CPU ran in 10-minute samples at 16 busy or more (`bgShareByBusyBand`), where the rule admits only the floor's one tier; the rule reads busy CPUs over seconds, sar over 10 minutes.
- *Not the rule's effect:* host time above 20 busy stayed at 10.3% (11.4% before), not the replay's 5.2%. In every such sample other load alone was 12 cores or more, a mean of 20.3, and Squeal's tests took 2.3. The replay held other load as recorded in the no-budget week (14.9 cores above 16); this week it was 17.1. No background rule removes that time.
- *Workload:* background work per day fell 18%, edit tiers per day doubled, and tiers got smaller (wall p90 42 s against 88 s). Squeal's background CPU per day fell 24% and its background work 18%; the rest is the lower cost per unit of work. The old CPU figure is recorded and the old work figure replayed, so this split is approximate. The edit-tier p50 fell 9% (4.73 → 4.29 s), close to the replay's −7.8%. With twice as many edit tiers and a different mix, the ceiling's share of that is not determined.
- *Not measured:* agents' own test runs (the replay's −9.3%). Their slowdown follows the host's busy time, and the time above 16 and 20 barely moved, so a large change is unlikely **[inf]**. Normalizing per busy daemon: Squeal's test CPU was 1.17 cores per daemon with a tier running. The no-budget week cannot be normalized the same way: its runs are pruned.

The 1.4 days before the change to 6 slots (2026-11-12 12:00Z to 11-13 22:20Z, limit min(12, 18) = 12, daemons of mixed versions, no logs) were busier (above 20 busy 27.4% of the time, other load a mean 20.6 cores there). Background ran 1.374 per unit of work and chained in 50% of tiers (`out/q1-2026-11-12T12Z-to-11-13T22Z.json`). Too short and too mixed to compare **[exp]**.

## Q2. A second machine: the 12-vCPU lab VM

**Setup.** Row 011-395's setup and probes, reused **[exp]**: Squeal 0.1.563, squawk at `c11e4edf0`, a private `HOME` and runtime directory under `~/work/<task id>/`, so no shared pool and no other user config: 11 test slots (`availableParallelism() − 1`), ceiling 9 at share 0.75 and 12 at 1.0, so the slots (11) bound at 1.0. Each run: a fresh daemon in its own systemd scope with the share set in the private user config; wait until idle; one comment line appended to `packages/contract/src/ci-wait.ts`; wait until idle. Each edit queued the same 1,200 runnable files (97 browser files stay manual). Order A1 (0.75), F1 (1.0), A2 (0.75), F2 (1.0), 08:39Z to 09:51Z. Before them the daemon drained the same edit's files once and `squeal run --fast` ran the remaining 628 fast-lane files (176 s), so every file had a stored duration. No harness was attached, so squawk's `run-loop` group ran beside the backlog in tiers of 4, as in 011-395.

**VM load.** Only this probe ran on the VM: at each edit the top processes were the probe's daemon and its lint start-up. The one-minute load at the edit was 3.2, 4.9, 5.6 and 5.0, the tail of the previous run and the new daemon's start-up. All load figures below are Squeal's own work **[exp]**.

| Run | Share (bar) | Total wall, edit to last result | First backlog tier at | Backlog phase | CPU-s (scope; daemon) | Busy CPUs mean / p90 / peak (2 s samples) | One-minute load mean / max | Refusals logged |
|---|---|---|---|---|---|---|---|---|
| A1 | 0.75 (9) | 1,036.9 s | 164.4 s | 866 s | 6,905; 788 | 6.77 / 9.49 / 10.98 | 7.9 / 15.7 | 4 lines, 1 episode of 3.2 s at 45.9 s, 9.1–10.1 busy |
| F1 | 1.0 (11 slots) | 979.2 s | 165.3 s | 808 s | 6,882; 741 | 7.14 / 9.56 / 11.18 | 8.5 / 13.3 | none |
| A2 | 0.75 (9) | 1,028.9 s | 164.4 s | 858 s | 6,907; 784 | 6.82 / 9.60 / 11.08 | 7.8 / 12.6 | 4 lines, 1 episode of 3.2 s at 45.9 s |
| F2 | 1.0 (11 slots) | 969.8 s | 163.7 s | 799 s | 6,833; 748 | 7.15 / 9.25 / 11.08 | 8.3 / 11.7 | none |

"Backlog phase" is the summed wall of the backlog tiers (more than 4 files each, 8 or 9 per run). The background finish equals the total wall in every run: the last backlog tier is the last result. All four runs finished all 1,200 files once each. The heartbeat was never older than 7.3 s **[exp]**.

- **Time.** Share 1.0 finished in a mean 974.5 s, share 0.75 in 1,032.9 s: **58 s or 5.7% faster**. The two runs of each share differ by 8 and 9 s, so the gap is six times the spread. The fixed part before the backlog (runner part and the 120 s quiet, 164 s) was the same; the gap is in the backlog phase (862 against 804 s, −6.8%) **[exp]**.
- **CPU.** 6,906 against 6,858 CPU-s (−0.7% at 1.0), within the spread. A ceiling on a quiet machine saves no CPU here, because at 1.0 Squeal still kept only 7.15 of 12 CPUs busy on average and peaked at 11: background alone never passed the machine's throughput peak, the one case where `cpu-budget.md` Q4 expected a budget to pay **[exp]**, **[inf]**.
- **Where the 58 s come from.** Not from refusals: one episode of 3 s per run, at 46 s, while the node:test lane and the run-loop tiers started. A refusal is logged only when a tier gets fewer than its fewest workers (`pool.ts` `#logRefusal`) **[src]**. Below that, each permit needs the busy CPUs, which include the daemon, its run-loop lane and its node:test lane, below the bar (`gatedPermits`) **[src]**. With busy CPUs at p90 9.5, a bar of 9 trims grants that a bar of 11 allows. The backlog tiers ran 3.48 and 3.61 files at once (summed file seconds over tier wall) at 0.75, against 3.77 and 3.71 at 1.0 **[exp]**. The tiers' worker counts were not logged, so the grant width is inferred from that ratio and the busy CPUs **[inf]**.
- **Against 011-395.** Its run A (0.75, same edit, same release) took 1,143 s at a mean 6.0 busy CPUs and 6,746 CPU-s. Today's 0.75 runs took 1,029 to 1,037 s. Its warm-up stored durations from a `run --fast`; here the same 1,200 files had run once just before. The cause of the 10% difference is not determined. So the ceiling explains about 6 points of 011-395's 55% overhead on a quiet machine; the rest of the idle CPU stays with tier barriers and per-tier Vitest start-up, as 011-395 found. Even at 1.0, 5 of 12 CPUs stayed idle **[inf]**.
- **D18's claim.** "A ceiling delays results on a quiet machine": confirmed, and small, about 6% on one broad drain, with no CPU saved. The foreground protection the ceiling is for was not tested: no agent load ran on the VM.

## Q3. Recommendation

**[inf]**, from the evidence above.

1. **Keep 75% as the default share.** On the quiet VM it cost 5.7% of a broad drain and saved nothing; on a loaded host the replay's gain is foreground protection, which a quiet machine does not need and a busy one does. Share 1.0 would remove that protection to win about 6% on quiet machines. The evidence for 75% under load is still only the replay: this host never ran with 18 as the bar.
2. **Change the rule: a test-slot setting must not become a busy-CPU ceiling.** `gatedPermits` compares the host's busy CPUs with `min(hostSlots, ceiling)`. On this host, with 6 slots, that held background work below 6 busy CPUs of 24, with one floor tier for all daemons above it. Cost in 4.5 days: 205 daemon-hours held, 137 of them while the host was below 18 busy, and a backlog p90 of 66 min where the replay for 18 gave 40. The fix the evidence points to: compare the host's busy CPUs with the ceiling alone, and compare `hostSlots` with Squeal's own permits or measured cores, as edit tiers already do. This is `issue-225.md`'s mechanism, now with a week's cost. On a machine whose slots are at or above the ceiling (every default from 4 CPUs up: CPUs − 1 ≥ 0.75 × CPUs) nothing changes.
3. **How the ceiling counts Squeal's own lanes: no change now.** On the VM the daemon's own run-loop and node:test lanes count as busy CPUs and narrow the backlog grant. The whole effect of the bar was 6%, so excluding them would gain at most that much on a quiet machine, and less under load. Not worth a rule change on this evidence.
4. **Log one line per refusal episode**, with its start, end and the busy CPUs read, instead of one line per 2 s look. This host logged 109,000 lines a day; 021-18's notes predicted it.
5. **Measure again after the rule fix**, on this host, with the same `q1.py`: backlog p90 against the replay's 40 min for 18, and the held time below the bar.

## Open questions

- For the human: this host's `capacity.hostSlots` is 6 since 2026-11-13 22:22Z. Was that meant to hold background work below 6 busy CPUs, or only to cap Squeal's own test processes? The answer decides whether item 2 above is a defect or the intended effect of the setting.
- Not determined: the effect of D18's 18 itself on this host. It cannot be read from last week, because the slots bound first. Measuring it needs the rule fix (item 2) or `hostSlots` 18 or more for a week.
- Not determined: the edit-tier and agents' test-run changes caused by the bar. Edit tiers per day doubled and their mix changed; agents' runs were not extracted.
- Not determined: the per-tier worker counts on the VM. A per-tier grant log line, or 011-395's `lslocks` sampler, would show the grant width directly.
- Not measured: a machine with agent load beside Squeal other than this host. The 021-15 team machine does not exist yet, and the lab VM is leaving this host (the human, 2026-11-19).

## Sources

- Earlier files: `cpu-budget.md` (Q1 table, Method, `probes/cpu-budget/replay.py`), `../../011-core/research/broad-change-throughput.md` and its `probes/broad-change-throughput/`, `../../011-core/research/issue-225.md`, `../../011-core/research/load-slowdown.md` (the curve, `probes/background-backoff/curve.py`), `background-backoff.md` (`signal.py`'s reference).
- Spec D18 and `status.md` (2026-11-11 to 11-12 decisions, the 021-18 notes in `tasks/021-18-notes.md`).
- Source at 0.1.563: `src/core/capacity/cores.ts` (`gatedPermits`, `gatedCores`), `src/core/capacity/pool.ts` (`#gated`, the floor, `#logRefusal`), `src/core/capacity/background.ts` (`backgroundCeiling`, `ceilingRefusalLine`), `src/core/daemon/user-config.ts` (`capacity.backgroundShare`, `defaultHostSlots`).
- The 12-vCPU lab VM: Ubuntu 24.04, 12 vCPUs, 31 GiB, Node 26.13.0; work directory `~/work/<task id>/`, deleted at the end; no daemon or process left (checked with `ps` at 09:54Z). Outputs: `probes/cpu-ceiling-measured/vm/out/` (`summary.jsonl`, per run `*.timeline.json`, `*.refusals.json`, `*.tsv`, `*.queue.tsv`, `*.load.txt`).
- This host: the stores of squeal, cezar and toolkit-dev (`<clone>/.git/squeal/store.sqlite`), rows copied in one read-only transaction on 2026-11-19 08:09Z, 55,241 runs since 2026-11-12 with their `report.json` files read in place; sar `sa12` to `sa19` (`sadf -d -U -- -u`); 883 daemon logs `<clone>/.git/squeal/logs/daemon-*.log*`; `~/.config/squeal/config.json`; `squeal ps` at 08:08Z. The one-minute load was 9 to 11 on 24 CPUs while they were read.
