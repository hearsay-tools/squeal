# 019-46: where Squeal's test CPU goes now, by trigger

Researcher of row 019-46, 2026-11-05, 16:40Z to 17:10Z (Europe/Warsaw 17:40 to 18:10). Brief: `research/load-split-brief.md`. Read: `docs/vision.md`, `011-core/research/edit-load.md` (method, classes) and its `work.mjs`, `011-core/research/edit-cut.md`, `011-core/research/host-load.md`, spec 011 C4, spec 019 D1 to D3, `src/core/scheduler/edit-cut.ts`, `quiet.ts`, `claims.ts`, `tiers.ts`, `slow-trigger.ts`, `store/prune.ts`, `fs/git-layout.ts` at squeal `48da797c8`.

Window: 72 h, 2026-11-02T16:50Z to 2026-11-05T16:50Z. Store copies taken 16:50Z: squeal, cezar, toolkit-dev, and two small ones (`mvp-unveiled-july26` has no run, `saas-bp-management-dashboard` none since 2026-10-29: both left out). Host: 24 CPUs, load1 20 to 38 while the probes ran. No test was run. Probes and re-run steps: `probes/load-split/README.md`.

**Units**, as `edit-load.md`: *recorded seconds* are the per-file durations the stores hold; a file that never ended counts its run's wall time (at most 4 per run, an upper bound). CPU is inferred with `edit-load.md` finding 0: one recorded second cost 0.32 to 0.59 CPU-s. Not re-measured here (the brief allows no test run). Shares are of recorded seconds.

**What the store can and cannot tell now.** A removed worktree loses its revisions and its transitions; its runs and results stay 7 days (`store/prune.ts`, `worktrees.remove`; checked in the copies with `twt.cjs`: squeal keeps transitions of 2 of 62 worktrees with runs, cezar of 13 of 265). Exact trigger classes exist only for worktrees whose revisions survive: squeal 2 worktrees (88,022 s, 40% of its seconds), cezar 22 (173,829 s, 15%), toolkit 3 (2,924 s, 79%). Two ways to fill the gap failed validation, so I do not use them: transcript edits match only 3% (squeal) and 13% (cezar) of the stored edit revisions, because agents also edit through shell commands (`edit-cover.cjs`); a timing proxy put 22% (squeal) and 49% (cezar) of the exact catch-up seconds in its edit window (`split.mjs` `confusion`). Transcripts do give every worktree's Stop times: the worktree id is the first 16 hex of sha256 of the root path (`src/core/fs/git-layout.ts:56`), and all 332 worktrees with runs have a transcript. *read in source code, verified by experiment.*

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | The split now | Pooled 1,378,000 recorded s in 72 h (441,000 to 813,000 CPU-s, 1.7 to 3.1 cores on average); cezar 84%, 4.7 times its October total. Same method as October: checkpoints 43.4% (was 46.3%), unknown cause 22.2% (9.5%), runs of at most 4 files 19.1% (17.9%), slow lane 8.7% (3.8%), catch-up of pulls 3.4% (4.8%), of edits 3.1% (14.5%), stored no result 12.8% (38.7%). But the classes changed meaning: cezar's checkpoints are now daemon-start baselines (59.1% of cezar), squeal has no checkpoint, and most runs of at most 4 files are backlog, not edit work | read from store copies; CPU inferred |
| 2 | Runs that kept no result | 7.9% squeal (was 39.3%), 13.7% cezar (38.6%), 46.1% toolkit on 3,683 s. Largest causes: cezar timeouts 6.3%, daemon stop or hold 2.3% (almost all in baselines), inputs changed during the run 2.3%; squeal cancels by an edit during a backlog tier 3.0%. 55% of cezar's no-result seconds came from baseline checkpoints | read from store copies |
| 3 | Catch-up | squeal (2 coordinator worktrees): 147 s per edit on average (p50 49, p90 3,542 among edits that made any); cezar (22 worktrees): 124 s per edit (p50 17, p90 943); node:test is 7.9% of cezar's catch-up; squeal and toolkit have none. FAILs only in catch-up: squeal 7, all 371 to 3,270 s after the edit, mostly packaging tests; cezar 19, one burst of 17 at 443 to 473 s that passed again | read from store copies |
| 4 | Upper bounds of the two ideas | (a) a manual group: cezar's `*-parity.test.ts` 582,499 s (50.5% of cezar) with a stored FAIL in 0.2% of its file runs; cezar e2e 120,013 s (10.4%), 1 FAIL in 5,949; squeal `test/integration` 13,903 s (6.3%), 0 FAIL. (b) catch-up at pause or Stop: at most 0.8% of squeal and 1.0% of cezar, because 99.0% and 76.4% of catch-up seconds already started after a Stop | read from store copies and transcripts; inferred bounds |
| 5 | Ranking | finding 5 | inferred from 1 to 4 |

## 1. The split now

**Same method as 2026-10-23** (`011-core/.../work.mjs`, unchanged; toolkit's window ends at its last run, 12:17Z):

| Recorded s, 72 h | squeal 10-23 | squeal now | cezar 10-23 | cezar now | toolkit now | pooled 10-23 | pooled now |
|---|---|---|---|---|---|---|---|
| total | 260,200 | 220,312 | 246,586 | 1,154,058 | 5,783 | 516,598 | 1,380,153 |
| per active worktree-hour | 4,630 | 3,772 | 4,016 | 3,757 | 771 | | |
| checkpoints | 76.2% | 0 | 13.9% | 51.8% | 21.4% | 46.3% | 43.4% |
| runs of at most 4 files ("edit route") | 5.1% | 37.0% | 31.5% | 15.4% | 78.6% | 17.9% | 19.1% |
| catch-up of edits | 7.2% | 8.2% | 22.7% | 2.1% | 0 | 14.5% | 3.1% |
| catch-up of pulls | 7.2% | 18.3% | 2.4% | 0.6% | 0 | 4.8% | 3.4% |
| backlog of unknown cause | 4.2% | 36.1% | 15.4% | 19.6% | 0 | 9.5% | 22.2% |
| slow lane (cezar e2e) | none | none | 8.0% | 10.4% | 0 | 3.8% | 8.7% |
| stored no result | 39.3% | 7.9% | 38.6% | 13.7% | 29.4% | 38.7% | 12.8% |

Active worktree-hours: squeal 58.4, cezar 307.2 (61.4 in October), toolkit 7.5. Cezar's growth is more worktrees, not more work per worktree-hour. *read from store copies.*

**Why the old classes no longer mean the same.** Three changes since 2026-10-23, each read in the copies and the source:

- *Checkpoints.* Squeal's routine `run --all` is gone (the human, 2026-10-25; 0 checkpoint runs in the window). Cezar has 1 `run-all` checkpoint (13,024 s) and 1,305 `baseline` checkpoints in 253 worktrees (`baseline.onStart: "lookup-then-run-missing"`). The old class "checkpoints" is now daemon-start baselines. *read from store copies, read in config.*
- *Small runs are no longer edit work.* A backlog tier is now split with other daemons that have the same keys pending, down to `runner.tierSize` files (`claims.ts:85`, `backlogSize`), and an edit's tier takes catch-up files beside its own (`tiers.ts`, `selectTier`). In the worktrees with revisions, exact edit work is 4.5% of the seconds in runs of at most 4 files in squeal (1,311 of 28,927) and 22% in cezar (5,942 of 27,011); the rest is catch-up. *read in source code, read from store copies.*
- *Unknown cause grew* because worktrees are now removed soon after their work (squeal: 60 of 62 worktrees with runs; cezar: 243 of 265), and removal drops revisions. *read from store copies.*

**The split with exact classes where they exist** (`split.mjs`; a file is caught up from the newest revision before its run that touched its closure, its path or a declared input; "edit route" is a run within 120 s, the catch-up quiet `CATCHUP_QUIET_MS`, of a watch revision of fewer than 10 paths, or of the file itself):

| Recorded s, 72 h | squeal | cezar | toolkit |
|---|---|---|---|
| total | 220,296 | 1,154,021 | 3,683 |
| baseline checkpoints (daemon start) | 0 | **681,912 (59.1%)** | 607 (16.5%) |
| `run --all` checkpoints | 0 | 13,024 (1.1%) | 0 |
| slow lane outside checkpoints (cezar e2e; e2e in all: 120,013, 10.4%) | none | 23,301 (2.0%) | none |
| worktrees with revisions: edit route | 1,311 (0.6%) | 8,037 (0.7%) | 1,909 (51.8%) |
| worktrees with revisions: catch-up of edits | 31,641 (14.4%) | 39,767 (3.4%) | 114 (3.1%) |
| worktrees with revisions: catch-up of pulls | **54,164 (24.6%)** | 9,871 (0.9%) | 497 (13.5%) |
| worktrees with revisions: daemon-start re-key, other | 907 (0.4%) | 197 | 0 |
| removed worktrees, not attributable | **132,274 (60.0%)** | **377,910 (32.7%)** | 557 (15.1%) |

By runner (cezar): Vitest `server` project 938,178 s (81%), `e2e` 120,012 (10.4%), node:test `root:test:unit` 43,694 (3.8%), `web` 41,371 (3.6%), node:test `test:unit` 10,173 (0.9%). Squeal is Vitest only. Groups by name: no repository has a `checks` key, so every check is in the default `tests` group, except cezar's `packages/web/e2e/*.e2e.ts` in the default `slow` group (`slow.include`; 019 D2). *read in config, read from store copies.*

**Cezar's baselines.** 247 baselines are a worktree's first in the store (78,458 files, 215,735 s); 1,058 come at a later daemon start of the same worktree (67,540 files, 385,151 s: 64% of baseline seconds). The median baseline runs 0 files, p90 426, max 1,542. Cezar's daemons exit after 60 idle minutes (`daemon.idleExitMinutes`). Why a restart misses so many stored keys is not determined here (open question 2). *read from store copies (`baseline.cjs` counts recorded seconds of ended files only, so its total, 600,886 s, is below the split's 681,912).*

## 2. Runs that kept no result

| Share of the repository's seconds | squeal 10-23 | squeal now | cezar 10-23 | cezar now | toolkit now |
|---|---|---|---|---|---|
| **stored no result** | 39.3% | **7.9%** | 38.6% | **13.7%** | 46.1% (1,699 s) |
| timed out (upper bound) | 13.0% | 0.5% | 18.4% | 6.3% | 0 |
| cancelled by an edit during a backlog tier | 9.4% | 3.0% | 5.0% | 1.5% | 0.1% |
| ended, then discarded or replaced at the same key | 11.3% | 0.7% | 7.9% | 0.7% | 23.1% |
| yielded to an edit or a promoted file | 0.5% | 1.6% | 4.3% | 0.5% | 0.5% |
| inputs changed during the run | 2.3% | 1.3% | 2.7% | 2.3% | 19.7% |
| `squeal stop`, hold, crash | 2.4% | 0.5% | 0 | 2.3% | 2.6% (crash) |
| ran bytes no check key holds | | 0.3% | | 0.05% | 0 |

The trigger of each, by run shape (`fates.cjs`), with exact classes where they exist:

- **cezar, 157,942 s.** Baseline checkpoints 86,796 (55%): timeouts 31,640, `squeal stop` 26,198 (daemons stopped mid-baseline), inputs changed 7,920, edit cancels 12,439, yields 4,445. Larger backlog runs 55,041 (35%), most of it timeouts (37,088). Runs of at most 4 files 12,267. `run --all` 3,831. Slow lane 9. In the worktrees with revisions: catch-up of edits 9,989 (25% of its seconds), of pulls 2,006, edit route 2,367.
- **squeal, 17,333 s.** Runs of more than 4 files 14,218 (backlog: edit cancels 6,552, yields 2,946, timeouts 1,206, `squeal stop` 1,084). In the worktrees with revisions: catch-up of pulls 3,098, of edits 1,129, edit route 1.
- **toolkit, 1,699 s.** All one Vitest file, `tools/generator/tests/publish.test.ts` (1,590 s not stored of 3,516), in runs of at most 4 files: inputs changed during the run, or ended and discarded.

*read from store copies.* The fall from 39% to 8 to 14% matches the changes since October: catch-up waits 120 s (row 011-153), no routine `run --all`, and timeout splits. That attribution is *inferred*; no probe isolates each change.

## 3. Catch-up

| | squeal (2 worktrees with revisions) | cezar (22) | toolkit (3) |
|---|---|---|---|
| edits (watch revisions under 10 paths) | 215 | 321 | 75 |
| edits that made catch-up | 42 | 79 | 1 |
| catch-up of edits, recorded s | 31,641 | 39,767 | 114 |
| per edit, all edits | 147 s | 124 s | 2 s |
| per edit that made any: p50, p90, max | 49, 3,542, 4,015 s | 17, 943, 10,854 s | 114 |
| ran after 120 s of quiet / rode a later edit's tier | 86% / 14% | 75% / 25% | 100% / 0 |
| in node:test or pytest (no quiet wait: slots, `quiet.ts` `quietCaughtUp`) | none configured | 3,153 s (7.9%) | none in catch-up |
| stored no result | 3.6% | 25.1% | 0 |

**Test files that turned only in catch-up of an edit**, with the time from the edit that last re-keyed them (transitions within 15 s of the run's end):

- squeal, 7 to FAIL, 2 to PASS: `test/commit/boundary.test.ts` FAIL at 371 s (PASS at 1,778 s); `test/harness/skill.test.ts` 480 s; `test/harness/pi/package.test.ts` 609 s; `test/harness/opencode/package.test.ts` 666 s; `test/harness/plugin.test.ts` 1,091 s; `test/harness/codex/packaging/runtime.test.ts` 1,303 s; `test/harness/opencode-dispose.test.ts` 3,270 s (PASS at 6,080 s). Five of the seven read or bundle sources through declared inputs, the class `edit-load.md` finding 3 found coverage would miss.
- cezar, 19 to FAIL, 20 to PASS: 17 `packages/cezar/src/{server,workflows,delegation}` files turned FAIL 443 to 473 s after their edit and PASS again 226 to 771 s after a later edit (one burst; cause not determined); `packages/web/src/routes/github/github-route-wiring.test.tsx` FAIL at 3,390 s, PASS 4,702 s; `packages/web/src/test/e2e-wait-discipline.test.ts` FAIL at 4,231 s, PASS 5,071 s.

*read from store copies.* For removed worktrees no catch-up can be counted (no revisions, no transitions).

## 4. What the human's two ideas could save

**(a) Groups the project would mark manual.** Upper bound: every recorded second of the group, if it ran only on request. What each buys is counted as stored FAIL results in all worktrees (`fails.cjs`; transitions exist only for live worktrees, `trans.cjs`).

| Candidate (no repository has a `checks` key; names are path patterns) | Files | Recorded s, 72 h (share of repository) | Not stored | File runs with a FAIL result | Worktree-files with a FAIL | Transitions (live worktrees) |
|---|---|---|---|---|---|---|
| cezar `**/*-parity.test.ts` (Vitest `server`) | 322 | **582,499 (50.5%)** | 113,766 | 43 of 19,667 (0.2%) | 43 | 0 |
| cezar `packages/web/e2e/*.e2e.ts` (today's `slow` group) | 90 | 120,013 (10.4%) | 227 | 1 of 5,949 | 1 | 0 |
| cezar node:test `root:test:unit` | 113 | 43,681 (3.8%) | 593 | 64 of 11,821 | 28 | 1 / 1 |
| of it, `.github/scripts/release-finalization.test.cjs` | 1 | 11,942 (1.0%) | 17 | 0 of 98 | 0 | 0 |
| squeal `test/scheduler/**` | 265 | 74,207 (33.7%) | 3,921 | 70 of 9,582 | 61 | 1 / 1 |
| squeal `test/daemon/**` | 115 | 36,975 (16.8%) | 1,617 | 10 of 3,537 | 8 | 0 |
| squeal `test/harness/**` | 174 | 28,990 (13.2%) | 3,856 | 255 of 9,031 | 137 | 7 / 7 |
| of it, `test/harness/{codex,opencode,pi}/**` | 74 | 11,532 (5.2%) | 1,563 | 170 of 4,761 | 83 | 3 / 3 |
| squeal `test/integration/**` | 27 | 13,903 (6.3%) | 737 | 0 of 1,386 | 0 | 0 |

The parity files' seconds sit in all classes, baselines included; a manual group would also leave them out of a daemon-start baseline. Squeal's harness tests are the opposite case: 13.2% of the seconds and 40% of squeal's worktree-files with a FAIL (137 of 339). *read from store copies and config; the bound inferred.*

**(b) Catch-up moved to pause, Stop or commit** (worktrees with revisions; Stop = a Claude Code `stop_hook_summary` or Codex `task_complete` in a main session of the worktree; pause = no turn open):

| Catch-up of edits | squeal | cezar |
|---|---|---|
| recorded s | 31,641 | 39,767 |
| a Stop came between the edit and the run's start | **31,316 (99.0%)** | **30,395 (76.4%)** |
| the run started while no turn was open (a pause) | 27,140 (85.8%) | 25,289 (63.6%) |
| the same file ran again in the worktree before the next Stop (one run at Stop would do) | 716 (2.3%) | 1,394 (3.5%) |
| ran again before the next commit (head move) | 243 (0.8%) | 2,387 (6.0%) |
| stored no result | 1,129 (3.6%) | 9,989 (25.1%) |
| **upper bound saved by "catch-up at Stop"** (re-runs before Stop plus no result) | **1,845 s, 0.8% of squeal** | **11,383 s, 1.0% of cezar** |

The 120 s catch-up quiet already moves most catch-up past the end of the turn (*inferred*: the table shows the Stop came first; the turn lengths were not measured). Moving catch-up later changes when its verdicts arrive more than how much runs. Catch-up of pulls (squeal 54,164 s, coordinator merges) is not held by the quiet (a pull starts no catch-up wait, `quiet.ts`), and the brief's two ideas do not cover it. *read from store copies, transcripts and source; the bound inferred.*

## 5. Ranking

Every share above 5% of one repository's or the pooled seconds (1,378,000), by seconds. Rows overlap where stated.

| Share | Recorded s, 72 h (pooled %) | Repository share | What it buys |
|---|---|---|---|
| cezar baseline checkpoints at daemon start | 681,912 (49.5%) | cezar 59.1% | results a worktree's lookup did not find: an earlier verdict for the next edit. 64% come at restarts of worktrees that already ran a baseline; 12.7% stored nothing; 19 files to FAIL and 16 to PASS in live worktrees |
| cezar `*-parity.test.ts` (overlaps the row above) | 582,499 (42.3%) | cezar 50.5% | a verdict that was a FAIL in 0.2% of 19,667 file runs (43 worktree-files); 0 transitions |
| Not attributable: removed worktrees, outside checkpoints | 510,184 (37.0%) | squeal 60.0%, cezar 32.7% | not determined: revisions and transitions are gone |
| Work that stored no result (overlaps every row) | 176,974 (12.8%) | squeal 7.9%, cezar 13.7%, toolkit 46.1% | nothing kept; cezar's 6.3% timeouts are the largest part |
| cezar e2e (default `slow` group; overlaps baselines) | 120,013 (8.7%) | cezar 10.4% | browser verdicts: 1 FAIL in 5,949 file runs, 0 transitions |
| squeal catch-up of pulls (coordinator worktrees) | 54,164 (3.9%) | squeal 24.6% | verdicts after merges: 6 to FAIL, 5 to PASS |
| squeal `test/scheduler/**` (by directory, overlaps the classes) | 74,207 (5.4%) | squeal 33.7% | 61 worktree-files with a FAIL |
| squeal `test/daemon/**` | 36,975 (2.7%) | squeal 16.8% | 8 worktree-files with a FAIL |
| squeal catch-up of edits | 31,641 (2.3%) | squeal 14.4% | 7 to FAIL, 2 to PASS, 371 to 3,270 s after the edit, mostly packaging tests |
| squeal `test/harness/**` | 28,990 (2.1%) | squeal 13.2% | 137 worktree-files with a FAIL, 40% of squeal's |
| squeal `test/integration/**` | 13,903 (1.0%) | squeal 6.3% | 0 FAIL in 1,386 file runs |
| toolkit edit route | 1,909 (0.1%) | toolkit 51.8% | the edit's own verdict; 1,263 s of it stored nothing |
| toolkit baseline, catch-up of pulls | 607, 497 | toolkit 16.5%, 13.5% | start and merge verdicts |

*inferred from findings 1 to 4; every count is read from the store copies as stated there.* The October ranking's top two (`run --all` checkpoints 46.3%, no result 38.7%) are gone or small; the new top two are cezar's daemon-start baselines and its parity tests.

## Recommendation for Squeal

None as design: the brief asks for numbers. For the human's choice, the numbers say: "light" mode (catch-up at pause or Stop) saves at most about 1% of either repository, because catch-up already runs after the turn ends. A manual group has a large bound only where a project marks one: cezar's parity tests (50.5%) and e2e (10.4%). The largest share neither idea touches is cezar's baseline at each daemon start (59.1%, two thirds of it at restarts).

## Open questions

1. Removed worktrees: 60% of squeal's and 33% of cezar's seconds cannot be attributed, because removal deletes revisions and transitions. Not determined from these stores.
2. Why 1,058 cezar baselines at a daemon restart ran 67,540 files whose results an earlier daemon of the same worktree had stored: not determined, because the stores keep one result row per check and key, not the keys a lookup missed.
3. CPU per recorded second was not re-measured (no test runs); 0.32 to 0.59 from 2026-10-23 is used, and e2e's ratio is still not measured.
4. The delay "catch-up at Stop" would add to each catch-up FAIL: not computed per transition.
5. The 17-file cezar burst that failed and passed again in catch-up: cause not determined (load or environment is likely, not checked).

## Sources

- Store copies 2026-11-05 16:50Z: `~/projects/{squeal,cezar,toolkit-dev,mvp-unveiled-july26,saas-bp-management-dashboard}/.git/squeal/store.sqlite` with `-wal` and `-shm`; run logs `report.json` read in place.
- Configs: `squeal.config.json` of the squeal, cezar and toolkit-dev main checkouts, read 2026-11-05.
- Transcripts: `~/.claude/projects/**/*.jsonl` and `~/.codex/sessions/**/*.jsonl` changed since 2026-11-02T14:00Z (6,519 files).
- Source at squeal `48da797c8`: `src/core/scheduler/quiet.ts` (`BACKLOG_QUIET_MS`, `CATCHUP_QUIET_MS`), `edit-cut.ts`, `claims.ts` (`backlogSize`), `tiers.ts` (`selectTier`), `slow-trigger.ts`, `src/core/store/prune.ts`, `src/core/fs/git-layout.ts`, `src/core/types/policy.ts:364`.
- Earlier numbers: `011-core/research/edit-load.md` findings 0, 2 and 6.
- Probes: `probes/load-split/` (README lists each script and the commands).
