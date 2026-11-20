# 011-420: a daemon in its catch-up quiet claims its fair share

Researcher of row 011-420, 2026-11-20. Brief: `research/simultaneous-demand-brief.md`. Read: `docs/vision.md`, `docs/styleguide.md`, `research/run-width-design.md` (row 011-413) and its probes, spec 011 C4 step 5 and C10, spec 021 D18, `src/core/capacity/{pool,share,marks,cores}.ts` and `src/core/scheduler/{quiet,tier-live,tier-pick,capacity,step}.ts`.

**What was measured.** Every arm is main `294c8ac41` plus row 011-417's commit `33c46c323` (fresh CPU readings, branch `cez/b7aab7d9`, not on main at the time; the coordinator's correction). Rows 011-418 and 011-419 are in no arm. Lab VM (12 vCPUs), 2026-11-20 11:10Z to 14:30Z, squawk at `c11e4edf0`, Node 26.13.0, default capacity config (11 slots, ceiling 9 busy CPUs). One warm-up, then six two-daemon runs in the order base, q, qc, qc, q, base, then six one-daemon runs in the order base, q, qc, qc, q, base. Before each run the driver waited until the one-minute load was under 1 and no other task's process ran: 0.80 to 0.99 (`probes/simultaneous-demand/results/gate.log`).

## The arms

- **base**: main + 011-417.
- **q, quiet demand** (`q-quiet-demand.patch`): while a lane's wait for quiet holds queued backlog files and ends within 30 s, the daemon's pool mark states them as demand (`want` the held files, at most 64; no new grant). The other daemons' fair shares, which count marks with `want > 0` (`fairShares` over the 11 slots), then count it. The mark is written at each pump look (the pump looks every 1 s while a quiet holds), at most every 5 s when unchanged, and the demand ends when a tier asks or the quiet ends.
- **qc, quiet demand and a ceiling share** (`qc-ceiling-share.patch`): q, and a backlog tier's fair share divides the ceiling's CPUs, `floor(9)` = 9, not the 11 slots.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Does publishing the quiet's demand end the narrow first tiers? | Yes in 4 of 4 runs: both daemons' first backlog tiers start in the same second at 6 + 3 (q) or 5 + 4 (qc) permits, against 9 + 1 in base, where the second ran 59 to 62 files at 1.5 to 2 forks for 88 and 140 s | verified by experiment, n = 2 per arm; mechanism verified by the pool marks and a local probe |
| 2 | Does holding the first grant to a fair share of the ceiling add to it? | Slightly: 5 + 4 instead of 6 + 3. qc had no narrow tier in either run; q had one of 62 s, a later tier, not the first | verified by experiment, n = 2 |
| 3 | Wall time, CPU, samples above the ceiling | Not separated from the run-to-run spread. Run position dominates: every arm's first run took 620 to 644 s and its second 420 to 476 s | verified by experiment, n = 2 |
| 4 | Cost to a single worktree | None measured: one-daemon runs took 755 to 942 s, base 800 and 873 s, with no narrow tier in any arm. Inferred risk: a quiet that keeps restarting would halve another daemon's tiers; the 30 s lead bounds that | measured: verified by experiment, n = 2; risk: inferred |

## 1. The mechanism

*Read in source code* (`src/core/capacity/pool.ts`, `share.ts` at main + 011-417). `#share` divides the 11 slots by `fairShares` among this daemon and the fresh marks with `want > 0`. A daemon in its catch-up quiet holds no lease and asks nothing, so it has no mark, or only a node:test slot's (`want` 1). The first daemon whose quiet ends gets a share of all 11, and the CPU gate (021 D18) cuts it to 9. Permits are never taken back, so the second daemon's first tier gets what the ceiling leaves: 0 to 3.

*Verified by experiment, local* (`probes/simultaneous-demand/quiet-share.ts`, the arm's real `createPermitPool` with fake tree and host readers, 11 slots, ceiling 9; outputs `quiet-share.<arm>.txt`). A asks while B's quiet holds 64 files; A's tier then runs at 0.95 core per worker; B asks.

| Arm | A's grant | B's grant | A alone |
|---|---|---|---|
| base | 9 | 1 | 9 |
| q | 6 | 3 | 9 |
| qc | 5 | 4 | 9 |

In q, B gets 3, not its share of 5: the ceiling counts A's 6 busy workers (9 − 5.7 − 0.3). qc divides the 9 CPUs the ceiling leaves, so the two grants fill it.

*Verified by experiment, VM* (`results/S-*.marks.tsv`, every pool mark each second; `marks-check.mjs`). In all four q and qc runs both daemons' marks stated 64 files of demand with no grant from 107 to 127 s after the edit, both quiets ended within a second of each other, and both took their grants in the same second: 6 and 3 (q), 5 and 4 (qc). In base the first daemon took 9 at 139 to 144 s; the second was refused (`want` 12, grant 0) and got 1 permit 18 to 20 s later.

## 2. Two daemons

011-400's S2 shape: 290 Vitest files per copy, `packages/contract/src/live.ts` edited in both copies within a second, an agent in turn in each copy. Wall: edit to the last file of both copies. First tiers: each copy's first Vitest run of 20 files or more, its length and the copy's mean live forks. Narrow: the longest Vitest run of 20 files or more at 3 forks or fewer on average. Host CPU-s: the VM's busy cores summed over the run (it ran nothing else). `summary.mjs` over `results/S-*`.

| Run | Wall, s | First tiers: length at mean forks | Longest narrow tier | Peak forks | Samples ≥ 11.5 busy | Host CPU-s |
|---|---|---|---|---|---|---|
| S-base-1 | 644 | 97 s at 9.0; **140 s at 2.0** | **140 s** (59 files) | 16 | 2.3% | 5,178 |
| S-base-2 | 420 | 51 s at 8.4; **88 s at 1.5** | **88 s** (62 files) | 11 | 0% | 2,783 |
| S-q-1 | 644 | 134 s at 4.1; 133 s at 6.7 | none | 18 | 7.8% | 4,967 |
| S-q-2 | 476 | 101 s at 3.7; 88 s at 6.4 | 62 s, a later tier (22 files) | 17 | 5.3% | 3,272 |
| S-qc-1 | 620 | 134 s at 5.1; 137 s at 6.1 | none | 18 | 10.5% | 4,819 |
| S-qc-2 | 472 | 85 s at 4.4; 81 s at 5.1 | none | 17 | 3.2% | 3,273 |

- **The narrow first tier is gone in q and qc** (4 of 4 runs), and both copies start their backlog together, where in base the second started 18 to 20 s later.
- **S-q-2's 62 s tier** started at 227 s, after the first tiers: copy 2 got 2 permits while copy 1's next tier held 5 to 6. Permits are never taken back, so a narrow later tier can still form; the quiet's demand does not touch it. Row 011-418 (a narrow tier is short) bounds such tiers.
- **Wall time and CPU do not separate the arms.** Run position does: the three first runs took 620 to 644 s and 4,819 to 5,178 CPU-s, the three second runs 420 to 476 s and 2,783 to 3,273 CPU-s, the same order in every arm. The cause is not determined (the clones' stores carry durations from run to run; the VM's page cache warms). Within a position, q and qc were 0 to 24 s faster than base in the first runs and 52 to 56 s slower in the second: inside the spread at n = 2.
- **More samples above the ceiling in q and qc** (3.2 to 10.5% against 0 to 2.3%; peak forks 17 to 18 against 11 to 16). The likely cause (*inferred*) is row 011-399's overrun rule, which 011-413 found and row 011-419 fixes: 60 s after a backlog tier starts, 4-file tiers open beside it without a grant (`overrun-check.mjs`, first at +60.0 s in every run). The count during the first tiers is alike (q and qc: 5 to 10 per run; base: 13 and 5), but where they open differs: in q and qc both copies opened them in 4 of 4 runs (2 to 6 each), in base mostly the narrow copy did (2 + 11 and 5 + 0). *Inferred*: beside tiers on both copies, each above a 3- to 6-wide grant, add up to more workers at once than beside tiers on a 1- to 2-wide narrow copy; with 011-419 they go, and the arms' overshoot with them. Not measured.

## 3. One daemon

011-400's H0 shape: 892 files, `packages/contract/src/ci-wait.ts`, the run-loop group held. `o-summary.mjs` over `results/O-*`.

| Run | Wall, s | Mean width | Vitest idle worker-s (tail) | Scope CPU-s | Samples ≥ 11.5 busy | Narrow tier |
|---|---|---|---|---|---|---|
| O-base-1 | 800 | 9.79 | 1,549 (925) | 5,465 | 0.6% | none |
| O-base-2 | 873 | 9.96 | 1,791 (1,222) | 6,213 | 0.6% | none |
| O-q-1 | 942 | 9.76 | 2,031 (1,228) | 6,609 | 0% | none |
| O-q-2 | 857 | 9.36 | 1,624 (1,042) | 5,961 | 0% | none |
| O-qc-1 | 755 | 8.81 | 1,145 (898) | 5,090 | 0% | none |
| O-qc-2 | 875 | 10.15 | 2,344 (1,224) | 6,262 | 0% | none |

With one daemon no other mark reads the quiet's demand, and the ceiling share (9) equals what the CPU gate allowed anyway (local probe case 2: 9 in every arm). Base took 800 and 873 s, q 857 and 942 s, qc 755 and 875 s: the arms overlap, and runs differ by up to 120 s within an arm, so n = 2 cannot show an effect below about 15%. None is expected from the source (*inferred*). Scope CPU (5,090 to 6,609 CPU-s) follows wall time; no arm left more Vitest workers idle (1,145 to 2,344 worker-s).

## Recommendation for Squeal

Inferred from the above.

1. **Adopt qc: a quiet that holds backlog states its demand, and a backlog tier's fair share divides the ceiling.** It removes the narrow first tier of simultaneous edits (88 to 140 s at 1.5 to 2 forks in base; none in qc), starts both worktrees' backlogs in the same second, and costs one mark write every 5 s during the last 30 s of a quiet. q alone leaves a 6 + 3 split, because the share divides the 11 slots while the ceiling allows 9.
2. **Ship it after rows 011-418 and 011-419, or with them.** 011-419 removes the beside tiers that put q and qc above the ceiling more often than base; 011-418 bounds the later narrow tiers that permits never taken back still make (S-q-2).
3. **Measure wall time only after both**, with the run order interleaved and about 10 runs per arm; at n = 2 run position (about 170 s) hides any arm effect here.

**Spec text, 011 C10** (Backlog and checkpoint tiers), replace "the host's slots divided by the daemons with backlog work (holders, and waiters marked in the last 30 s)" with: "the host's slots divided by the daemons with backlog work (holders, waiters marked in the last 30 s, and daemons whose wait for quiet, C4 step 5, holds backlog files and ends within 30 s: their mark states those files, at most 64, as demand with no grant until a tier asks or the wait ends; amended, row 011-420: two worktrees edited at once both waited out the 120 s quiet, the first took the whole ceiling and the second's first tier ran 88 to 140 s at 1.5 to 2 workers). A backlog tier's share divides the background ceiling's CPUs (021 D18), rounded down and at most the slots, instead of the slots."

**Spec text, 011 C4 step 5**, after the catch-up quiet's paragraph: "While the wait holds backlog files and ends within 30 s, the daemon states them in its pool mark (C10), so a daemon whose wait ends first leaves this one its fair share."

**Risks for one worktree.**

- *Idle CPUs while another worktree's agent keeps editing* (inferred, not measured). Without the 30 s lead, a quiet that restarts at every edit would hold another daemon to half the ceiling for as long as the editing goes on, with half the CPUs idle. The lead states demand only once the quiet has been quiet for 90 s; each new edit withdraws it within a pump look. A quiet that ends with no backlog tier started (the files settled meanwhile) leaves its mark at most 30 s, and then only while another daemon picks a tier.
- *A share of 4 or 5 instead of 9 for the first worktree* while the second's quiet ends. That is the point; the first gets the rest once the second's tier ends, as permits return at each tier boundary.
- *No change with one daemon* (local probe case 2: 9 in every arm; one-daemon runs within their spread).
- *The marks' format does not change*: an older daemon reads the quiet's mark as a holder's demand with no grant, and gives it its share as it would a holder's.

## Open questions

- Wall time: not determined at n = 2; run position dominated it, and its cause (store contents across runs or the VM's caches) is not determined.
- Whether 30 s is the right lead: only 30 s was built. Both quiets here ended within 1 s of each other; a lead shorter than the gap between two worktrees' quiet ends would not help them.
- The overshoot of q and qc with 011-419 applied: inferred to fall, not measured.

## Sources

- Squeal main `294c8ac41` + `33c46c323`: `src/core/capacity/{pool,share,marks,cores,background}.ts`, `src/core/scheduler/{quiet,tier-live,tier-pick,tier-plan,capacity,step}.ts`.
- Spec 011 C4 step 5, C10 (Backlog and checkpoint tiers, Size); spec 021 D18.
- `research/run-width-design.md` (row 011-413) and `probes/run-width-design/` (the harness this probe reuses).
- This row: `probes/simultaneous-demand/` (README, `base-011-417.patch`, `q-quiet-demand.patch`, `qc-ceiling-share.patch`, `quiet-share.ts` and its outputs, the VM harness, `marks.sh`, `marks-check.mjs`, `summary.mjs`, `o-summary.mjs`, `results/`: `gate.log`, `sha256.txt`, `S-*` and `O-*` records).
