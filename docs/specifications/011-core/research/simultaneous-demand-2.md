# 011-423: two worktrees changed at once, measured again with 0.1.578

Researcher of row 011-423, 2026-11-20. Brief: `research/simultaneous-demand-2-brief.md`. Follows `research/simultaneous-demand.md` (row 011-420), whose arms, harness and S2 shape this row reuses. Read: that file and its probes, spec 011 C4 step 5 and C10, `src/core/capacity/{pool,share,marks}.ts` at 0.1.578.

**What was measured.** Base is the released 0.1.578 (`squeal--v0.1.578`, `9387fe8d4`: rows 011-417, 011-418 and 011-419 in). q and qc are 011-420's patches on it; one hunk applied at a 17-line offset, the lines are unchanged (`probes/simultaneous-demand-2/README.md`). Lab VM (12 vCPUs), 2026-11-20 16:35Z to 22:38Z, squawk at `c11e4edf0`, Node 26.13.0, default capacity config (11 slots, ceiling 9 busy CPUs). 011-400's S2 shape: 290 Vitest files per copy, both copies edited within a second. Each run restored both copies' stores from the warm-up's snapshot first. Before each run the one-minute load was under 1 (0.78 to 0.99) and no other task's process ran (`results/gate.log`).

**Planned and run.** 30 runs in ten blocks of three (`base q qc`, then `qc q base`, alternating), then two base runs keeping the store. The coordinator stopped the round at 22:38Z, with the human: from 20:48Z the VM's physical host, which it shares with our main host, ran at load 36 to 43 on 24 CPUs. **21 complete runs, 7 full blocks.** The 22nd run (S-qc-8) was cut and is not used; the kept-store runs did not run. **Runs 17 to 21 (S-q-6, S-base-6, S-base-7, S-q-7, S-qc-7) started after 20:48Z and ran under that host load**: their summed test-file time rose by 37% on average (4,531 to 5,069 s, mean 4,747, against 2,881 to 4,169 s, mean 3,468, before). Blocks 1 to 5 ran before it; block 6 is mixed; block 7 is all under it.

## Answers

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Did 0.1.578 alone remove the narrow first tier's cost? | No. 011-418 splits the narrow start into short 1-wide tiers, but the second copy still reaches more than 3 workers a median 178 s (90 to 307 s, n = 7) after the first copy's backlog starts. In 2 of 7 base runs one copy ran at 1.4 and 2.2 forks on average while both had work and ended 202 and 221 s after the other | verified by experiment, n = 7 |
| 2 | Does qc still pay? | Yes for the start: per block, qc cuts the lag to width by a median 176 s (99% of base's median), 95% interval −297 to −90 s, sign-flip p 0.035, 7 blocks; 6 of 7 blocks favour qc, and the seventh ran under host load | verified by experiment, n = 7 blocks |
| 3 | Does q still pay? | Less clearly: lag −93 s per block (−52%), interval −178 to +115 s, p 0.21, 7 blocks; in blocks 1 to 5 −157 s, p 0.066. Its 6 + 3 split can leave the 3-worker copy at 3 workers (S-q-3: 149 s) | verified by experiment, n = 7 blocks; unconfirmed |
| 4 | End gap, wall time, CPU | Unconfirmed: qc's end gap −33 s per block (p 0.25); wall time −86 s (−12.5%, p 0.051) and host CPU −988 CPU-s (−18%, p 0.035) per block, but blocks 6 and 7 ran under the shared host's load. A wall-time answer needs a quiet, isolated machine | verified by experiment, unconfirmed |
| 5 | Why were 011-420's first runs about 170 s slower? | Not determined. With every store restored, the base runs before the host load took 614 to 759 s with no trend by position, near 011-420's slow first runs (620 to 644 s), not its fast second runs (420 to 476 s). That fits a store carried between runs making later runs faster; the kept-store runs that would test it did not run | measured: verified by experiment; cause: inferred |

## 1. Lag to width, the start of the second copy

011-418 changed what a narrow start looks like. In base the second copy now runs several short tiers at 1 worker (10 and 8 files, about 20 s each), is refused while the first copy's 200-file tier holds the ceiling, and starts wide only when that tier ends; then the first copy has often taken the ceiling again for its next tier. So "the longest tier of 20 files or more at 3 forks or fewer" (011-420's measure) misses it. This row's measure, **lag to width**: from the first backlog run of either copy (a Vitest run starting 100 s or more after the edit) to each copy's first backlog run at more than 3 forks on average; a run's lag is the larger of its two copies' (`summary.mjs`). On 011-420's records it reads base 93 and 95 s, q and qc 0 to 1 s.

Per arm, medians [range], 7 runs each (`results/stats.txt`):

| Arm | Lag to width, s | End gap, s | Lowest copy's mean forks while both have work | Wall, s (unconfirmed) | Host CPU-s (unconfirmed) | Peak forks | Samples ≥ 11.5 busy |
|---|---|---|---|---|---|---|---|
| base | 178 [90 to 307] | 59 [20 to 221] | 3.2 [1.4 to 3.9] | 690 [614 to 993] | 5,472 [4,802 to 8,028] | 10 [10 to 11] | 0% [0 to 0] |
| q | 1 [0 to 381] | 79 [23 to 150] | 3.0 [2.2 to 3.8] | 700 [586 to 1,073] | 5,413 [4,477 to 9,165] | 10 [10 to 12] | 0% [0 to 0.85] |
| qc | 1 [0 to 111] | 55 [1 to 68] | 3.2 [2.8 to 3.5] | 672 [578 to 873] | 5,165 [4,221 to 7,040] | 10 [10 to 12] | 0% [0 to 0] |

Per block, arm minus base (`stats.mjs`: median of the block differences, 95% bootstrap interval, sign-flip permutation p):

| Measure | qc − base, 7 blocks | qc − base, blocks 1 to 5 | q − base, 7 blocks | q − base, blocks 1 to 5 |
|---|---|---|---|---|
| Lag to width | **−176 s (−99%)**, [−297, −90], p 0.035 | −176 s, [−304, −90], p 0.066 | −93 s (−52%), [−178, +115], p 0.21 | −157 s, [−298, −89], p 0.066 |
| End gap | −33 s (−55%), [−153, +34], p 0.25 | −58 s, [−156, +35], p 0.19 | −15 s, [−123, +85], p 0.68 | −57 s, [−196, +75], p 0.32 |
| Wall (unconfirmed) | −86 s (−12.5%), [−121, −36], p 0.051 | −66 s (−9.8%), [−110, +40], p 0.19 | +10 s (+1.4%), [−98, +92], p 0.99 | +10 s, [−122, +92], p 0.88 |
| Host CPU-s (unconfirmed) | −988 (−18%), [−1,009, −478], p 0.035 | −582, [−1,009, +363], p 0.13 | −185, [−927, +701], p 0.98 | −185, [−1,191, +701], p 0.63 |

With 5 blocks the smallest sign-flip p is 2/32 = 0.0625, so the 5-block p values of 0.066 are the most a 5-of-5 result can show.

- **The mechanism held** (*verified by experiment*, `results/S-q*.marks.tsv`, `marks-check.mjs`). In all 14 q and qc runs both quiet daemons stated their demand. In the 11 runs before the host load, and in S-q-6 under it, the first grants split 4 to 6 and 3 to 5 permits within 1 to 3 s. In S-q-7 and S-qc-7, the only q and qc runs wholly under the host load, the first daemon took 6 to 8 permits and the second reached more than 3 workers 218 and 111 s later; why the split failed there was not measured. The local pool probe on 0.1.578 gives the same grants as on 011-420's base: 9 + 1, q 6 + 3, qc 5 + 4 (`quiet-share.<arm>.txt`).
- **The narrow start's cost now lasts past the first tier** (*verified by experiment*): permits are never taken back, so in S-base-2 and S-base-3 the narrow copy stayed at 1 to 3 workers until the other copy's backlog ended (lag 298 and 307 s). qc's 5 + 4 start gives both copies a wide first tier, and the shares stay closer after it (end gap 1 to 68 s against 20 to 221 s).
- **No overshoot in any arm.** 011-419 removed the beside tiers: none opened in 21 of 21 runs (`overrun-check.mjs`). Peak forks 10 to 12; samples at 11.5 busy CPUs or more 0 to 0.85%. The higher overshoot of q and qc in 011-420 is gone with it (*verified by experiment*).

## 2. Wall time and CPU

Unconfirmed. Before the host load, qc's wall time was below base's in 4 of 5 blocks (−36 to −110 s) and above in one (+40 s); q's had no direction (+92 to −122 s). Host CPU-s includes the VM's whole busy time, so it rose with the shared host's load too. The file times hint that qc also ran the same files in less summed time (−537 file-s per block, p 0.035 over 7 blocks, p 0.13 over 5), which would fit less contention, but that is not established.

**What a wall-time answer needs.** A quiet, isolated machine: boat.dev, the new standing place for such work, not this VM, whose physical host also carries our main host. From the five quiet blocks, qc's per-block difference has a standard deviation of 58 s: to show a 50 s (7%) effect at 80% power and a two-sided 5% level takes about 13 blocks (39 runs, about 8 h at 12 min a run); a 70 s effect about 8 blocks. q's differences spread more (SD 93 s): about 30 blocks for 50 s (*inferred*, normal approximation).

## Recommendation for Squeal

Inferred from the above.

1. **Adopt qc as a row** (011-420's recommendation, unchanged): a quiet that holds backlog states its demand within 30 s of its end, and a backlog tier's fair share divides the ceiling's CPUs. With 0.1.578 it still removes the second worktree's slow start (−176 s per block, 6 of 7 blocks, p 0.035), at no measured cost: no overshoot, no worse end gap, wall time unconfirmed and pointing down.
2. **Not q alone:** its 6 + 3 split leaves one copy at 3 workers and did not confirm.
3. **Measure wall time on boat.dev** after it lands, if the human wants that number: 13 blocks of base and qc for a 50 s effect.

**Spec text.** 011-420's text still holds; 0.1.578 changed nothing it relies on (*read in source code*: the patches apply with an offset only).

- 011 C10 (Backlog and checkpoint tiers), replace "the host's slots divided by the daemons with backlog work (holders, and waiters marked in the last 30 s)" with: "the host's slots divided by the daemons with backlog work (holders, waiters marked in the last 30 s, and daemons whose wait for quiet, C4 step 5, holds backlog files and ends within 30 s: their mark states those files, at most 64, as demand with no grant until a tier asks or the wait ends; amended, rows 011-420 and 011-423: with two worktrees edited at once, the second reached more than 3 workers a median 178 s after the first's backlog started, at 0.1.578). A backlog tier's share divides the background ceiling's CPUs (021 D18), rounded down and at most the slots, instead of the slots."
- 011 C4 step 5, after the catch-up quiet's paragraph: "While the wait holds backlog files and ends within 30 s, the daemon states them in its pool mark (C10), so a daemon whose wait ends first leaves this one its fair share."

**Risks for one worktree** (unchanged from 011-420, *inferred*): a quiet that keeps restarting could hold another daemon to half the ceiling; the 30 s lead bounds that. With one daemon nothing changes (local probe: 9 in every arm). No one-daemon run was made this round.

## Open questions

- Wall time and CPU: unconfirmed; see section 2 for the run count.
- The cause of 011-420's first-run slowness: not determined; the kept-store runs did not run.
- Why the 5 + 4 split failed in S-q-7 and S-qc-7, under the shared host's load: not measured.

## Sources

- Squeal 0.1.578 (`9387fe8d4`): `src/core/capacity/{pool,share,marks}.ts`, `src/core/scheduler/{quiet,tier-live,capacity}.ts`.
- Spec 011 C4 step 5, C10; spec 021 D18; `research/simultaneous-demand.md`.
- This row: `probes/simultaneous-demand-2/` (README, the two rebased patches, `quiet-share.ts` and its outputs, the VM harness, `filedur.mjs`, `summary.mjs`, `stats.mjs`, `results/`: `gate.log`, `sha256.txt`, `summary.jsonl`, `stats.txt`, `stats-blocks1-5.txt`, `runs-table.md` with each run's position, block and host-load mark, and the `S-*` records).
