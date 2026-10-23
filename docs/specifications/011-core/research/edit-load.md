# 011-143: what one edit costs the machine, and how much of it is needed

Researcher of row 011-143, 2026-10-23, 10:46Z to 12:35Z. Brief: `research/edit-load-brief.md`. Read: `docs/vision.md`, `docs/styleguide.md`, `docs/process.md`, spec 011 C3, C4, C5, C10, `research/host-load.md` and its probes, `research/central-edits.md`, `research/edit-cut.md`.

Versions: Squeal 0.1.274, the committed `plugins/claude-code/dist` of squeal `800cb629d`. Clones under `/tmp/el143`: squeal `800cb629d`, cezar `f99cd1e24`, toolkit-dev `7f939fb9`. Vitest 5.0.3 (squeal), 4.1.10 (cezar), 4.1.11 (toolkit). Store copies taken 2026-10-23 10:47Z (cezar again at 11:35Z). Host: 24 CPUs, one-minute load 25 to 99 during the probes; every timing below names its load. Probes and how to re-run each: `probes/edit-load/README.md`.

**Units.** *CPU-seconds* are user plus system time of every process in a probe's cgroup scope, exited children included (`cpu.stat`), measured. *Recorded seconds* are the per-file durations the host stores hold (`results`, `report.json` `fileDurations`), recorded on this loaded host. One recorded second cost 0.32 to 0.59 CPU-seconds in four calibrations (finding 0). Shares are of recorded seconds.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | One edit | A test-file edit costs 2 to 11 CPU-s and gives its result in under 25 s in all three repositories. A source edit costs far more: in squeal every `src/**/*.ts` file is in at least 94 closures, so an edit of `src/core/ps/model.ts`, a module of types only, re-keyed 94 files (2,694 recorded s, about 860 to 1,600 CPU-s); live, a fresh daemon ran 45 of them for 226 CPU-s, where `vitest related` finds 0. A mid edit re-keys 346 files (3,400 to 6,400 CPU-s), a hub 826 (about the whole suite, 5,514 CPU-s measured with coverage). In cezar every source file, and every test file under `packages/cezar/src`, re-keys the 82 browser e2e files (5,211 recorded s) through declared inputs; the fast part of a leaf edit cost 329 CPU-s against 296 for `vitest related` | verified by experiment (test and leaf cells, baselines), inferred (mid and hub, from recorded seconds) |
| 2 | One hour of work | 0.4 to 1.4 cores on average per hour a worktree is active (72 h: squeal 4,630 recorded s per hour, cezar 4,016, toolkit 1,464; last 12 h: squeal 8,606, cezar 5,625), and bursts reach 5 to 9 cores for cezar's 19 worktrees today. Squeal: checkpoints 76%, transitive catch-up 14%, edit work 5%. Cezar: edit work 32%, catch-up 25%, backlog of unknown cause 15%, checkpoints 14%, slow lane 8%. 39% of all work stored no result. C5 re-runs are under 0.1% | read from store copies, CPU inferred |
| 3 | The part no change reached | Of the re-run test time of 55 source-edit revisions that coverage could judge, 65% ran no changed line (leaf 85%, mid 60%, hub 63%). 31% is in files that do not import the module at all. Coverage would have missed a real new failure in 6 of the 55 revisions (11%): bundle and package tests that read sources, a key-format guard, and tests that spawn the CLI | verified by experiment (coverage), read from store (true results) |
| 4 | A user's machine | 20 edits in 10 minutes on 8 pinned CPUs, at default capacity, beside other host work (pinned CPUs 92 to 94% busy, host load1 about 55): squeal used 865 CPU-s (0.96 cores, 12% of the 8) and was idle 300 s after the last edit; cezar used 4,388 CPU-s in 40 minutes (1.8 cores, 23%) and still had 415 files pending at the cap. The first result of an edit came in 4.8 s (squeal) and 8.8 s (cezar) at p50, 36.5 s and 34.2 s at p90. Ran at Squeal's own worker count, a deviation from the 4-worker rule | verified by experiment |
| 5 | Knobs | `tierSize` and K change when a result arrives, not how much runs; `hostSlots` changes how wide the backlog runs; the quiet only stops backlog starts; nice changes priority, not CPU-seconds or load | read in source code, verified by experiment where stated |
| 6 | Ranking | finding 6 | inferred from 2 and 3 |

## 0. Calibration: CPU per recorded second

| Measurement | CPU-s | Recorded s of the same files | Ratio | Load |
|---|---|---|---|---|
| `vitest related src/runners/node-test/graph/modules.ts`, 232 files, 4 workers, CPUs 16-19 | 2,340 | 7,319 | 0.32 | 43 to 82 |
| squeal whole suite with per-file V8 coverage, 951 files, 4 workers, unpinned | 5,514 | 15,165 | 0.36 (coverage included) | 27 to 70 |
| squeal leaf edit through the daemon, 56 file runs, CPUs 16-19 | 200 (tests) | 472 | 0.42 | 38 to 64 |
| cezar leaf edit through the daemon, 42 files, CPUs 20-23 | 288 (tests) | 489 | 0.59 | 81 to 57 |

Cross-check on the live host (`nicesample.py`, 20 s, 11:33Z): processes with the `SQUEAL_OBSERVE` variable name in cezar worktrees used 5.4 cores (a floor: exited children of the unniced daemon are missed). Cezar's runs of the 15 minutes before the store copy hold 7,644 recorded s, 8.5 recorded cores, which at 0.6 is 5.1 cores. *verified by experiment.*

The stores keep only part of older days: cezar's `runs` hold 1,484 files picked on 21 October where `host-load.md` counted 23,456. So `sar`'s niced CPU for 20 to 22 October (mean `%nice` 17.9 to 22.4, about 5 cores of user time) is several times what the stores' 72 hours imply. Shares and per-hour rates below use the same pruned rows on both sides. *read from store, inferred.*

## 1. One edit

Each live cell: a clone with its own daemon (baseline `lookup-only`, so nothing ran before the edit), pinned to 4 CPUs, defaults otherwise; one comment line appended; `edit.sh` samples until three idle samples. The model columns use the host store's warm closures (which hold paths runs read) and last recorded durations (`cells.py`). Cezar's clone excluded the `e2e` project (no browsers in the isolated home); its cost is the store's.

| Repository, class, path | Live: files run, wall to idle, CPU-s (daemon) | Warm closures: re-keyed, recorded s | Own test file alone | `vitest related` | Load |
|---|---|---|---|---|---|
| squeal, test, `test/capacity/pool.test.ts` | 1, 9 s (result by 4.5 s), 1.9 (1.0) | 2, 3 | 3.0 CPU-s, 5.5 s | = own file | 34 |
| squeal, leaf, `src/core/ps/model.ts` | 46 (56 runs), 196 s (first result 157 s), 226 (25) | 94, 2,694 (53 import it, all `import type`) | none | 0 files, 15 CPU-s to select (rechecked with an absolute path) | 38 to 64 |
| squeal, mid, `src/runners/node-test/graph/modules.ts` | not run | 346, 10,613 (static 237, 7,319) | | 232 files, 2,340 CPU-s, 1,148 s | 43 to 82 |
| squeal, hub, `src/core/fs/paths.ts` | not run | 826, 14,669 (static 818) | | about the whole suite | |
| squeal, whole suite | 951 files, 2,126 s, 5,514 CPU-s with coverage | 966, 15,165 | | | 27 to 70 |
| cezar, test, `packages/cezar/src/server/group-pick.test.ts` | 1, 21 s, 11.3 (4.4) | 89, 5,235; 82 of them e2e (5,211) | 7.4 CPU-s, 14 s | = own file | 77 |
| cezar, leaf, `packages/web/src/lib/use-no-hover.ts` | 42, 586 s, 329 (41) | 125, 5,703; e2e 82 (5,211) | | 40 files, 296 CPU-s, 190 s | 57 to 81 |
| cezar, mid, `packages/cezar/src/core/managed-session.ts` | not run | 327, 28,983; e2e 5,211 (static 235, 23,613) | | | |
| cezar, hub, `packages/contract/src/effort.ts` | not run | 614, 31,011; e2e 5,211 (static 382, 24,529) | | | |
| toolkit, test, `scripts/metrics/tests/test_m16_e2e_health.py` | 1, 10 s, 2.7 (1.9) | 1, 1 | = Squeal's run | | 63 |
| toolkit, leaf, `scripts/metrics/ui/src/lib/metricOutcome.ts` | 1, 10 s, 2.4 (1.1) | 1, 2 | | | 60 |
| toolkit, mid, `plugin-tools/project-graph/project_graph/views.py` | 14, 214 s, 167 (33) | 15, 887 | | | 51 to 64 |
| toolkit, hub, `.../e2e-setup/scripts/manifest.mjs` | 37, 44 s, 35 (6) | 37, 384 | | | 45 to 51 |
| toolkit, whole suite (`run --all --force`) | 214 files, 558 s, 826 CPU-s (13 tests failed in the clone) | store: about 2,200 recorded s over its projects | | | 43 to 33 |

Findings:

- **Declared inputs and read paths set the floor for squeal.** The least-reached `src/**/*.ts` file is in 94 stored closures, the median in 346, `src/core/fs/paths.ts` in 826 (`fanin.cjs`). `squeal.config.json` gives `test/harness/plugin.test.ts`, every `test/harness/codex/**`, `opencode/**` and `pi/**` test and `test/integration/node-test.test.ts` all of `src/**/*.ts` as inputs. `src/core/ps/model.ts` holds types only (29 exported types, no value): all 17 imports of it are `import type`, which the transform drops, so no test executes it and `vitest related` selects none. Its edit still ran a catch-up tier of 45 declared-input files: 15 codex, 17 OpenCode and 11 Pi harness tests, `plugin.test.ts` and the node:test integration test. *verified by experiment, read in `squeal.config.json`.* The warm closures add `test/daemon` files (2,034 of the 2,694 recorded s), which reach the module through paths their runs read, not through imports. *read from store; the mechanism inferred.*
- **A fresh daemon under-counts.** The live types-only edit ran 46 files, the warm closures hold 94: a daemon learns the paths a run reads only from that run. 11 of the 45 files re-ran at once because their first run observed paths first hashed after it began (C4, `observed` discard). *verified by experiment.*
- **Cezar's browser tests ride on every edit.** `squeal.config.json` gives `packages/web/e2e/*.e2e.ts` all of `packages/cezar/src/**`, which holds test files too, so even a test-file edit re-keys the 82 e2e files: 5,211 recorded s on the slow lane. Without them, Squeal's fast lane did what `vitest related` does (329 against 296 CPU-s). *read in config, verified by experiment.*
- **The daemon's own CPU** is 1 to 4 s per small edit and 10 to 20% of a large one (25 of 226, 41 of 329, 33 of 167 CPU-s). *verified by experiment.*
- **Without Squeal** an agent that runs the edited test file spends 3 to 7 CPU-s. One that runs `vitest related` runs no file for the types-only module (12 to 15 CPU-s to select) and spends 2,340 CPU-s on the mid module. One that runs the whole suite spends about 5,000 CPU-s in squeal and, by the same ratio, about 9,000 to 17,000 in cezar (28,200 recorded fast seconds plus 5,336 e2e). *verified by experiment for squeal, inferred for cezar.*
- **A share that is coming in squeal: build tests on every `src/` edit.** Row 011-141 (wave 23, not on main at `800cb629d`, so not in any number here) makes about 58 build tests (`tsc` or esbuild of the CLI and bundles) re-key on every `src/` edit, in the fast lane. Its worker measured on this host: one `src/core/scheduler/scheduler.ts` edit re-keyed 364 files (306 fast, 58 build); the 58 alone took 1,358 CPU-s summed, 557 s wall at 4 workers, load median 58; `test/daemon/hold.test.ts` alone 279 s. That is about a quarter of the whole suite's 5,514 CPU-s, added to every source edit. *reported by the coordinator on 2026-10-23 from row 011-141's measurement; not verified here.*

## 2. One hour of work

`work.mjs` over the last 72 hours of each store copy. Each file a run held is given its recorded seconds; a file that never ended counts its run's wall time, at most 4 per run (an upper bound for timeouts). Classes: `checkpoint` (the run belongs to `run --all`), `slow` (cezar's `packages/web/e2e`), `rerun` (the worktree's previous run of the file failed it less than 30 min before, no revision between touched its closure), `edit-route` (a run of at most `tierSize` files: edit work and the first group), then a larger run is catch-up of an edit (the newest revision before it that touched the file's closure changed under 10 paths), catch-up of a pull (10 or more paths, or another trigger), `baseline` (the daemon's start), or of unknown cause (the store holds no revision of that worktree). *read from store copies.*

| Recorded seconds, 72 h | squeal | cezar | toolkit |
|---|---|---|---|
| total; active worktree-hours | 260,200; 56.2 | 246,586; 61.4 | 9,812; 6.7 |
| per active worktree-hour | 4,630 (1,480 to 2,780 CPU-s, 0.4 to 0.8 cores) | 4,016 (1,290 to 2,410 CPU-s) | 1,464 (470 to 880 CPU-s) |
| checkpoints (`run --all`) | **76.2%**, 42% not stored | 13.9%, 21% not stored | 66.1% |
| edit route (tiers of at most 4) | 5.1% | **31.5%** | 14.6% |
| catch-up of edits | 7.2% | **22.7%**, 59% not stored | 0.8% |
| catch-up of pulls | 7.2% | 2.4% | 0.0% |
| backlog of unknown cause | 4.2%, 84% not stored | 15.4%, 69% not stored | 16.6% |
| slow lane | none configured | 8.0% | 0 (empty `slow.include`) |
| C5 re-runs | 105 s, 0.04% | 144 s, 0.06% | 0 |
| **stored no result** | **39.3%** | **38.6%** | 27.8% |
| of which: timed out (upper bound) | 13.0% | 18.4% | 0 |
| cancelled by an edit during a backlog tier | 9.4% | 5.0% | 0.9% |
| ended, then discarded or replaced at the same key | 11.3% | 7.9% | 18.6% |
| yielded to an edit or a promoted file | 0.5% | 4.3% | 0 |
| inputs changed during the run | 2.3% | 2.7% | 4.1% |
| stop, step-down, crash | 2.4% | 0 | 4.0% |

What each class found, as test files whose checks turned (transitions recorded within 15 s of the run's end): squeal checkpoints 50 to FAIL and 24 to PASS, edit route 46 and 55, catch-up of edits 29 and 6, of pulls 4 and 2, re-runs 2 to FAIL. Cezar edit route 97 and 100, slow lane 32 and 22, catch-up of edits 15 and 0, checkpoints 3 and 6, pulls 6 and 0. *read from store copies.*

The last 12 hours, the most complete rows (squeal 22:47Z to 10:47Z, cezar 23:34Z to 11:34Z): squeal 129,945 recorded s over 15.1 active worktree-hours, 8,606 per hour (2,750 to 5,160 CPU-s, 0.8 to 1.4 cores), checkpoints 74.3%, catch-up of edits 12.4%, edit route 7.0%, unknown 6.1%, stored nothing 41.4%. Cezar 201,950 over 35.9 hours, 5,625 per hour (1,800 to 3,375 CPU-s, 0.5 to 0.9 cores), edit route 45.2%, catch-up of edits 38.0%, other backlog 6.9%, slow lane 5.4%, no checkpoint, stored nothing 36.6%. *read from store copies.*

Other findings:

- **Active hours are bursty.** Cezar held 51,385 recorded s in the hour before 11:35Z over 19 worktrees: 14.3 recorded cores, 5 to 9 CPU cores. The 72-hour mean hides that. *read from store, inferred CPU.*
- **The same key in two worktrees** is not determined: the stores keep one result row per check and key, so an earlier run at a key a later run replaced leaves no key behind. Runs at clean revisions on the same commit in two worktrees showed 0 recorded s of repeats; the 7.9 to 11.3% "ended, discarded or replaced" is the upper bound. *read from store.*
- **Squeal's checkpoints are the process rule.** `CLAUDE.md` asks every worker for `squeal run --all --wait`; 42% of that work stored nothing. *read in `CLAUDE.md`, read from store.*

## 3. The part no change reached

Method. `cov-setup.ts` starts V8 precise block coverage in each Vitest worker before a test file loads and writes it, with every transformed script's source, in `afterAll`; `cov-lines.mjs` maps executed ranges back to source lines through the inline source maps. The whole squeal suite ran once this way at `800cb629d` (949 of 951 files recorded). `cand.cjs` takes real agent edits from the squeal store: watch revisions of 1 to 3 paths whose old and new blobs are both in git, 138 path edits in 102 revisions. `reach.py` takes the changed code lines (comments and blank lines left out; an insertion counts its neighbours), maps them to the coverage commit by diff, and judges each re-keyed file (warm closures, e2e excluded): reached (executed a changed line), not reached (the module did not load, or loaded and no changed line ran, or only types changed), or not evaluable (no coverage record, or the changed lines are not at the coverage commit). A revision's file is reached when any of its paths reached it. The true result is the store's transitions in that worktree from the revision until the next revision that touched the file's closure. *verified by experiment; true results read from store.*

| Revisions (real) | Re-run recorded s | Reached | Not reached | Not evaluable | Not reached / evaluable |
|---|---|---|---|---|---|
| test-file edits, 47 | 1,391 | own file 78% | 21% (`version-sensitive.test.ts` and the like) | 0.4% | 98% of the rest |
| source leaf (<200 re-keyed), 17 | 72,435 | 9.6% | 54.7% | 35.7% | **85%** |
| source mid (200 to 600), 22 | 167,956 | 24.7% | 36.8% | 38.5% | **60%** |
| source hub (>600), 16 | 205,725 | 32.3% | 54.6% | 13.1% | **63%** |
| all 55 source revisions | 446,116 | 114,880 | 213,683 | 117,494 | **65%** |

**By export** (`exports.py`, 63 source path edits; an export changed when a changed code line is in its top-level declaration, any other changed line counting as every export changed, which is 40 of 63): 64.5% of the re-run recorded seconds are in files whose static import closure imports a changed export, 4.4% import the module but no changed export, 31.1% do not import the module at all. Of the 23 edits inside exported declarations only: 63.6%, 11.3%, 25.2%. *verified by experiment (regex parse of imports, barrels followed).*

**What coverage misses, and the false passes it would have made.** In 6 of the 55 source revisions (11%) a file coverage called not reached turned to FAIL: 14 file results.

| Mechanism | Files | Revisions | Example |
|---|---|---|---|
| reads or bundles the sources instead of executing them | 10 | 5 | `test/harness/codex/plugin.test.ts`, `test/harness/plugin.test.ts`, `opencode/package.test.ts`, `pi/package.test.ts` after edits to `src/core/scheduler/keying.ts`, `src/core/status/*.ts`, `src/cli/start.ts` |
| hashes key-relevant sources | 1 | 1 | `test/keys/key-format.test.ts` after `keying.ts` (the release guard, by design) |
| spawns the CLI or a daemon | 2 | 2 | `test/daemon/busy-edit.test.ts` (rev 19), `test/cli/codex.test.ts` (rev 329) |
| other, likely load | 1 | 1 | `test/scheduler/observed-growth.test.ts` |

Coverage also cannot see: declared inputs that are data (fixtures, `squeal.config.json`), files a test reads, environment and config changes, type-only changes (which no test executes; 13.8% of hub re-run time sat on type-only edits), and code paths that differ at the coverage commit. *verified by experiment, inferred for the mechanism of each file.*

## 4. A user's machine

**Deviation from the brief's 4-worker rule**, by the coordinator's reply of 2026-10-23: each burst ran in one clone, its daemon restarted under `taskset -c 0-7`, nice 10, with Squeal's defaults (`hostSlots` 7, its own worker count) and a private runtime directory, so it never met the live permit pool. The two bursts ran one after the other, not at the same time. Each burst is 20 edits, one every 30 s (a comment line appended to a test or source file the burst list names), then a drain until the daemon is idle or 2,400 s pass. Both stores were warm from question 1 (squeal 3,251 results for 931 files, cezar 5,922 for 865), and both daemons started lookup-only. Cezar's clone excludes the `e2e` project (no browsers in the clone), so its slow lane is not in these numbers.

The 8 pinned CPUs were not free: other work on this host kept them 86 to 96% busy, so Squeal competed for them. Read every share below as Squeal's part of a busy machine, not what an idle 8-CPU laptop would see.

| Burst | Window | Squeal CPU-s | Mean cores (share of 8) | Host load1, mean (max) | Pinned CPUs busy, mean | Runnable on pinned CPUs, mean |
|---|---|---|---|---|---|---|
| squeal | 20 edits, 0 to 604 s | 490 | 0.81 (10%) | 56 (76) | 96% | 13.4 |
| squeal | drain, 604 to 905 s, idle at 905 s | 375 | 1.25 (16%) | 51 (63) | 86% | 11.1 |
| squeal | whole, 905 s | 865 | 0.96 (12%) | 54 (76) | 92% | 12.7 |
| cezar | 20 edits, 0 to 603 s | 799 | 1.33 (17%) | 53 (74) | 95% | 14.7 |
| cezar | drain, 603 to 2,405 s, **not idle** at the cap | 3,590 | 1.99 (25%) | 57 (107) | 94% | 14.9 |
| cezar | whole, 2,405 s | 4,388 | 1.82 (23%) | 56 (107) | 94% | 14.8 |

Peak Squeal use over any 30 s: squeal 2.8 cores (at 719 s, in the drain), cezar 4.7 cores (at 2,353 s, a 200-file catch-up tier). *verified by experiment.*

Time from an edit to the end of the first run that held the edited file or a file whose closure holds it:

| Burst | n | p50 | p90 | max | The slow ones |
|---|---|---|---|---|---|
| squeal | 20 of 20 | 4.8 s | 36.5 s | 39.2 s | the two edits of `src/core/ps/model.ts` (39.2 s, 36.5 s): its 46 importers wait behind a running catch-up tier |
| cezar | 20 of 20 | 8.8 s | 34.2 s | 41.8 s | `test/benchmark-run-store-fixture.ts` (41.8 s), `packages/cezar/src/workflows/run.ts` (34.2 s) |

*verified by experiment.* The first result came fast in both. The cost is what follows it.

**Squeal: catch-up starts and is cancelled, again and again.** 49 runs picked 1,628 file runs; 238 stored a result. Edit tiers of at most 4 files ended in 1 to 8 s. About 18 s after each edit (the 20 s quiet), a catch-up tier of 40 to 104 files started; the next edit cancelled it 4 to 16 s later. After the last edit the backlog drained in three tiers (81 s, 147 s, 68 s), and the daemon was idle at 905 s, 300 s after the last edit. *verified by experiment (runs read from the probe store copy).*

**Cezar: edit work alone fills the burst, and the drain outlasts it by more than half an hour.** 72 runs picked 394 file runs; 71 runs ended, with 194 files. During the burst every run held at most 4 files: each edit's tier, 14 to 58 s each under this load, one after another. The first catch-up tier (39 files) started at 1,582 s, 980 s after the last edit. Two later tiers of 4 took 535 s (`pi-runner`, `monitoring-turn`, two `harness-autosave` tests) and 268 s (`run`, `ci-wait`, `human-waits` tests) in the fast lane. At the 2,400 s cap: 70 files current, 415 pending (200 running in one tier, 215 queued). *verified by experiment.*

So on a user's 8-CPU machine with a loaded neighbour, one agent's 10 minutes of edits cost Squeal 865 CPU-s in squeal (about a sixth of the whole suite, 5,514 CPU-s with coverage) and more than 4,388 CPU-s in cezar, where the machine stayed loaded for 40 minutes or more after the agent stopped. *verified by experiment; the cezar total is a floor, because the drain was capped.*

## 5. What each knob does today

| Knob | What it changes | CPU per edit | Time to result | Tag |
|---|---|---|---|---|
| `runner.tierSize` (4) | the edit tier's size and the edit cut's K (namesakes plus the K shortest direct importers stay edit work, C4); node:test and pytest backlog slots | none on which files run; each extra tier adds its fixed cost, 1.9 CPU-s for a 1-file tier including 1.0 of daemon | `research/central-edits.md`: next edit's wait p50 6 s under the cut, p90 132 s with every direct importer | read in source (`src/core/scheduler/edit-cut.ts:86`), verified (tier cost) |
| `capacity.hostSlots` (CPUs − 1) | permits for backlog and checkpoint tiers across daemons; an edit's tier and each daemon's first backlog worker take none | none on which files run; peak width only | not measured in isolation. Question 1 ran at 4 CPUs (`hostSlots` 3), question 4 at 8 (`hostSlots` 7) with different stores and loads, so the two do not compare. At 8, Squeal's peak over 30 s was 2.8 cores (squeal) and 4.7 (cezar) on CPUs other work kept 92 to 94% busy: a wider pool lets a drain finish sooner, it does not shorten an edit's own tier | read in source (`src/core/capacity/pool.ts:94`, `src/core/daemon/user-config.ts:29`), inferred (time to result) |
| quiet, `BACKLOG_QUIET_MS` 20 s, not configurable | no backlog or catch-up tier starts until 20 s pass without a re-keying revision | fewer cancelled tiers; cancels still cost 9.4% (squeal) and 5.0% (cezar) of work in this window. In the squeal burst (edits 30 s apart) each catch-up tier of 40 to 104 files started about 18 s after an edit and the next edit cancelled it 4 to 16 s later | catch-up waits at least 20 s after the last edit | read in source (`src/core/scheduler/quiet.ts:21`), read from store, verified by experiment (burst) |
| slow lane (`slow.include`) | which files wait for an idle lane and the load guard | cezar: 8.0% of work; 82 browser files per `packages/cezar/src` edit | | read in config, read from store |
| nice 10 | scheduling priority of test processes | none: the CPU-seconds are the same | none when the machine is idle; on a busy machine the agent's own processes go first | read in official docs (`nice(2)`: "A higher nice value means a lower priority") |

Nice does not lower the load average: Linux counts "jobs in the run queue (state R)" whatever their nice value (`proc_loadavg(5)`, man-pages 6.7). So a niced burst still reads as load. *read in official docs.*

## 6. Ranking

Pooled over the three stores' 72 hours: 516,598 recorded s (squeal 260,200, cezar 246,586, toolkit 9,812), about 165,000 to 310,000 CPU-s. Ranked by recorded seconds; a share can sit in two rows (a cancelled checkpoint tier is both). Every share above 5% of the pool or of one repository is listed.

| Share | Recorded s, 72 h (pool %) | squeal / cezar | What it buys | What removing it would cost, with evidence |
|---|---|---|---|---|
| Checkpoints (`run --all`) | 239,051 (46.3%) | 76.2% / 13.9% | the full-suite verdict a worker reports at its end | squeal checkpoints turned 50 files to FAIL and 24 to PASS in 72 h; 42% of squeal's checkpoint work stored nothing. Most of it is the repository's own rule (`CLAUDE.md`: every worker runs `squeal run --all --wait`) |
| Work that stored nothing | 200,168 (38.7%) | 39.3% / 38.6% | nothing kept | none for the result itself. Its parts: timed-out tiers 79,365 (15.4%, an upper bound), ended then discarded or replaced at the same key 50,712 (9.8%), cancelled by an edit during a backlog tier 36,876 (7.1%), yields 10,656 (cezar 4.3%). A cancel can buy an earlier edit verdict (C4 step 5) |
| Edit route (tiers of at most 4) | 92,441 (17.9%) | 5.1% / 31.5% | the edit's own verdict, first | most transitions come from here: cezar 97 to FAIL and 100 to PASS, squeal 46 and 55. This is the product's core loop |
| Catch-up of edits | 74,829 (14.5%) | 7.2% / 22.7% | transitive verdicts of an edit | squeal 29 files to FAIL, cezar 15. In squeal 60 to 85% of a source edit's evaluable re-run time ran no changed line (finding 3); cezar's 59% stored nothing |
| Backlog of unknown cause | 48,915 (9.5%) | 4.2% / 15.4% | not attributable: the store kept no revision of those worktrees | 69 to 84% stored nothing; no transition attributed |
| Files that do not import the edited module (squeal source edits) | 31.1% of their re-run time | squeal | bundle, package and plugin verdicts through declared inputs, and read paths | 10 of the 14 failures coverage would have missed are in exactly these files (finding 3) |
| Type-only changes re-keying files | 13.8% of hub re-run time | squeal | nothing a test can execute | a type error shows in `tsc`, which Squeal does not run; no test turned FAIL on these edits |
| Catch-up of pulls | 24,854 (4.8%) | 7.2% / 2.4% | verdicts after a merge, checkout or rebase | squeal 4 to FAIL, cezar 6 |
| Slow lane (cezar e2e) | 19,777 (3.8%) | none / 8.0% | browser verdicts | 32 to FAIL and 22 to PASS; every `packages/cezar/src` edit re-keys all 82 files, 5,211 recorded s |
| Backlog, other causes | 16,294 (3.2%) | 0 / 5.9% | baseline and environment re-keys | cezar 3 to FAIL |
| Coming, not yet on main: build tests on every squeal `src/` edit (row 011-141) | not in these stores | squeal | build and bundle verdicts after each source edit | 1,358 CPU-s per `src/` edit for 58 files, about a quarter of a whole-suite run (row 011-141's measurement, reported by the coordinator, not verified here) |
| C5 re-runs | 249 (0.05%) | 0.04% / 0.06% | one confirmation of a new failure | 2 confirmed FAIL in squeal, 4 recovered in cezar |

*inferred from findings 2 and 3; every count is read from the store copies or measured as stated there.*

## Recommendation for Squeal

None: the brief asks for numbers, not design. The shares that are large and buy little are named in finding 6.

## Open questions

1. CPU for e2e browser files per recorded second: not determined, because the isolated clone had no browsers. The cezar figures use the fast-lane ratio.
2. The same key run in two worktrees: not determined exactly (one result row per check and key). Upper bound 7.9 to 11.3%.
3. The `sar` gap: the niced CPU of 20 to 22 October is several times what the stores' rows imply; the stores pruned older runs, so the 72-hour totals are a floor.
4. Squeal mid and hub edits and all cezar mid and hub edits were not run live (an hour or more each at 4 workers on this host); their CPU is recorded seconds times 0.32 to 0.6.
5. Toolkit's live cells ran in a clone missing three nested `node_modules` and six tool environments on the first pass; the table shows the second pass after they were copied.
6. Question 4 on a free 8-CPU machine: not determined, because no CPUs of this host were free; other work kept the pinned CPUs 86 to 96% busy. The cezar burst's drain did not end in 2,400 s, so its total and its time to idle are floors.
7. Row 011-141's build tests (finding 1): not measured here, because they are not on main at `800cb629d`.

## Sources

- Store copies: `~/projects/{squeal,cezar,toolkit-dev}/.git/squeal/store.sqlite` with `-wal` and `-shm`, copied 2026-10-23 10:47Z; cezar again 11:35Z. Run logs `report.json` read in place.
- Source at `800cb629d`: `src/core/scheduler/edit-cut.ts`, `src/core/scheduler/quiet.ts`, `src/core/capacity/pool.ts`, `src/core/daemon/user-config.ts`; spec 011 C4, C5, C10.
- `squeal.config.json` of squeal (`800cb629d`), cezar (`f99cd1e24`), toolkit-dev (untracked, copied 10:58Z).
- `sar` files `/var/log/sysstat/sa20` to `sa22` through `probes/host-load/sar-day.sh`.
- man-pages 6.7: `proc_loadavg(5)`, `nice(2)`.
- Question 4: the probe daemons' stores (copied after each burst) and the `burst.sh` logs of 2026-10-23, squeal 11:29Z to 11:44Z, cezar 11:46Z to 12:26Z, summarized by `burst-sum.cjs`; the clones and logs are removed (the brief's cleanup rule), the numbers are in finding 4.
- Row 011-141's build-test numbers: the coordinator's message of 2026-10-23.
- Probes: `probes/edit-load/` (README lists each script and the commands).
