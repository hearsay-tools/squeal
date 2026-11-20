# 011-413: a background run stops holding CPUs idle at a fixed width

Researcher of row 011-413, 2026-11-19 to 20. Brief: `research/run-width-design-brief.md`. Read: `docs/vision.md`, `research/broad-change-throughput-2.md` (row 011-400) and its records, spec 011 C4 step 5 and C10, spec 021 D18, rows 011-269, 011-399, 011-404, 011-405, the Squeal source named below at 0.1.570 (`7d02e6671`), and Vitest 5.0.3's source. Round 1 (records, source, a local probe) on this host; round 2 on the 12-vCPU lab VM, 2026-11-19 23:57Z to 2026-11-20 03:00Z.

**VM round.** Squeal 0.1.570 and four VM-only prototype bundles (arm (c) alone was dropped on the coordinator's choice, request 573db6b4). squawk at `c11e4edf0`, Vitest 4.1.10, Node 26.13.0. Default capacity config: 11 slots, ceiling 9 busy CPUs. No other task ran on the VM: before each run the driver waited until the one-minute load was under 1 and no other task's process ran (`results/gate.log`: 0.00 to 0.99). At each edit the load was 0.9 to 2.9, the fresh daemons' own start (`*.load.txt`). One warm-up (23 min), then ten two-daemon runs in the order base, a, b, d, cd, cd, d, b, a, base, then four one-daemon runs: base, cd, cd, base.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Why does a backlog tier start narrow while CPUs are free? | Three causes. (1) A stale reading of this daemon's own CPU: a pool kept active by another lease still counts an ended tier for up to 10 s, so the next tier gets 0 to 2 permits instead of 8. (2) A stale host reading: a waiting daemon reuses a reading up to 30 s old and gets the 1-permit floor instead of 9. (3) In the two-daemon runs at 0.1.570, mostly neither: both daemons end their 120 s catch-up quiet within seconds, the first takes the whole ceiling (the other has published no demand yet), and permits are never taken back | (1), (2): verified by experiment (local probe); (3): verified by experiment (VM run lists), cause inferred from source |
| 2 | Can a running Vitest run widen? | No, without patching Vitest: 5.0.3 keeps its worker `Pool` in a closure and sets `maxWorkers` once per group | read in source code (Vitest 5.0.3; 4.1.10 in 011-400) |
| 3 | Measured effect of each candidate | No arm changed wall time beyond the run-to-run spread (base 462 and 604 s with two daemons). Only (c+d) bounded the narrow tiers (0 and 25 s against 99 to 195 s) and kept the workers under 12 (peak 10 to 11 against 12 to 19). (a) never started its tier. (d) and (b) left the narrow tiers as they were | verified by experiment, n = 2 per arm |
| 4 | A side finding | Row 011-399's overrun rule fires on narrow tiers without a hung file: in every run but one, 4-file tiers started beside a backlog tier, the first 60.0 to 80 s after its start, 1 to 14 per run, without a grant and above the ceiling. It also reports those files as overrunning | verified by experiment (timing, `results/S-overrun.txt`); cause read in source code |
| 5 | Design, spec text, rows, risks | Below: (d) as a defect fix, (c) for narrow tiers, a separate fix of the overrun rule; not (a), not (b) | inferred |

## 1. The causes

**Stale readings** (*read in source code*, `src/core/capacity/pool.ts` at 0.1.570; *verified by experiment*, `probes/run-width-design/stale-cores.ts`, the real `createPermitPool` with fake tree and host readers, 12 CPUs, ceiling 9). A backlog grant is `min(fair share, gated)`; `gated` adds one core per permit from `busy` up to the ceiling. Two inputs of `busy` are old at a tier's start:

- This daemon's cores are `#measured`, its tree's CPU over the last 10 s refresh window, forgotten only when its last lease ends. Spec 011 C10 Size says "plus the cores its tiers use now; so a tier of its own that ended since counts no more". A node:test backlog slot or a lint part keeps a lease open beside the Vitest tiers.
- The host's busy cores beyond the tree are re-read only after 30 s (C10: "A window is fresh for 30 s"). A waiting daemon has no refresh timer.

| Probe case | 0.1.570 | With (d) |
|---|---|---|
| A to C: a node:test slot holds 1 permit; a 9-wide tier at 9.5 / 8.2 / 7.2 cores ends; the next tier asks at once | **0 / 1 / 2** (8 after the next refresh) | 8 / 8 / 8 |
| E: a second daemon waits while the first holds 9 permits (host 9.6 busy); the first ends at t = 20 s | **1**, the floor, at t = 20 s | 9 at t = 20 s |
| E with (b) | — | refused to t = 28 s, 9 at t = 30 s |

011-400's H0 width-1 tier (98 s, a node:test slot open) matches case B or C, and its S2 copy 2 (1 fork for 102 s right after copy 1's tier ended) matches case E (*inferred*). In this round neither showed: no narrow tier formed in the four one-daemon runs, and the two-daemon narrow tiers had cause (3).

**Simultaneous starts** (*verified by experiment*, `results/S-tiers.txt`). Both copies are edited within a second, so their first backlog tiers start 0 to 12 s apart in 8 of 10 runs (58 and 65 s in S-d-1 and S-b-2), 139 to 208 s after the edit. The first takes a 200-file tier at 8.3 to 9.1 forks, which holds the ceiling for 55 to 109 s; the second's first tier gets the rest and keeps it: 54 to 106 files at 1.7 to 3.0 forks for 99 to 195 s. S-b-2 is the exception that looks like cause (2): copy 1's first tier started 1.8 s after copy 2's wide tier ended and still ran 56 files at 1.8 forks for 101 s, under arm (b), whose 10 s wait did not outlast the 30 s host reading (*inferred*). A daemon in its quiet publishes no demand, so the fair share does not hold permits for it (`#share` counts marks with `want > 0`; *read in source code*).

## 2. Measurements

**Two daemons** (011-400's S2 shape: 290 Vitest files per copy, `packages/contract/src/live.ts`). Wall: edit to the last file of both copies. Narrow: the longest backlog tier of 20 files or more at 3 forks or fewer. Peak workers and "≥ 11.5 busy": both copies' forks and the host's CPUs (`results/S-*.q4b.json`, `S-tiers.txt`).

| Arm | Wall, s | Narrow tier, s | Peak forks | Samples ≥ 11.5 busy | Idle CPUs while files wait |
|---|---|---|---|---|---|
| base 0.1.570 | 604, 462 | 118, 104 | 19, 14 | 5.8%, 2.2% | 4.2, 5.0 |
| (a) second instance | 560, 554 | 99, 138 | 12, 15 | 0%, 1.8% | 4.7, 4.8 |
| (b) wait for a fair grant | 648, 572 | 141, 101 | 19, 14 | 6.2%, 0% | 4.4, 5.1 |
| (d) fresh reading | 490, 658 | none, 195 | 14, 18 | 0%, 6.1% | 4.9, 4.3 |
| (c+d) short narrow tiers | 545, 494 | none, 25 | 10, 11 | 0%, 0% | 5.1, 5.3 |

- **Wall time does not separate the arms.** Base alone spans 462 to 604 s; every arm's mean (520 to 610 s) is inside it. The spread comes from which copy gets the narrow tier and from per-file time under contention: copy 1's summed file time ranged 1,155 to 2,115 s for the same 290 files. Two runs per arm cannot show a 10% effect here; about 10 per arm would.
- **(c+d) bounds the narrow tier** (25 s at most against 99 to 195 s) and **keeps the host under the ceiling's overshoot** (no sample at 11.5 busy CPUs, peak 10 to 11 forks). Its cost shows in the tail: up to 19 Vitest runs per copy, several of 1 to 3 heavy files at width 1 to 2 while the other copy holds 5 to 6 permits.
- **(a) never started a tier.** While the other copy's wide tier held the ceiling its offer stayed under 3; once it ended, the overrun rule's tiers (section 3) held the lane's second instance, and a lane has two at most.
- **(d) and (b)** do not touch cause (3), the only one these runs met.
- The scopes' memory (`memory.current`) read empty, so the second instance's memory was not measured.

**One daemon** (011-400's H0 shape: 892 files, `packages/contract/src/ci-wait.ts`, the run-loop group held; `results/O-*`).

| Arm | Wall, s | Mean width | Vitest idle worker-s (tail) | Scope CPU-s |
|---|---|---|---|---|
| base 0.1.570 | 651, 671 | 8.85, 8.92 | 930 (837), 1,023 (741) | 4,117, 4,155 |
| (c+d) | 627, 649 | 8.96, 9.12 | 817 (717), 932 (723) | 4,006, 4,110 |

(c+d) was 23 s (3.5%) faster with 2% less CPU: small and unconfirmed at n = 2. No narrow tier formed in either arm. 0.1.570's base took 651 to 671 s where 011-400's H0 took 902 s at 0.1.563, but the versions, warm-ups and stores differ, so the cause of that gap is not determined.

## 3. The overrun rule fires on narrow tiers

Row 011-399 opens a tier beside one whose every unfinished file has run `max(10 × its last-known time, 60 s)`, counted from the tier's start, because the daemon does not know when a file of the tier started (`src/core/scheduler/overrun.ts`, *read in source code*). A narrow tier holds dozens of files that have not started; after 60 s each of them looks overrun. In 9 of 10 runs 4-file tiers started beside a backlog tier, the first at +60.0 to +80.0 s (most at +60.0), 1 to 14 per run (*verified by experiment*, `results/S-overrun.txt`). They run without a grant, so the peak forks above 12 in base, (b) and (d) are partly theirs, and `reportedOverrunAt` reports those files as overrunning in status, the named wait and the late line (*inferred* from source; the status at those moments was not captured). So 0.1.570 already widens a narrow tier after 60 s, by a mechanism meant for hung files.

## Recommendation for Squeal

Inferred from the above.

1. **(d) Fresh pool reading: a defect fix, on its own row.** When a lease ends or returns permits, the pool counts the workers it still holds until a new window is measured; a backlog gate re-reads the host once its reading is 1 s old. It is what C10 already says for the own cores. Wall time effect: not measurable here; it removes the 0-to-2 and floor grants of cases A to E. Spec C10 Size, replace "less what its tree used in that window, plus the cores its tiers use now" onward with: "... plus the cores its tiers use now: when a lease ends or returns permits, its daemon counts the workers it still holds until a window that starts then is measured. A backlog tier's gate reads the host over the window since the last read once that is 1 s old (amended, row 011-413: a window up to 30 s old gave a waiting daemon the 1-permit floor on an idle host)."
2. **(c) A narrow tier is short.** C4 step 5, after "stays within 120 s, or half of `runner.timeoutMs` when that is less": "times the offer's share of the background ceiling (D18), at most 1, so a backlog tier offered few workers selects little and its width is chosen again soon (amended, row 011-413: two daemons' narrow tiers ran 99 to 195 s at 1.7 to 3 forks; scaled, 25 s at most)." The trim at a grant below the offer uses the grant's share. Ship it together with (d).
3. **Fix the overrun rule's false positive, on its own row** (011-399 follow-up): a tier overruns only after none of its files has ended for the threshold (no progress), or once Vitest names a file's start; not 60 s after the tier's start. Then (c) carries the narrow tiers, and the second instance stays free for hung files and named waits.
4. **Not (a).** It never fired here, contends with rows 011-269 and 011-399 for the lane's two instances, and costs an instance start and `globalSetup` per opening; (c) gets the re-pick without it. **Not (b):** no effect on cause (3), up to 10 s of delay.
5. **Open, not built:** cause (3) itself. A daemon whose catch-up quiet holds backlog could publish its demand, so the first daemon's grant leaves its fair share. Not measured; a research row if the human wants simultaneous edits in several worktrees faster.

**Rows.** R1 (defect): (d), tests from `stale-cores.ts` cases A to C and E. R2: (c), a tier offered 1 of 9 workers selects at most about 13 s of files, one offered 9 is unchanged. R3: the overrun rule counts from the tier's last progress. R4 (optional research): demand during the catch-up quiet.

**Risks.** CPU above the ceiling: (c+d) lowered it (0% of samples at 11.5 busy, against up to 6%); R3 lowers it further. Fairness: (d) lets a waiting daemon take the whole ceiling at once (case E: 9) where it took 1; permits are still never taken back, so the next daemon waits for that tier, as the first daemon's 200-file tier makes it wait today. (c) adds Vitest runs (about 1 s each) and more tier tails. Two-instance bound: unchanged by R1 to R3; (a) would break it.

## Open questions

- Wall time at n = 2 is inside the noise; a 10-run comparison of base and (c+d) with two daemons would confirm or refute a 5 to 10% effect.
- The second instance's memory: not measured (`memory.current` read empty).
- Whether the overrun reports of section 3 reached status and the late line in these runs: inferred from source, not captured.

## Sources

- Squeal 0.1.570 (`7d02e6671`): `src/core/capacity/{pool,cores,marks,background}.ts`, `src/core/scheduler/{tiers,tier-pick,tier-pass,tier-width,tier-start,tier-plan,beside,overrun,backlog,capacity,step,step-live}.ts`, `src/core/daemon/{daemon,slow-instance}.ts`, `src/runners/vitest/width.ts`.
- Spec 011 C4 step 5, C10 (Capacity, Size, Runner ceiling); spec 021 D18.
- Vitest 5.0.3: `node_modules/vitest/dist/chunks/index.DpLw24bj.js` lines 11465–11565 (`Pool`, `setMaxWorkers`, `schedule`), 11682 (`createPool`), 11779–11780.
- 011-400's records: `probes/broad-change-throughput-2/results/{H0,S2}.*`.
- This row: `probes/run-width-design/` (README, `stale-cores.ts` and its outputs, the four patches, the VM harness, `analyse.mjs`, `overrun-check.mjs`, `results/`: `gate.log`, `S-*` and `O-*` records, `S-tiers.txt`, `S-overrun.txt`).
