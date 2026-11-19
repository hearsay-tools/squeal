# 011-400: where the idle CPU and the selection time go in a broad change

Researcher of row 011-400, 2026-11-19. Brief: `research/broad-change-throughput-2-brief.md`. First round 08:21Z to 10:30Z, from records and source only (the lab VM was withdrawn). **Measurement round 13:15Z to 15:30Z on the lab VM** after the human gave it back; this file is updated in place, and each part measured then replaces a "not determined". Read: `docs/vision.md`, `broad-change-throughput.md` (row 011-395) and its probes, `stuck-running.md` (row 011-394) and its probes, spec 011 C4 step 5 and C10, spec 021 D18, `021-remote-store-and-execution/research/cpu-ceiling-measured.md` (row 021-19, commit `405d1d4f7` on branch `cez/9c589381`), the Squeal source named below, and Vitest 4.1.10's source.

**Versions.** Squeal **0.1.563**, the release rows 011-394, 011-395 and 021-19 ran, kept for comparability with 011-395 (`git archive v0.1.563 plugins/claude-code`). `src/core/scheduler/` and `src/core/capacity/` are unchanged at 0.1.565. Squawk at `c11e4edf0`, Vitest 4.1.10, Node 26.13.0.

**Machine and load.** The 12-vCPU lab VM the shared notes name (31 GiB, Ubuntu 24.04), work directory `~/work/011-400/`, private `HOME` and runtime directory per step, deleted at the end. No other agent used the VM during the round (`ps` before each run). The runs followed each other, so the one-minute load at each edit still carried the previous run's tail; the busy CPUs in the samplers' idle baseline (15 s before each edit) are the fairer figure. q2: load 1.97, busy 3.4 (a fresh daemon's start); T: load 1.59, busy 1.7 to 2.5; H0: load 2.72, busy 1.6 to 1.9; plain run: load 2.56, busy 0; S2: load 6.56; C2: load 4.31; S3: load 4.59; C3: load 4.03. Each value is in the run's `*.load.txt` and first `*.tsv` rows.

**Not run:** arm TS (large budget and share 1.0) and the plain run at 12 workers, for time. 011-395 has a 12-worker plain run of a near set (1,192 files, 509.5 s).

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | The 57%: grant width, tier barriers, Vitest start per tier; run-loop held | With the run-loop group held (an agent mid-turn), the same edit's 892 files finished in **902 s** (H0), against 1,143 s for 1,200 files unheld (011-395 A). Of H0's 902 s against a plain run's 438 s: **65 s runner part** (fresh daemon), **120 s catch-up quiet** (the backlog starts 120 to 121 s after the runner part ends, by design), and **+278 s in the backlog**: 6.5 files ran at once against 8.9 in the plain run (grant 7.6 wide under the 9-CPU ceiling, 859 worker-s of tier tails, and one tier selected at width 1 that kept it for 98 s, about 85 s lost), and each file took 16% longer (coverage on). **One large tier (arm T) was 28% slower: 1,156 s.** It ran 7.9 files at once at width 9, but each file took a median **1.6 times** as long and the run used **43% more CPU**. Gaps between tiers: 1 s each | verified by experiment (H0, T, plain W9); 120 s cause: read in source code |
| 2 | Why the runner part takes 22–46 s, and "listing" 21 s | Profiled (`--cpu-prof`). A broad edit of 1,297 files: **27.5 s warm, 50.2 s on a fresh daemon.** Warm: re-key 0.2 s, then Vitest's related-file walk (`filterTestsBySource`) **5.5 s**, then the closure loop **16.9 s (13 ms a file)**, then the apply **3.4 s** (store write 1.3 s). The related walk is nearly fixed: **4.9 s** for one test file and for a 406-file module alike. The closure loop grows with files; two thirds of its CPU is path checks in `fileImports` (`isProjectFile` → `path.relative`, 6.1 s). A real listing (`globTestSpecifications`, on adding or deleting a test file) took **under 0.01 s**; those revisions cost 12.9 and 19.9 s through a longer related walk and re-key. A fresh daemon is slower, not faster | verified by experiment (q2 profiles); function roles: read in source code |
| 3 | One Vitest, many workers, no tier barrier | Vitest 4.1.10 fixes a run's width and file list at its start (source). Measured: one plain `vitest run` of H0's 884 Vitest files at 9 workers, no coverage: **438 s**, 8.9 files at once. Inside Squeal, one tier at width 9 over 872 files (T): **968 s**, 7.5 files at once. Squeal's default tiers: **716 s** of backlog. So no barrier inside Squeal's run did not clear faster: it removed tail waits but each file ran slower in the long tier | API: read in source code (4.1.10); times: verified by experiment |
| 4 | A cap on total measured CPU of all daemons instead of slots | Two and three daemons, ~300 files each. **Same throughput** for the slot rule and the CPU cap: 2 daemons 514 s and 520 s; 3 daemons 855 s and 903 s (one run each; the 6% is within what one run can tell). The cap overshot a little more: ≥ 11.5 busy CPUs in 5.8% and 3.9% of samples, up to 14 and 18 live workers; the slot rule never reached 11.5 and had at most 14. Both left **3.4 to 4.9 cores idle** while files waited. The pattern under both: one daemon's first backlog tier takes a wide grant; another daemon's first backlog tier starts at **width 1 and keeps it for 100 to 225 s**; the rest wait for a permit | verified by experiment (S2, C2, S3, C3) |

## 1. The 57%

Row 011-395's run A (1,200 files, 1,143 s, 6.0 of 12 busy CPUs) put 57% of Squeal's extra time into the backlog phase. Three arms on the same edit (`packages/contract/src/ci-wait.ts`, one comment line) on a warmed clone, each with a fresh daemon and one Claude Code consumer in turn (`hold.sh`), so squawk's `run-loop` group (`at: pause`, 308 files) waits. *Verified by experiment* unless tagged otherwise.

| | H0: defaults | T: one tier (budget 3,600 s, ≤ 2,000 files) | Plain `vitest run`, 9 workers, no coverage |
|---|---|---|---|
| Files finished | 892 (884 Vitest, 8 node:test) | 892 | 884 |
| Edit to last end | **902 s** | **1,156 s** | **438 s** |
| Runner part (edit to first tier) | 65 s | 68 s | — |
| Backlog start (quiet ends) | 185.6 s | 188.2 s | — |
| Backlog wall | 716 s, 11 tiers | 968 s, 1 tier | 438 s |
| Width (peak forks) / files at once | 7.6 / 6.5 | 9 / 7.9 | 9 / 8.9 |
| Summed file seconds (Vitest) | 4,393 | 7,272 | 3,779 (Vitest's own sums) |
| CPU-s (scope, daemon included) | 5,828 | 8,329 | 3,675 |
| Pool permits held, backlog phase | 6.8 | 8.1 | — |

- **Holding the run-loop group explains most of 011-395 A's "2.9 files on 5.1 permits".** With it held, H0's backlog tiers ran 6.5 files at once on 6.8 permits. The 892 files finished at 902 s; in A the 889 files outside the group finished at about 1,123 s. So in A the run-loop tiers of 4 took grant and lane time from the backlog. H0 started from a fresh daemon (65 s runner part against A's 22.5 s), so the gain from holding is at least 20%. *Inferred from H0 against A's records.*
- **The 120 s catch-up quiet.** In every run of this round the first backlog tier started 120 to 121 s after the runner part ended: H0 65 → 185.6 s, T 67.6 → 188.2 s, each first daemon of question 4 (21.5 → 141.6 s and others), and A in 011-395 (22.4 → 142.6 s). This is `CATCHUP_QUIET_MS = 120_000` (`src/core/scheduler/quiet.ts:28`, spec 011 C4 step 5 as amended 2026-10-23, row 011-153): an edit's catch-up waits 120 s with no new revision. Only the edit's own tiers run meanwhile (12 files here). *Verified by experiment; cause read in source code.* It is 13% of H0's wall and 26% of the gap to the plain run.
- **Backlog against the plain run (+278 s).** Files at once 6.5 against 8.9 (× 1.38) and summed file time 4,393 against 3,779 s (× 1.16) give × 1.60; the walls give 716 / 438 = × 1.63. The width shortfall has two parts. The grant averaged 7.6, under the D18 ceiling of 9 busy CPUs (share 0.75; no refusal was logged, so the ceiling held the grant size, not tier starts). Tier tails left **859 worker-s** idle, against 121 at tier heads and 48 in the middle (`tiers.mjs`). Each file's extra 16% is likely coverage, which Squeal runs and the plain run did not. *Verified by experiment; the coverage attribution inferred.*
- **A tier selected at width 1 keeps width 1.** H0's second backlog tier (57 files, `server` and `web`) started at 230.2 s, 1.6 s after the first 200-file tier ended, and ran with **one fork for 98 s** while the probe's pool held 2 permits and the host had 3 of 12 CPUs busy. Its files summed 79 s, so at the grant of its neighbours (7 to 10) it would have taken about 12 s: **about 85 s lost, 12% of the backlog wall**. The busy-CPU sample covering the moment of selection still read 7.2, the closing tier's load. A grant is fixed at a tier's start and only shrinks (`tiers.ts:190`, `:307`), so the tier never widened. The same happened to every waiting daemon in question 4 (section 4). *Verified by experiment; that the closing tier's load sized the grant is inferred.*
- **Gaps between tiers**: 0.6 to 1.9 s each, 12 in H0, 13 s in all. *Verified by experiment.* Vitest start per tier is not a material cost, as the first round found from records.
- **One large tier is slower.** T had no barrier in its backlog: 452 worker-s of tail idle in one tier instead of 859 over 11. But the 872 files' durations rose: median ratio T / H0 per file **1.60** (p10 0.96, p90 2.16, 884 files compared), and CPU rose by 2,500 CPU-s (+43%). Busy CPUs stayed at 8.5 and live forks at 7.9 for the whole tier, so the extra time is CPU spent per file, not waiting. The cause is **not determined**: a plain run at width 9 with coverage on would separate coverage from Squeal's runner host (`plainw.sh plainW9c $OUT/H0 9 --coverage.enabled`, about 10 minutes; not run, for time). *Verified by experiment; cause not determined.* The large budget also let the daemon's heap reach 1,286 MiB and its final record write hold the store lock **8.9 s** (71,670 rows) at the tier's end.
- **Grant width (share 1.0).** Not re-measured: arm TS was cut for time. Row 021-19's 5.7% (974.5 s against 1,032.9 s) stands. *Verified by experiment (021-19).*

## 2. Selecting affected tests: the runner part

`q2.sh` started the daemon and its runner hosts under `node --cpu-prof` (2 ms interval), held the run-loop group, and made six revisions, each after the previous one was refined. `prof.mjs`, `incl.mjs` and `phases.mjs` place the profile samples between each edit and the moment the store's refined revision reached it. *Verified by experiment* (profiles of the daemon and the Vitest runner host, `results/q2.*`); the function roles are *read in source code* (0.1.563's bundle).

| Revision (queued after) | Wall | Daemon: re-key | Runner host: related walk | Runner host: closure loop | Daemon: apply (store write) |
|---|---|---|---|---|---|
| b1 broad edit, fresh daemon (1,297) | **50.2 s** | 0.2–0.4 s | 1.4–18.9 s (17.5 s; 4.5 s of it Vite transforms) | 18.9–46.2 s (27.3 s) | 46.2–50.1 s (1.4 s) |
| b2 the same file again, warm (1,297) | **27.5 s** | 0.7–0.9 s | 1.6–7.1 s (5.5 s) | 7.1–24.0 s (16.9 s) | 24.0–27.4 s (1.3 s) |
| t1 one test file (1,280) | **7.3 s** | 0.1–0.2 s | 0.7–5.6 s (4.9 s) | 0.2 s | 5.9–7.2 s |
| m1 module reaching 406 files (1,289) | **13.7 s** | 0.2–0.3 s | 0.9–5.8 s (4.9 s) | 5.8–11.2 s (5.4 s) | 11.2–13.6 s |
| a1 a new test file: a listing (1,284) | **12.9 s** | 0.2–2.3 s | 3.5–11.2 s (7.7 s); listing < 0.01 s at 3.4 s | ~0 | 11.2–12.5 s |
| d1 its delete: a listing (1,273) | **19.9 s** | 0.4–2.7 s | 3.7–17.0 s (13.3 s); listing < 0.01 s | 0.3 s | 17.4–19.9 s |

Times are seconds after the edit. Tiers ran in the background throughout, beside the runner part, as in an agent's session. The runner host was busy 21.1 of b2's 27.5 s and 39.2 of b1's 50.2 s on one thread.

- **The related walk is the fixed part.** `affected` calls Vitest's `filterTestsBySource` (`relatedSpecifications`, `cli-api` lines 11484–11516: `getTestDependencies`, `addImports`, an `existsSync` per import). It walks the imports of every listed test file, so it costs 4.9 to 5.5 s per revision on squawk's 1,931 test files whatever the edit: one test file, 406 files, or 1,297. It grows with the repository's test count, not the edit. Adding or deleting a test file made it 7.7 and 13.3 s.
- **The closure loop is the part that grows with files.** One `closure` call per re-resolved file, one at a time (`refinement.ts:169-177`): 16.9 s for 1,297 files warm, **13 ms a file**; 27.3 s on a fresh daemon, 21 ms a file; 5.4 s for the 406-file module. Inside it, by inclusive CPU in b2: `fileImports` 6.2 s, nearly all of it `isProjectFile` → `toRelative` → `path.relative` (6.1 s) over every edge of every closure; `moduleGlobs` 1.6 s; `resolutionInputs` 1.2 s; `closurePackages` 0.4 s. `fileImports` re-checks the same paths for each test file's closure, so its cost is about files × closure size.
- **Store writes stay small.** Re-key 0.1 to 0.9 s (2.1 to 2.3 s when a path is added or deleted); apply 1.1 to 3.9 s, of which the closure write is 1.3 to 1.4 s for 1,297 files.
- **"Listing about 21 s" is not listing.** A real listing (`globTestSpecifications`) ran on a1 and d1 and took under one 2 ms sample. The 21 s per revision in 011-394 E4b is the related walk plus the closure loop. *Verified by experiment.*
- **A fresh daemon is slower, not faster.** b1 on a fresh daemon took 50.2 s against b2's 27.5 s warm: the related walk transformed modules (4.5 s of `ssrTransformScript`, 2.6 s of `parseAst`) and closures cost 21 against 13 ms a file. H0 and T, also fresh, took 65 and 68 s to their first tier. 011-394 E4c's 5 s after a restart is therefore not a general speed of fresh daemons; its cause stays **not determined** (*inferred*: that revision likely re-resolved few files).

## 3. One Vitest, many workers

What Vitest 4.1.10 allows, *read in source code* (`dist/chunks/cli-api.BK8pd4xc.js`), unchanged from the first round:

- **No barrier inside a run.** `executeTests` queues every file task at once; each finished task frees a worker for the next (`Pool.schedule`, line 3427).
- **Width is fixed for a run.** `groupSpecs` reads `maxWorkers` once and calls `pool.setMaxWorkers` once per group (lines 3696, 3765). Squeal relies on the next run reading a changed config (`src/runners/vitest/width.ts:146-155`).
- **Files cannot be added to a run.** A second `runTestSpecifications` waits behind the running one (lines 13576–13582).
- **Cancel keeps the instance** (`cancelCurrentRun`, line 13731).

**Measured** (*verified by experiment*): the 884 Vitest files of H0, in one plain `vitest run --maxWorkers=9` with no Squeal and no coverage, took **438 s** with 8.9 forks live on average and 8.7 busy CPUs. Squeal's one 872-file tier at width 9 (T) took 968 s, its default tiers 716 s. So a single barrier-free run inside Squeal 0.1.563 does not clear the queue faster: the barrier tails it removes (about 400 worker-s here) are smaller than what each file lost in the long tier (section 1). The plain run's 438 s is the bound at that width; the gap from 716 s is grant width, tails and per-file overhead, as section 1 splits it.

## 4. A cap on measured CPU across daemons

**The rule today** (0.1.563, *read in source code*; details in the first round's text, unchanged): a backlog permit needs `max(Σ marks' cores + own, host busy CPUs) < min(hostSlots, ceiling)`, plus each daemon's fair share of `hostSlots` and a free permit lock. A tier's grant is fixed at its start.

**Measured.** Copies of the warmed clone (one store each), one Claude Code consumer in turn in each, all sharing the probe's private permit pool. One comment line in `packages/contract/src/live.ts` in every copy within a second: 295 test files each. Slot rule: `hostSlots` 11, `backgroundShare` 1.0. CPU cap: `hostSlots` 48 (never binding), `backgroundShare` 0.92, so a permit needs fewer than 11 busy CPUs. "Pending" means any copy had files queued or running beyond its 111 that stay queued (97 browser files at `manual`, the held group's rest). *Verified by experiment* (`q4.sh`, `q4b.mjs`, `q4runs.mjs`).

| Arm | Files | Edit to last end (per copy) | Mean busy CPUs | Idle CPUs while pending | Samples ≥ 11.5 busy | Samples with > 12 runnable | Live workers max |
|---|---|---|---|---|---|---|---|
| S2: 2 daemons, slots | 590 | **514 s** (396, 514) | 7.2 | 4.8 | 0% | 36% | 12 |
| C2: 2 daemons, CPU cap | 590 | **520 s** (520, 352) | 7.0 | 4.9 | 5.8% | 38% | 14 |
| S3: 3 daemons, slots | 885 | **855 s** (855, 799, 686) | 8.5 | 3.5 | 0% | 58% | 14 |
| C3: 3 daemons, CPU cap | 885 | **903 s** (903, 648, 839) | 8.6 | 3.4 | 3.9% | 56% | 18 |

- **Throughput is about the same under both rules**: 69 and 68 files a minute with 2 daemons, 62 and 59 with 3. The cap overshot slightly more: busy CPUs at or above 11.5 in 4% to 6% of samples and up to 18 live workers, against never and at most 14 under the slot rule. Live workers stayed at or below 12 in 98.5% or more of the seconds under every arm. C3's daemons also took longer to their first tier (50 s against 22 to 30 s in S3), which is part of its extra 48 s. *Verified by experiment.*
- **Both under-use the machine the same way.** While files were pending, 3.4 to 4.9 cores stayed idle. The per-copy run lists (`results/*.runs.json`) show why. Under both rules, one daemon whose catch-up quiet ended took a 200-file tier as wide as the pool allowed (9.2 files at once in S2). Another daemon's first backlog tier ran **one file at a time**: S2 66 files in 102 s, C2 73 files in 118 s, S3 89 files in 225 s, C3 67 files in 149 s (0.8 files at once each). Its grant was sized while the wide tier held the pool, and a grant never grows. In S2, C2 and S3 that daemon started 58 to 81 s after the first; in C3 both started at 169.7 s, and the cap gave one of them width 1. A third daemon (S3, C3) started its backlog 108 and 100 s after the first, 26 to 27 s after the first wide tier ended. Each copy then finished with a tail of long files (the last tiers of 1 to 71 files with 37 to 950 file-s). The grant fixed at a tier's start, not the counting rule, sets this; H0's width-1 tier (section 1) is the same effect within one daemon. *Verified by experiment (run lists); cause inferred from the rule read in source.*
- **Runnable tasks above 12** in 36% to 58% of samples: the tests start child processes (squawk's mocks, `git`), which the slot and CPU counts do not see as workers. Mean runnable 10 to 13. *Verified by experiment.*

## Recommendation for Squeal

Inferred. For the coordinator to design from; nothing here is a design.

1. **The largest single cost of a broad edit's wall time, after the tests themselves, is the 120 s catch-up quiet** (13% of H0). It is a decided trade (row 011-153: CPU saved on repeated edits). Whether a broad edit should wait that long is a product question for the human.
2. **Do not raise the backlog tier budget.** One large tier made the same drain 28% slower and used 43% more CPU. Tier tails cost less than that.
3. **The runner part has two halves to work on.** A fixed related walk of about 5 s per revision, from Vitest's `filterTestsBySource`, which grows with the test count. And a per-file closure loop at 13 ms a file warm, two thirds of it repeated `path.relative` checks in `fileImports`, which could be cached per path. A fresh daemon doubles both.
4. **A CPU cap in place of slots changes nothing measurable at 2 and 3 daemons.** The idle cores under both come from grants fixed at a tier's start: a tier that starts at width 1 runs at width 1 for minutes (H0 once, every question 4 run once), while another holds a wide grant. Letting a running tier's grant grow, or not starting a tier at the floor width while a wide one is about to end, is where the idle cores are; the counting rule is not.
5. **Holding the run-loop group (an agent mid-turn) let the backlog run 6.5 files at once instead of 2.9.** Measurements of throughput should state whether an agent is in turn.

## Open questions

- Why each file runs 1.6 times as long in one long Squeal tier: coverage in a long Vitest run, or Squeal's runner host. The plain run with coverage at width 9 splits it (section 1).
- Arm TS (large budget and share 1.0): not run, for time.
- Why a restarted daemon refined a 765-file revision in 5 s in 011-394 E4c.
- Whether Vitest 5 offers a supported pool that takes new files mid-run (not read; the brief named Vitest 4).
- 021-19 measured 1,029 to 1,037 s for the drain that took 1,143 s in 011-395 A. The cause of the 10% is not determined.

## Sources

- This round's results: `probes/broad-change-throughput-2/results/` (q2: `q2.edits.tsv`, `q2.prof.json`, `q2.phases.txt`, `q2.incl.txt`, `q2.tsv`; arms: `T.*`, `H0.*` (`tiers.json`, `timeline.json`, `refusals.json`, `tsv`, `workers.tsv`, `permits.txt`, `load.txt`), `perfile.txt`; plain: `plainW9.*`; question 4: `S2.*`, `C2.*`, `S3.*`, `C3.*` (`q4.json`, `q4b.json`, `runs.json`, `load.txt`); `sha256.txt` of the CLI and its budget-patched copy). The raw `.cpuprofile` files (up to 3 MB each) are not committed.
- First-round records: `probes/broad-change-throughput/results/` (011-395), `probes/stuck-running/results/e4*` (011-394), `021-remote-store-and-execution/research/cpu-ceiling-measured.md` at `405d1d4f7`.
- Squeal 0.1.563 source: `src/core/scheduler/{refinement,runner-work,backlog,quiet,tier-pick,tiers,slow-trigger}.ts`, `src/core/capacity/{pool,cores,background,share}.ts`, `src/runners/vitest/{adapter,related,affected,gate,width}.ts`, and the bundle lines the profiles name (`plugins/claude-code/dist/cli/squeal.mjs` at `v0.1.563`: 24591 `toRelative`, 24594 `isProjectFile`, 24951 `fileImports`, 27550 `relatedSpecifications`, 27573 `affectedTestFiles`, 28967 `moduleGlobs`, 29701 `resolutionInputs`, 30366 `affected`, 30377 `closure`).
- Vitest 4.1.10: `dist/chunks/cli-api.BK8pd4xc.js` lines 3396–3480, 3696, 3765, 11484–11516, 13569–13617, 13731.
- Probes: `probes/broad-change-throughput-2/` (README: steps, the VM-only budget patch, the fixes made at the first run).
