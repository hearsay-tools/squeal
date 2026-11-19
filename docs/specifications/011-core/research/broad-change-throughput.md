# 011-395: where the time goes when one edit queues 1,200 test files

Researcher of row 011-395, 2026-11-19, 05:38Z to 07:25Z. Brief: `research/broad-change-throughput-brief.md`. Read: `docs/vision.md`, `research/issue-245.md`, `issue-209.md`, `issue-225.md`, `020-quality-gate/research/issue-216.md`, `research/edit-load.md`, `019-run-triggers/research/load-split.md`, spec 011 C4 (step 5) and C10, spec 021 D18, issue #245 and its comments.

**Setup.** Squeal **0.1.563** (`git archive v0.1.563 plugins/claude-code`; this repository's `src/` is identical to the tag). Repository: squawk at `c11e4edf0` (2026-11-18 21:41Z, the day of the #245 incidents), sent as a `git bundle`. Machine: the 12-vCPU lab VM named in the shared notes, Node 26.13.0, a private `HOME` and `XDG_RUNTIME_DIR` (no shared permit pool, no user capacity config: `hostSlots` 11, background ceiling 9 of 12 CPUs). The only other activity on the VM was the sibling row 011-394's observer process at 0% CPU. Every load figure below is the VM's one-minute load and comes from Squeal's own work. Probes, outputs and how to re-run them: `probes/broad-change-throughput/README.md`.

**Edit.** One comment line appended to `packages/contract/src/ci-wait.ts`, the file in the second #245 report. After a warm-up run of the fast lane (1,514 files in about 690 s), the edit queued 1,297 test files within 1 s. Of these, 97 are browser files that squawk runs only on request, so 1,200 ran: 1,192 Vitest and 8 node:test. `squeal reach` predicted 1,200 files and 3,752 recorded s. The #245 reports had 1,190 to 1,571 files.

**One difference from the incidents.** No harness session was attached, so squawk's `run-loop` group (`at: pause`, the parity and worker tests) ran in its own lane, in tiers of 4, beside the backlog. 311 of the 1,200 files are in that group. In the incidents, agents were mid-turn. *Read in `squeal.config.json` and verified by experiment.*

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Throughput and overhead | Squeal: **1,200 files in 1,143 s, 63 files/min**. Plain `vitest run` of the same 1,192 files: **509.5 s, 140 files/min**, so plain is 2.2× faster. Squeal's 633 s extra is **55% of its wall time**. Split by lost CPU capacity: extra CPU work 24% (daemon 13%, test processes 11%); runner part and catch-up quiet before the backlog started 14%; backlog tiers running only 6.4 of 12 cores busy 57%; unassigned 4%. Directly measured parts: pool admission waits 5 s; runner part 22.5 s; store write-lock holds 66 s, part of the daemon's CPU; no listing; heartbeat never older than 5.8 s; no re-queue, because A had a single edit. VM load mean 6.6, max 9.8 | verified by experiment (times, CPU); shares inferred |
| 2 | A second edit mid-queue | Edited test file: result **30.8 s** after its edit, ahead of about 780 queued files. Named file: result **57.7 s** after the wait began, the wait returned in 59.9 s. Each edit cancelled the running backlog tier: its finished files were kept (94 of 132, 35 of 53) and the rest re-queued (38, 18, plus 4 of a cancelled 4-file tier). A test-file edit stopped the backlog lane for **129 s** (the 120 s catch-up quiet restarts). A second edit of the shared source re-ran **824 of 836 files already finished (2,387 file-s, 99% of the work done before it)**: in all, 2,049 file runs for 1,215 files. VM load mean 7.7, max 14.4 | verified by experiment |
| 3 | Estimate at the start | The estimate `squeal code` already makes (`estimateRun`: sum / (CPUs − 1), unknown durations at the median) gave **378 s for A (−67%)** and **465 s at B's third edit (−55%)**. Adding the two fixed delays (runner part and 120 s quiet): −54% and −41%. The C4 backlog tier model at 9 workers: −42% and −23%. At 6 workers: −20% and **+4%**. With complete stored durations the work total is known within 4%; the main error is the width Squeal reaches, about 5 to 6 of 12 CPUs | verified by experiment (measured times); estimates computed from the store |

## 1. Throughput, and what Squeal adds

**Measured** (experiment A, edit at 05:59:18Z, VM load 3.0 at the edit; mean 6.6, max 9.8 during the drain). Plain run at 06:26Z with the daemon stopped, VM load 0.1 before it.

| | Squeal 0.1.563 | Plain `vitest run` + `node --test` |
|---|---|---|
| Wall, edit to last result | 1,142.7 s (node:test lane done at 175.7 s) | Vitest 509.5 s at squawk's 12 workers; node:test 130.5 + 50.2 s run one after the other |
| Files per minute | 63 | 140 (Vitest) |
| CPU-s | 6,746 (scope: daemon and every test process); daemon 839 | 5,060 (Vitest) + 145 (node:test) |
| Mean busy cores of 12 | 6.0 | 9.9 |
| Tiers | 12 backlog tiers (200, 200, 200, 55, 63, 55, 11, 34, 20, 12, 21, 1 files) + 84 tiers of ≤4 + 8 node:test | one run |

The first backlog tier started at 142.6 s. That is the runner part (closures of 1,297 re-keyed files; the first tier ran at 22.5 s) followed by the 120 s catch-up quiet (C4 step 5), as the code reading predicted. During the quiet the edit's own tiers and the run-loop lane ran on 3.6 cores. *verified by experiment; read in source code, `quiet.ts`, `edit-cut.ts`, `refinement.ts`.*

**The split of the 633 s.** Method: at plain's utilisation (9.93 cores), Squeal's CPU would take 6,746 / 9.93 = 679 s. The rest is capacity Squeal left idle. *inferred from the measured CPU and timeline.*

| Part | Seconds | Share |
|---|---|---|
| Extra CPU work, 1,540 CPU-s: daemon 839 (0.43 cores before the backlog, 0.73 to 0.80 during it); test processes 701 (per-tier Vitest start-up and import repeated over 96 tiers, Squeal's recorder; not split further) | 155 | 24% |
| Before the first backlog tier: runner part 22.5 s + catch-up quiet 120 s, at 3.6 busy cores | 91 | 14% |
| Backlog phase, 1,000 s at 6.4 busy cores | 359 | 57% |
| Unassigned (busy cores and scope CPU differ by 0.1 core) | 28 | 4% |

**Why the backlog ran at 6.4 cores.** Three causes. Each is measured; how the 57% divides between them is not determined.

- *The width a backlog tier gets.* A backlog permit needs busy cores below `min(hostSlots 11, ceiling 9)` (C10, D18). The daemon's own run-loop tiers and node:test slots count as host load. In B, `lslocks` showed a mean of 3.2 to 8.7 permits held during each backlog tier (5.1 over the run, maximum 12). Twice the ceiling refused a tier outright: "10.2 busy CPUs, ceiling 9" for 1 s, and "9 busy CPUs" for 4 s. *verified by experiment; read in source code, `cores.ts:90`, `pool.ts:527`.*
- *Tier barriers and per-file overhead.* Summed file seconds divided by tier wall time was 0.8 to 4.6 for most tiers (A mean 2.9), against 3.2 to 8.7 permits held. The exceptions are tiers of heavy files (8.4, 7.4). A tier ends with its slowest file. The next tier starts 0.6 to 1 s later in a fresh Vitest run, which repeats transform and import. In the plain run that non-test time (import 790 s, environment 110 s, setup 63 s, transform 58 s) added 1,021 s to 4,869 s of test time (21%); a tier's file durations do not include it. *verified by experiment; the attribution is inferred.*
- *One tier at a time per lane.* The 120 s budget at a small width cut tiers to 11 to 63 files of about 90 to 130 s each. Each tier waits for the previous one (C4, C10 lanes). *read in spec C4 step 5 and source `backlog.ts`, verified by the tier list.*

**The parts the brief named.** Admission (pool waits): 5 s logged in A, 4 s in B. The ceiling's main cost is the narrow grant above, not the waits. Listing: none, because the edit adds and deletes no file. The runner part that re-keys and stores closures took 22.5 s (A), 45.6 s (B's first edit, a freshly started daemon), 9.6 s (one test file) and 23 s (B's third edit). While it runs, no Vitest tier starts. Heartbeat: oldest seen 5.8 s (A) and 5.3 s (B), sampled every 2 s. The 11 to 25 s lapses of #245 (load 11 to 29 on 24 CPUs) did not occur on this quiet VM; their cause is not determined here. Store writes: the daemon logged 125 write-lock holds over about 250 ms, 66 s in all (5.8% of the wall time, maximum 1.0 s), in B 221 for 101 s. They are part of the daemon's CPU, and they block its event loop while held. Re-queue on a new revision: question 2. *verified by experiment, daemon log and samplers.*

## 2. A second edit mid-queue

**Experiment B** (07:49Z on the VM's clock, 06:49Z UTC; VM load 0.1 at the start, mean 7.7, max 14.4 during it). Edit 1 to `ci-wait.ts` at 0 s. At 300.1 s, edit 2: one comment line in `packages/cezar/src/core/ci-tools-definitions-validation.test.ts` (X), the queued file with the longest stored duration, so the last in catch-up order. At the same moment `squeal status --wait 1800000 packages/cezar/src/workflows/immediate-delivery.test.ts` (Y), the next longest. At 600.1 s, edit 3 to `ci-wait.ts` again. *verified by experiment; `results/B.rerun.json`, `B.timeline.json`.*

| Event | Finished work kept | Discarded or re-run | Delay |
|---|---|---|---|
| Edit 2 cancels backlog tier 56fcd369 after 101.9 s | 94 of 132 files | 38 unfinished re-queued; 10 files finished before it ran again after it (25 s; cause not traced) | backlog lane idle 303.8 to 433.1 s, **129 s** (catch-up quiet restarted plus a 9.6 s runner part); the run-loop lane kept running (106 files) |
| X, the edited test file | | | runner part 9.6 s, then an edit's tier of 4; **result 30.8 s after the edit**, before about 780 queued files |
| Y, the named file | | | ran alone in a batch tier beside the lane (331.4 to 357.8 s); **result 57.7 s after the wait started**, wait exit 0 at 59.9 s, after X's tier |
| Edit 3 cancels backlog tier 6841e77d after 79.4 s, and a run-loop tier after 10.7 s | 35 of 53; 0 of 4 | 18 + 4 unfinished re-queued; **824 of the 836 files finished before it ran again, 2,387 of 2,414 file-s**, because their input changed | drain after edit 3: **1,029 s** (runner part 23 s, quiet to 143 s) |

So edited and named files do run first: one edit's tier, then the named batch, both ahead of the catch-up. *verified by experiment; read in spec C4, C15.* A cancel keeps every file that had already ended. What a cancel loses is the time spent on the unfinished files (60 file runs over three tiers of 102, 79 and 11 s), plus each edit's restart of the 120 s quiet. A shared-source edit loses far more: it re-keys every finished file, so in B the queue restarted from 1,259 files at 645 s. In all, B ran 2,049 file runs for 1,215 files (69% extra) and took 1,629 s from the first edit. This matches the #245 report of a backlog that "never emptied before the next commit". *verified by experiment; the link to the report is inferred.*

## 3. Estimating the time to clear at the start

At the edit, Squeal knows the queued files within 1 s (1,297) and their stored durations. It also knows two fixed delays: the runner part (9 to 46 s) and the 120 s quiet. It does not know the width it will reach. `estimate.mjs` computes, from the store only, the estimate `squeal code` makes (`code/gate/estimate.ts:92`) and the C4 backlog tier rule at a chosen width. *Estimates computed by experiment on the stored durations; the formulas are read in source code.*

| Estimator | A: warm-up durations (884 of 1,192 known) | A: its own durations (oracle) | B at edit 3: stored durations (1,193 of 1,205 known) |
|---|---|---|---|
| measured, edit to last result | 1,143 s | 1,143 s | 1,029 s |
| `estimateRun`: max(longest, sum / 11), unknown at the median | 378 (−67%) | 463 (−59%) | 465 (−55%) |
| the same + runner part + 120 s quiet | 521 (−54%) | 606 (−47%) | 608 (−41%) |
| C4 tiers at 9 workers + fixed delays | 661 (−42%) | 804 (−30%) | 796 (−23%) |
| C4 tiers at 6 workers + fixed delays | 919 (−20%) | 1,092 (−4%) | 1,074 (+4%) |
| C4 tiers at 3 workers + fixed delays | 1,623 (+42%) | 1,959 (+71%) | 1,966 (+91%) |

Error sources, measured:

- **Unknown durations.** In A, the 308 run-loop files had never run and were filled at the median (under 1 s). They held 2,230 of the 5,097 file-s A recorded (44%).
- **Drift.** Known files ran 19% faster in A than stored (2,867 against 3,526 s), because the warm-up ran 1,500 files at higher load. At B's edit 3 the stored total was within 4% (5,289 against 5,089 s).
- **Width.** With durations known, only a width of about 6 matches the measured time. The code assumes CPUs − 1 (11) or the ceiling (9). Squeal's realised rate in A's backlog phase was 5.1 file-seconds per second. Applied to B's stored total that gives 143 + 5,115 / 5.1 = 1,146 s (+11%). *inferred.*

## Recommendation for Squeal

Inferred. For the coordinator to design from; nothing here is a design.

1. The largest share of the time (57%) is CPU that Squeal leaves idle while files wait. It comes from narrow backlog grants under the ceiling, tier barriers and Vitest restarts per tier. CPU is not saturated: 6.0 of 12 cores were busy on a quiet machine. Changing tier shape or how the grant counts the daemon's own lanes would act there. Measure on a 24-CPU host with load before a choice, because the ceiling's effect depends on host load. *inferred.*
2. Repeated edits cost more than the backlog itself. Every edit restarts the 120 s quiet, and every shared-source edit re-runs nearly all finished work. Under active editing, the queue clears only when edits stop for longer than one drain (about 17 minutes here). *verified by experiment for the mechanism, inferred for the incidents.*
3. A gate can know the file count, the stored durations and the fixed delays at once. An estimate that uses the width Squeal actually reached (a measured rate) rather than CPUs − 1 was within +4% to +11% in two cases. With the formulas in the code it is 41 to 67% short. Two runs on one repository are not enough to set a factor. *inferred.*
4. Edited and named files already run first (30.8 s and 57.7 s here); question 2 found no ordering defect for them. *verified by experiment.*

## Open questions

- How the backlog phase's 57% divides between grant width, tier barriers and per-tier restarts. Deciding it needs a per-worker trace, or a run with `capacity.backgroundShare` 1.0 and one with a large `backlogTierSize` budget. Not determined, because the budget allowed two experiments.
- The same edit with the run-loop group held (an agent mid-turn, as in the incidents) and on a 24-CPU host at load 11 to 29. The heartbeat lapses of #245 did not reproduce on the quiet VM.
- Whether the daemon's 0.75 cores (store writes, closure and coverage bookkeeping) shrink with fewer, larger tiers. Not determined.

## Sources

- Experiments: `probes/broad-change-throughput/` (scripts, README, `results/`). Store: the clone's `.git/squeal/store.sqlite` (`runs`, `runs/<id>/report.json`), its daemon log, samplers of `/proc`, the scope's `cpu.stat` and `lslocks`.
- Source code at 0.1.563: `src/core/scheduler/{backlog,quiet,edit-cut,refinement,queue,tier-pick,tier-pass,tiers}.ts`, `src/core/capacity/{pool,cores,background}.ts`, `src/core/code/gate/estimate.ts`, `src/core/store/schema.ts`, `src/core/daemon/lifecycle.ts`.
- Spec 011 C4 step 5, C10 (lanes, capacity), C15; spec 021 D18; squawk `squeal.config.json`, `vitest.config.ts`, `.github/scripts/vitest-worker-count.cjs` at `c11e4edf0`.
- Issue [#245](https://github.com/hearsay-tools/squeal/issues/245) and its comments of 2026-11-18 and 19, fetched with `gh issue view 245 --json body,comments`.
