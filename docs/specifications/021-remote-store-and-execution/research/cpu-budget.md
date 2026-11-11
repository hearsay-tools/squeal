# Research: cpu-budget

Row 021-06, topic `cpu-budget` of `README.md`. Researcher, 2026-11-11. It extends `../../011-core/research/load-slowdown.md`, `background-backoff.md`, `manual-mode.md`, `unread-work.md` and `daemon-model.md` Q4, and does not repeat them. Source read at `a246213ed`. Data: the stores of squeal, cezar and toolkit-dev with their runs' `report.json` files and Cezar's two `runs.db`, copied 2026-11-11 15:20Z; sar `-u`; Claude Code and Codex transcripts. **Window: 2026-11-04 15:00Z to 2026-11-11 15:10Z** (7.0 days, 939 sar samples; the run reports start at 15:00Z on 11-04, so the window is 30 min later than `daemon-model.md`'s). This worktree's runs are out of every count. No test, build or load was started; the one-minute load was 25 to 29 on 24 vCPUs while the copies were read. Every figure is a replay of recorded history, not a timing. Probes: `probes/cpu-budget/` (throwaway).

Tags: **[exp]** verified by experiment, **[docs]** read in official docs, **[src]** read in source code, **[inf]** inferred.

**Verdict.** The human's hypothesis is right about CPU and wrong about background results. A budget makes each background file cheaper: the adaptive budget spends 7% less CPU per unit of background work, and Squeal spends 9.5% less CPU in total, because some deferred work need not run at all. Agents' own test runs get 8.8% faster and edit tiers 6.4% faster. But no budget finishes background work sooner. Every budget makes background results later, at every load: the median tier finishes in 20 s instead of 10 s, and a worktree's backlog finishes in a work-weighted p90 of 47 min instead of 30 min. The reason is measured: in 106 of the 107 samples above 20 busy vCPUs, other load alone was at 12 cores or more. Squeal's background added a mean of 4.5 cores. On this curve, background's own work rate then still rises with each core it adds, so holding it back only moves its work later. There is no crossover on this host this week. The hypothesis holds where Squeal's background alone pushes a machine past its throughput peak. Holding the background at the peak then raises its own rate by up to 31% on this curve. That happens on a machine with little other load, and it did not happen here (0 of 166 samples at a ceiling of 18).

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Throughput, not only delay | Adaptive budget (θ 1.25): Squeal CPU −9.5%, background CPU per unit of work 1.343 → 1.250, host time above 20 busy 13.2 → 6.7%. Background tier finish p50 10 → 20 s, p90 92 → 233 s; backlog finish (work-weighted) p50 11.7 → 14.3 min, p90 29.5 → 47.1 min. Every fixed ceiling from 22 to 12 also delivers background results later. No crossover: a budget never finishes the same background work sooner here | inferred (replay) from verified records |
| 2 | Work that need not run | Of the work a budget defers, 2.8% (adaptive) to 3.4% (ceiling 16) is made stale by a later revision before it would run, and 7.9 to 11.3% belongs to a worktree that Cezar removed first. Together 2.5% (adaptive) and 4.2% (16) of all background work. Without the one-permit floor these figures double | inferred (replay) |
| 3 | Agents' own runs | 3,279 foreground runs, 43.5 h of wall: −8.8% under the adaptive budget (0.55 h a day, 4.2 s a run), −10.6% at a ceiling of 16 | inferred |
| 4 | Signal on other machines | A busy-vCPU ceiling depends on the machine; the own-slowdown ratio does not. A budget can make background work finish sooner only where Squeal's background alone passes the throughput peak: likely on a small or quiet machine, never under a pure CPU quota (throughput is flat there). Inside a container, only the cgroup's own files and the own ratio see the quota | inferred from verified curve; docs |
| 5 | Where it lives | One budget per machine and user, fed by the runs on that machine. A remote runner host counts against its own machine's budget, with its own per-file references | inferred |
| 6 | Recommendation | The adaptive own-slowdown budget of `background-backoff.md`, per user across all daemons, with a one-permit floor. Expect: Squeal CPU about −10%, edit tiers about −6%, agents' test runs about −9%, host time above 20 busy halved; background results a median 9 s and a p90 2.4 min later per tier. Sell it as protection for foreground work, not as faster background work | inferred |

## Method

`replay.py` replays the week as a queue in 60 s steps inside the 10-minute sar samples. **[inf]** for the model, on **[exp]** inputs.

- **Load.** A sample gives busy cores B and Squeal's test CPU N (`%nice`: test processes run at nice 10, `TEST_NICE`, `src/core/daemon/low-priority.ts:13` **[src]**). Other load O = B − N is held as recorded: agents, their own tests, builds, and Squeal's daemon main threads. N splits into background G (backlog and baselines, 37,145 tiers) and foreground E (3,866 edit tiers, 912 `run --all`) by worker-seconds, as in `load-slowdown.md`.
- **Work.** Each background tier's cores are its share of G. Its work in isolated core-seconds is those cores over S(B), with S the slowdown curve of `load-slowdown.md` finding 1. It runs at its recorded cores, at speed 1/S(B′) for the replayed load B′.
- **Chains.** 75% of background tiers start within 2 s after the previous background tier in their worktree ends, and 88% start with no other background tier running there **[exp]**. A tier that starts within 5 s of its predecessor's end is chained: it arrives when its predecessor ends in the replay. So a faster tier makes its whole backlog finish sooner, and a deferred tier delays its successors.
- **Policies.** `none` admits each tier at arrival. A fixed ceiling C admits first in, first out while O + E′ + running background cores stay ≤ C. The adaptive budget is `background-backoff.md`'s controller. Each 60 s step reads S(B′) times noise drawn from this week's residuals of the own-slowdown signal (`signal.py`). It halves the budget after two readings in a row above θ and adds one core after a reading at or below θ, between 2 and 23 cores. Every budget keeps a floor: the oldest waiter runs on 2 cores, one permit, when less than that runs.
- **Need not run.** At admission, a file is stale when a later run of its worktree at a higher revision picked it. A tier whose worktree Cezar removed before admission is dropped.
- **Check.** The replay of `none` gives 440 background core-hours against 422 recorded (+4%). Host time above 16/18/20 busy is 26.5/18.7/13.2% against 25.3/17.7/11.4%, and edit-tier wall is 12.98 h against 12.78 h. Policies are compared with that `none` row, so the model's own error cancels.

## Findings

### Q1. Throughput, not only delay

Main replay (`out-base.jsonl`). Squeal CPU is background plus foreground, in core-hours. "Per work" is background CPU per isolated core-second of work. Tier finish is from a tier's arrival to its end. Backlog finish is from the start of a worktree's chain to the end of its last tier, weighted by work. **[inf]**

| Policy | Squeal CPU h | Per work | Host >16/18/20 % | Others' slowdown | Tier finish p50/p90 s | Tiers arriving >20 busy, p50/p90 s | Backlog finish p50/p90 min | Edit-tier wall h, p50 s | Agents' test wall h |
|---|---|---|---|---|---|---|---|---|---|
| none | 463.7 | 1.343 | 26.5 / 18.7 / 13.2 | 1.464 | 10.4 / 92 | 18.6 / 120 | 11.7 / 29.5 | 12.98, 4.73 | 43.53 |
| adaptive θ 1.4 | 433.9 (−6.4%) | 1.272 | 27.1 / 17.8 / 8.7 | 1.370 | 14.5 / 156 | 95 / 289 | 13.1 / 34.6 | 12.33 (−5.0%), 4.43 | 40.49 (−7.0%) |
| **adaptive θ 1.25** | **419.8 (−9.5%)** | **1.250** | 26.1 / 15.3 / **6.7** | **1.348** | **19.5 / 233** | 144 / 412 | **14.3 / 47.1** | **12.15 (−6.4%)**, 4.36 | **39.68 (−8.8%)** |
| adaptive θ 1.15 | 403.3 (−13.0%) | 1.228 | 23.6 / 13.0 / 5.7 | 1.332 | 32.1 / 317 | 195 / 539 | 16.7 / 64.3 | 11.98 (−7.7%), 4.31 | 39.32 (−9.7%) |
| ceiling 22 | 454.0 (−2.1%) | 1.316 | 26.5 / 18.8 / 13.3 | 1.428 | 11.4 / 100 | 30 / 146 | 11.9 / 29.9 | 12.72 (−2.0%), 4.67 | 42.21 (−3.0%) |
| ceiling 20 | 435.9 (−6.0%) | 1.269 | 26.9 / 19.1 / 8.8 | 1.365 | 12.8 / 118 | 55 / 204 | 12.1 / 32.8 | 12.29 (−5.3%), 4.45 | 40.30 (−7.4%) |
| ceiling 18 | 420.3 (−9.4%) | 1.241 | 28.5 / 14.7 / 5.2 | 1.340 | 17.1 / 190 | 127 / 412 | 13.7 / 40.1 | 12.05 (−7.2%), 4.36 | 39.48 (−9.3%) |
| ceiling 16 | 401.9 (−13.3%) | 1.218 | 22.6 / 10.4 / 5.2 | 1.323 | 28.8 / 328 | 197 / 601 | 16.2 / 55.6 | 11.90 (−8.3%), 4.25 | 38.92 (−10.6%) |
| ceiling 14 | 380.2 (−18.0%) | 1.200 | 17.3 / 10.4 / 5.2 | 1.314 | 60.2 / 518 | 254 / 1,061 | 20.4 / 78.2 | 11.82 (−8.9%), 4.21 | 38.66 (−11.2%) |

- **CPU: the hypothesis holds.** Each background unit of work costs 7% less CPU under the adaptive budget (1.343 → 1.250) and 9% less at 16. Of the adaptive budget's 41.7 saved background core-hours, about 30 come from running on a quieter host and about 10 from work it did not run (Q2). Seeds 2 and 3 give 419.5 and 419.7 h **[inf]**.
- **Background results: the hypothesis fails.** Every budget raises every background finish figure. The largest rise is for tiers that arrive when the host is above 20 busy (p50 19 → 144 s), the very case where a quieter host should help. A tier is short: wall p50 10 s, p90 88 s **[exp]**. The few seconds it gains on a quieter host are far less than the minutes it waits for one.
- **Why there is no crossover.** `curve-math.py` **[inf]**: for other load b0 ≥ 16 cores, background's own rate g/S(b0+g) rises with every added core up to 24 busy, because the measured curve's top band (22–24 busy) is 2.49 and the replay holds it flat there. For b0 ≤ 14 it peaks inside, at 19 to 21 busy. This week, other load O + E was above 12 cores in 25.6% of the time, but in 106 of the 107 samples above 20 busy. When the host was above 16, O was a mean 14.9 cores and background 4.5 **[exp]**. In 0 of 166 samples would a ceiling of 18 have raised background's own rate, and in 2 of 107 samples a ceiling of 20 (gain 1.04). The host's total throughput B/S(B) does peak at 18 busy (13.3 isolated cores) and falls to 9.6 at 24. The gain from the budget goes to other work: its slowdown falls from 1.464 to 1.348.
- **Edit tiers and first answer.** Edit-tier wall falls 6.4% (p50 4.73 → 4.36 s). An edit tier has at most 4 files, so its wall stands for its first answer. A budget does not change an edit tier's start in the replay. The store cannot show whether a running background tier delays it: 272 edit tiers have a revision row, and those that met a running background tier in their worktree did not start later (cezar p50 29 s against 47 s; squeal 7.7 against 8.9 s) **[exp]**. The named waits of `load-slowdown.md` finding 4 grow with busy band (61 s at 16–20, 62 s at 20–24). The adaptive budget leaves host time above 16 at 26%, so those figures predict no change in named waits **[inf]**.
- **Foreground gains flatten below 18.** From 20 to 18 the edit gain grows by 1.9 points, and from 18 to 14 by only 1.7 more. The background's p90 finish meanwhile grows from 190 s to 518 s. Other load alone holds the host above 16 for 9.1% of the time and above 18 for 4.4%, and no background policy goes below those figures **[exp]**.

**Against the earlier files.** `background-backoff.md` found −4.5% background CPU and others' slowdown 1.316 → 1.252 for the same controller over 2026-10-29 to 11-07. That still stands; this week was busier (host above 20 busy 11.4% against 7.3%), so the saving is larger. `daemon-model.md` Q4 reported a median wait of 4.3 h and −13% edit-tier wall at a ceiling of 16. That changed: its model had no floor and no chaining, and charged deferred work its recorded CPU. With both turned off here (`out-sens.jsonl`), a ceiling of 16 gives −14.3% edit-tier wall, a p90 tier wait of 54 min, and a median finish of 63 min for tiers that arrive above 20 busy. The floor alone gives a p90 wait of 26 min, the chain alone 10 min, and both 4 min. The rest of the gap to 4.3 h is that file's queue accounting; not determined.

**Variants** (`out-hw.jsonl`, `out-owork.jsonl`, `out-sens.jsonl`) **[inf]**:
- If the slowdown above 19 busy is run-queue waiting and burns no CPU (`CURVE=hw`, `load-slowdown.md` finding 3's low bound), the adaptive budget saves 3.6% of Squeal CPU, not 9.5%, and most of that is work it did not run. Walls are unchanged.
- With other load held as fixed work, the replay of `none` runs away: 58.8% of the time above 16 busy against 25.3% recorded. Above about 19 busy, (O + E) × S′/S > 1, so one more core of load slows other work enough to need more than one more core. The variant is out of the conclusions. It still shows the budget's protective value: under a fixed-work model the host near the top of the curve is unstable.
- Floor 2 → 4 cores: Squeal CPU −4.8%, edit −2.9%, backlog p90 33 min. Floor near 0: CPU −13.5%, edit −11.2%, backlog p90 59 min, tier p90 7.9 min. The floor sets most of the tradeoff.

### Q2. Work that need not run

**[inf]** Work-hours of isolated work, out of 328.0 h of background work arriving in the week:

| Policy | Deferred | Stale at admission | Worktree removed first | Share of all background work skipped |
|---|---|---|---|---|
| adaptive θ 1.25 | 77.7 (23.7%) | 2.2 (2.8% of deferred) | 6.1 (7.9%) | 2.5% |
| ceiling 18 | 62.4 | 1.4 | 4.3 | 1.7% |
| ceiling 16 | 94.9 | 3.2 (3.4%) | 10.7 (11.3%) | 4.2% |
| ceiling 14 | 130.0 | 8.7 (6.7%) | 18.0 (13.8%) | 8.1% |
| ceiling 16, no floor | 89.1 | 7.4 (8.3%) | 22.1 (24.8%) | 9.0% |

These figures are in the Q1 totals. Stale work is small because most waits are minutes: `unread-work.md` found that only 1.6% of background seconds re-ran within 5 min. Removal outweighs staleness 3 to 1, which matches `unread-work.md`: unread work is the end of a worktree's life. A budget gets that saving only when it defers work past the removal. `unread-work.md`'s task-end stop gets the same saving directly.

### Q3. Agents' own runs

**[inf]** 3,279 foreground agent test runs in the window (transcripts, 011-181's `extract.py` and `classify.py`; background runs left out), 43.5 h of wall. They are in O: no budget defers them. Their wall scales with S(B′)/S(B) at their times. Adaptive θ 1.25: 39.7 h (−8.8%, 0.55 h a day, 4.2 s a run). Ceiling 20: −7.4%. Ceiling 16: −10.6%. Ceiling 14: −11.2%. This is the largest gain in hours, as `load-slowdown.md` finding 3 led one to expect (Squeal added 7 to 12% to these runs). It assumes that a faster run does not make agents start more runs.

### Q4. Signal on other machines

What depends on this host **[inf]**: the curve's shape (knee at 14–16 busy, throughput peak at 18, run queue above 20 on 24 vCPUs over 16 physical cores, `load-slowdown.md` findings 1 and 6), the share of other load (Q1), and the pool setting (`hostSlots` 12 here, default `availableParallelism() − 1`, `src/core/capacity/pool.ts:139` **[src]**).

| Machine | Fixed ceiling 16 | Own-slowdown θ 1.25 | Can a budget finish background work sooner? |
|---|---|---|---|
| This VM, 24 vCPUs | at the knee | fires at about 16.4 busy, between knee and peak | Not this week: other load dominated above the peak (Q1) |
| Laptop, 8 cores, 16 threads | never binds: 16 is every thread | fires where its tests run 25% slower, wherever that is | Likely, when Squeal's background is most of the load. With little other load (b0 = 4), holding background at the peak raises its rate from 8.0 to 10.6 isolated cores on this curve: its work finishes about 24% sooner. The default pool allows `threads − 1` permits of 1.3 to 2.3 cores each (`background-backoff.md` replay), which exceeds the CPU count on any machine |
| 64-thread workstation | binds at a quarter load: starves the background | as above | Only if other load stays low |
| Container with a CPU quota Q | wrong: `nproc` and `/proc` show the host (`background-backoff.md` finding 4, verified) | fires at about 1.25 Q of demand | No. Above Q the processes share Q by time, so throughput stays Q: a budget only reorders work |

- **Signals.** The own-slowdown ratio needs no machine number, so it carries over (`background-backoff.md` finding 2). A busy-core ceiling and a physical-core count do not: a VM hides SMT (this one shows `Thread(s) per core: 1`), and a container hides its quota. Host-wide PSI (`/proc/pressure/cpu`) rises smoothly through the knee with no step, and its value at the knee depends on the machine (`background-backoff.md` finding 4). Inside a container, the cgroup's own `cpu.stat` reports `nr_throttled` and `throttled_usec` for "throttling caused by this cgroup's own bandwidth limit" **[docs]**, and `cpu.max` gives the quota. Whether a cgroup's `cpu.pressure` counts throttled time is not stated on the fetched PSI page: not determined.
- **How the answer moves.** A budget pays off in time only when background alone passes the throughput peak. Holding it there then gains up to 31% in background rate on this curve. The more other load there is, and the flatter the curve's top, the less it gains. A machine whose knee sits lower, relative to the background that a default pool allows, gains more. A CPU quota gains nothing in total. The CPU saving per unit of work (Q1) follows the slowdown the budget avoids, so it moves with θ, not with the core count.

### Q5. Where it lives

**[inf]** A budget protects one machine's CPU, so it counts the runs on that machine. A remote runner host (`daemon-model.md` Q3, `runner-split.md`) runs on its own machine. Its file durations are not comparable with local ones: the reference of each (project, file) must be kept per machine (per environment descriptor). Otherwise a fast remote host reads as "no slowdown" and a slow one as overload. The local budget then counts only local runner hosts. A remote host's admission follows a budget computed from its own records on its machine. The user's own pool cannot see other users of a shared remote host. The own-slowdown signal still sees their load as slower files, and additive-increase, multiplicative-decrease budgets back off together without coordinating (`background-backoff.md` Q3). So one budget per machine and user, fed by the runs on that machine, serves local and remote alike.

### Q6. Recommendation

1. **Adopt the adaptive own-slowdown budget** of `background-backoff.md` as specified there: θ = 1.25 on the pooled median file ratio, two 60 s windows above θ before halving, +1 permit per window at or below θ, at most `hostSlots`. Apply it to backlog tiers and baselines. Remove the `grants < hostSlots / 2` term (`src/core/capacity/cores.ts:77` **[src]**). No fixed ceiling: it is wrong on every machine but one (Q4).
2. **Scope:** per user and machine, across all daemons, one budget file in the pool directory (`background-backoff.md` Q3). A remote runner host has its own (Q5). Edit tiers, named waits and agents' runs stay outside it and feed the signal.
3. **Floor:** one permit for the oldest waiter. The floor sets most of the tradeoff (Q1 variants). The coordinator or the human should choose it as a product value. One permit gives backlog p90 47 min and −6.4% edit-tier wall; none gives 59 min and −11.2%.
4. **Expected effect, on this week:** Squeal CPU −9.5% (−3.6% if the top of the curve is run-queue waiting), 6.3 core-hours a day; host time above 20 busy 13.2% → 6.7%; edit-tier wall −6.4%; agents' test wall −8.8% (0.55 h a day); other work 8% faster. Background: tier finish p50 10 → 20 s, p90 1.5 → 3.9 min (a median 9 s, a p90 2.4 min later); backlog finish p90 30 → 47 min; nothing left queued at the end. Say plainly that it trades background latency for foreground speed and CPU. It does not finish background work sooner on a loaded shared host. It may on a quiet laptop (Q4).
5. **Measure after it ships** (daemon log per budget step), on this host and on one other machine: CPU per file against its reference, before and after; background tier finish p50/p90; edit-tier wall; host time above θ's busy level. On the other machine, also measure whether background alone passes the peak.

## Open questions

- For the human: background results a median 9 s and a p90 2.4 min later per tier, and a backlog p90 18 min later, for about 6% faster edit tiers, 9% faster agent test runs and 10% less CPU. This replaces `daemon-model.md`'s "4.3 h later": that figure came from a model without the floor and the chain.
- Not determined: whether other load behaves as fixed cores or fixed work. Fixed work runs away near the top of the curve (Q1 variants). Agents wait for results, so the truth lies between the two models. A per-run record of agents' test CPU would settle it.
- Not determined: the curve on a laptop or in a quota container. The rules forbid making load here. The first measurement belongs to another machine (Q6 item 5).
- Not determined: how much of O is Squeal's own daemon main threads (0.5 to 1.0 core per busy cezar daemon, `daemon-model.md` Q1). sar does not separate them, and the budget does not govern them.
- Not determined: whether cgroup `cpu.pressure` includes CFS throttling.

## Sources

- Earlier files: `../../011-core/research/load-slowdown.md` (curve, finding 3, finding 6), `background-backoff.md` (controller, signal, `replay.py`, `signal.py`), `manual-mode.md`, `unread-work.md`, `daemon-model.md` Q1, Q3 and Q4 and its `probes/daemon-model/budget.py`.
- Stores and run reports: `~/projects/{squeal,cezar,toolkit-dev}/.git/squeal/` (`store.sqlite` with `-wal`/`-shm`, `runs/*/report.json`), copied 2026-11-11 15:20Z, read with `node:sqlite` read-only. 45,453 runs; in the window 37,145 background tiers, 3,866 edit tiers, 912 `run --all`.
- Cezar task databases: `~/projects/{cezar,squeal}/.ai/cezar/runs.db` copies, 4,292 removal times.
- sar: `/var/log/sysstat/sa03` to `sa11`, `sadf -d -U … -- -u`, 939 samples in the window, 13 with steal above 2%.
- Transcripts: `~/.claude/projects/*/*.jsonl` with `subagents/`, `~/.codex/sessions/*/*/*/*.jsonl`, read by `../../011-core/research/probes/host-load/011-181/extract.py` and `classify.py`: 3,364 test runs, 3,279 in the foreground and in the window.
- Source at `a246213ed`: `src/core/capacity/cores.ts:77` (`gatedPermits` floor), `src/core/capacity/pool.ts:139` (`defaultHostSlots`), `src/core/daemon/low-priority.ts:13` (`TEST_NICE`), `src/core/scheduler/yields.ts` (`YIELD_REMAINDER_MS`: a running tier yields to edits only when more than 30 s remain). Host setting: `~/.config/squeal/config.json` `capacity.hostSlots` 12.
- Docs, fetched 2026-11-11 (docs.kernel.org, current; the pages name no version): https://docs.kernel.org/admin-guide/cgroup-v2.html (`cpu.max`, `cpu.stat` `nr_throttled`, `throttled_usec`), https://docs.kernel.org/accounting/psi.html.
- Probes: `probes/cpu-budget/` (README there).
