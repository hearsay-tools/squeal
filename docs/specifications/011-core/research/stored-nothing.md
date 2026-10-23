# 011-148: why test work stores nothing, and when catch-up should start

Researcher of row 011-148, 2026-10-23, 13:17Z to 13:50Z. Brief: `research/stored-nothing-brief.md`. Read: `docs/vision.md`, `docs/styleguide.md`, `docs/process.md`, `research/edit-load.md` and `probes/edit-load/work.mjs`, `research/host-load.md`, `research/running-tier-yields.md`, `research/yields-replay.md`, spec 011 C4 (steps 3 to 5, the timeout split, tier sharing), C7, C9, C10.

Versions: source read at this branch's base `4e1ba068` (0.1.276). The stores hold runs of daemons 0.1.2xx. Store copies of squeal, cezar and toolkit-dev with a snapshot of each `runs` log directory, taken back to back at 13:25:32Z to 13:25:36Z (the live daemons prune runs and logs, so a log read in place does not match a copy). Windows: the 72 hours before each store's last run start: squeal 10-20T13:23Z to 10-23T13:23Z (1,696 runs, 36,710 file runs), cezar 10-20T13:25Z to 10-23T13:25Z (2,326 runs, 14,069), toolkit 10-20T07:41Z to 10-23T07:41Z (536 runs, 4,116). Turn ends: Claude Code `stop_hook_summary` entries and Codex `task_complete` events of the live worktrees. Load: `sar` (`sadf -d -- -q`). No test, daemon or Squeal command ran; load 35 to 77 during the session. Probes and how to re-run each: `probes/stored-nothing/README.md`.

**Units.** *Recorded seconds* are the per-file durations in the run reports (`fileDurations`) or the stored check durations. A file a run cut before its end has no duration: it counts the run's wall when its log has a line of it (*upper bound*), 0 when it has none, and, as a *tight bound*, `min(wall, 2 × its usual duration)`, the usual duration being the median of its stored file rows. One recorded second cost 0.32 to 0.59 CPU-seconds on this host (`edit-load.md` 0).

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Each part | Squeal stored nothing for 43.3% of 237,814 recorded s, cezar 32.3% of 257,856, toolkit 49.5% of 14,029. The largest part is not waste: files that ended in worktrees removed since, whose results the prune deleted with the worktree (squeal 17.0%, cezar 13.0%). In live worktrees the part is 28.8% (squeal) and 23.8% (cezar) at the upper bound. By rule: cut by a cancel 15.2% / 11.1%, timed out 6.6% / 4.3%, inputs changed 1.5% / 1.1%, replaced at the same key 0.7% / 2.1%. With the tight bound, the cut parts shrink to a fifth or less, except cezar's yields (two thirds) | read from store, read in source code |
| 2 | Timeouts | All were the run timeout (`runner.timeoutMs`, 600 s; cezar 900 s since its config change). Squeal 19, every one a checkpoint tier of 15 to 200 files; cezar 12. Load at start 13 to 78. The split already keeps every ended file (16,345 s stored in squeal's 19). The files in flight hung: 40 of 42 have a usual duration under a third of the timeout. The tiers held far more work than the 120 s budget allows: their files' usual durations summed 628 to 2,464 s, because a fresh worktree's misses carry no duration and count 0. The same file and key timed out again 3 times in cezar: twice through `run --all`, once by the split | read from store, read in source code |
| 3 | The same key twice | A stored result replaced by a later run at its key: squeal 1,559 s (0.7%), cezar 5,495 s (2.1%), toolkit 357 s. Causes: the C5 re-run of a new failure (617 s, 1,900 s, 205 s), runs of two worktrees at the same key at once, edit work and forced C5 re-runs, which do not wait on a claim (cezar 1,924 s), a later worktree after it ended (84 s, 715 s), `run --all` (146 s, 158 s, 117 s), a baseline (520 s in squeal). Restarts: 0 s. The 7.9 to 11.3% of `edit-load.md` was mostly the prune | read from store (exact where the key is the worktree's current one), inferred elsewhere |
| 4 | When catch-up starts | Catch-up of edits in live worktrees (squeal 7,843 recorded s, cezar 22,039). Each needed run modelled at its file's usual duration: today 5,450 and 8,283 s. A quiet of 60 s: 3,486 and 7,836; 120 s: 3,423 and 6,606; 300 s: 3,423 and 5,976; the turn end: 3,423 and 6,223. So 1,677 to 2,307 recorded s saved per repository in 72 h at 120 s, 300 s or the turn end (540 to 1,360 CPU-s); at 60 s, 1,964 (squeal) and 447 (cezar). The to-FAIL catch-up runs (12 and 6 of them) arrive at most 51 s later at 60 s, 111 s and 22 s later at 120 s, 557 s and 202 s later at 300 s, 288 s and 82 s later at the turn end; at 120 s, 6 and 5 of them do not move | verified by replay (model) |
| 5 | Squeal's checkpoints | 76% of squeal's work in `edit-load.md` is mostly the **baseline**, not `run --all`: baseline 138,720 s (58.3% of the window), `run --all` 49,058 s (20.6%). Of `run --all`'s work, 66% (32,258 s) was on files an edit had re-keyed since the daemon started, which would have run as edit or catch-up work anyway; 4% (2,109 s) ran only because of it; 30% is in removed worktrees. It stored nothing for 35%: the prune 20%, timeouts 8.6%, cancels 3.9%. The baseline stored nothing for 49%: the prune 16.4%, cancels 21% (supersession 10.1%), timeouts 8.3% | read from store, inferred |
| 6 | Ranking | finding 6 | inferred from 1 to 5 |

## 1. Each part of "stored nothing"

`fate.mjs` decides, per file a run held, what kept its result out of the store. `storeDecision` logs nothing per file, so the rule is inferred from the run's report (completed files, failure text, `withheld`), the worktree's revisions during the run, and the results that exist now. A result at the same key afterwards is exact when no later revision touched the file: the worktree's key is then the one it ran at, and `results` is checked at that key. Otherwise it is inferred: a later run of the file in the same worktree with no revision between that touched its closure.

| Part (rule, file and line at `4e1ba068`) | squeal s (share), files | cezar s (share), files | Tight bound s, squeal / cezar | Result at the same key afterwards |
|---|---|---|---|---|
| stored | 134,865 (56.7%) | 174,619 (67.7%) | | |
| ended in a worktree removed since: the prune deletes its results unless their key is live (`src/core/store/prune.ts:61-62`), its runs with no result left (`prune.ts:100-110`), and its revisions and transitions (`src/core/store/repos/worktrees.ts:154-163`) | 40,539 (17.0%), 7,147 | 33,400 (13.0%), 3,304 | same | not determined: the worktree's keys are gone |
| timed out: `run exceeded timeoutMs` (`src/runners/vitest/run.ts:95`); an incomplete file is `unknown` alone or split (`src/core/scheduler/store-decision.ts:153-154`) | 15,702 (6.6%), 1,571 | 11,120 (4.3%), 580 | 2,641 / 1,001 | squeal: yes for 3,020 s, no for 2,413 s, key moved for the rest; cezar: a later same-key run for 2,707 s |
| cancel, supersession (`store-decision.ts:150`; cause `src/core/scheduler/yields.ts:189`) | 15,398 (6.5%), 458 | 6,833 (2.6%), 289 | 2,008 / 1,524 | no: the key moved, by definition |
| cancel, an edit during a backlog tier (`store-decision.ts:150`; `src/core/scheduler/backlog.ts:28`) | 13,584 (5.7%), 4,735 | 13,471 (5.2%), 801 | 4,196 / 1,252 | squeal yes 1,416 s; cezar a later same-key run 6,757 s; the key moved for most |
| cancel, a yield (`yields.ts`) | 1,286 (0.5%), 87 | 8,288 (3.2%), 194 | 1,073 / 5,481 | cezar yes 1,095 s, no 684 s |
| cancel, stop or step-down (C9) | 5,996 (2.5%), 3,385 | 234 (0.1%) | 2,875 / 10 | key moved or worktree removed |
| ended, inputs changed during the run: the stability check (`store-decision.ts:159`, `src/core/scheduler/tiers.ts:693`) | 3,470 (1.5%), 510 | 2,718 (1.1%), 186 | same | no: the key moved |
| ended, replaced: a later run stored the same key, `INSERT OR REPLACE` on `(check_id, key)` (`src/core/store/repos/results.ts:130`) | 1,559 (0.7%), 78 | 5,495 (2.1%), 75 | same | yes, by definition |
| ended, no rule seen | 2,300 (1.0%), 52 | 1,320 (0.5%), 66 | same | squeal no for 415 s |
| crashed, withheld, no report | 3,114 (1.3%) | 359 (0.1%) | 1,066 / 285 | |

Toolkit: crashed 4,636 s (33.0%, tight 121 s): four Vitest runs whose forks pool failed to start ("Failed to start forks worker") and pytest batches; no report (pytest or node:test) without a result 1,318 s (9.4%). *read from store.*

**The prune explains the largest part.** In removed worktrees, every result that remains sits under a key some live worktree holds: squeal 30,791 of 30,791 rows of the window, cezar 58,171 of 58,171; in live worktrees 29% and 42% do (`pruned.mjs`). And only 4 and 12 runs of removed worktrees with no result survive, against 90 and 158 in live ones. So the prune deleted the rest: these files stored results, which served their worktree until it was removed. `edit-load.md` counted them as stored nothing. Its "backlog of unknown cause" (69 to 84% stored nothing) is largely the same artefact, since the prune deletes the revisions too: here 70% (squeal) and 55% (cezar) of that class's seconds are files that ended in a removed worktree. Runs of a removed worktree that stored nothing at all are deleted with it, so the window also lacks some waste. *read from store, read in source code; that these files stored is inferred.*

**Cut files count far less than the run's wall.** A cancelled or timed-out tier of 200 files holds at most one file per worker when it stops. Squeal's 19 timed-out runs held 3,158 files: 1,399 stored (16,345 s), 188 ended and stored nothing (179 of them in removed worktrees), 26 were in flight, 1,545 had not started. With the tight bound, squeal's measured part of stored nothing falls from 43.3% to 31.4% of the work, cezar's from 32.3% to 23.1%, and the parts that are not the prune to 10.8% and 8.4%. *read from store, inferred (the bound).* A file that started and logged nothing yet (stuck in its import or a `beforeAll`) counts 0, so the bounds miss at most one file per worker.

## 2. Timeouts

`timeouts.mjs` and `timeouts2.mjs` over every timed-out run (`results/timeouts.txt`):

| | squeal | cezar |
|---|---|---|
| runs; timeout | 19; 600 s | 12; 600 s, 900 s for the last 3 (`squeal.config.json` `timeoutMs` 900,000 now) |
| tiers | 14 baseline, 5 `run --all`, 15 to 200 files | 1 to 4 files of the edit route (3 runs), 1 to 15 of `run --all` (4), 60 to 200 of backlog or catch-up (5) |
| load (one minute) at start | 13 to 78, about 50 at the median | 22 to 71, about 43 |
| ended and stored | 1,399 files, 16,345 s | 158 files, 3,280 s |
| in flight at the timeout | 26 files; 24 with a usual duration under a third of the timeout | 16 files; all 16 under a third |
| work in the tier, by usual durations | 628 to 2,464 s per tier; it ran 0.6 to 3.5 file-seconds per second | 29 to 1,271 s per tier |

**Why the tiers were too large.** A daemon's start gives a miss its last duration only from the worktree's previous key (`src/core/scheduler/bootstrap.ts:181`: `if (previous === null) continue;`). A fresh worktree has no previous key, so its misses keep no duration, and the backlog budget counts an unknown duration as 0 (`src/core/scheduler/backlog.ts:92-93`). The tier then fills to `runner.backlogTierSize` (200). The store held a duration for every file of squeal's timed-out tiers (`timeouts2.mjs`: unknown 0). 14 of squeal's 19 were baseline tiers, 11 at revision 0, a worktree's first daemon start. *read in source code, read from store; the link inferred.*

**Repeats at the same key.** Cezar: `workflows/waits-parity.test.ts` timed out 3 times at revision 106 of one worktree (18:29Z in a 15-file `run --all` tier, then alone at 18:39Z and 19:29Z, both `run --all`); `core/harness-parity.test.ts` twice at revision 112 (the split's tier of 1 after a tier of 2, as designed). C4 makes `run --all` take every `unknown` file ("An unkeyed or `unknown` file is always work to do"), so each `run --all` spends another timeout on a hanging file: 2 of cezar's 12 timeouts, 1,200 s of lane time. Squeal: the repeated files (`daemon/hold.test.ts`, `daemon/drain.test.ts`, `scheduler/catch-up-order.test.ts`) timed out in two worktrees each, so the same key is not determined. *read from store, read in spec.*

**What a change would save.** Keeping completed files: nothing more, since the 001-179 split already stores them; 9 ended files in live worktrees (440 s) went unstored, by the rules of finding 1. A timeout scaled by load: 2 of 42 in-flight files would have ended (`daemon/hold.test.ts`, usual 284 s; `scheduler/timed-out-tier.test.ts`, 126 s), at most 1,200 s re-run saved; the other 40 hung and would hold their lane longer. Durations at a fresh worktree's start: the 19 squeal tiers would have been several smaller tiers within the budget; what that saves is the in-flight part (tight bound 2,641 s in squeal, 1,001 s in cezar) and the long tiers' exposure to cancels (finding 5). *inferred.*

## 3. The same key twice

The exact case is a stored row that a later run at the same key replaced. `dup.mjs` asks why the later run ran (`results/same-key.txt`):

| Why the later run ran | squeal | cezar | toolkit |
|---|---|---|---|
| C5 re-run of a new failure, same worktree | 617 s, 23 | 1,900 s, 24 | 205 s, 9 |
| another worktree's run during it (work an edit caused and forced runs do not wait on a claim, C4 step 4; 1,524 s of cezar's is one parity file's C5 re-runs) | 86 s, 3 | 1,924 s, 19 | |
| another worktree, after it ended | 84 s, 2 | 715 s, 10 | |
| a baseline in the same worktree | 520 s, 20 | | 35 s, 2 |
| `run --all` in the same worktree | 146 s, 9 | 158 s, 1 | 117 s, 105 |
| edit or catch-up work at the same key, same worktree | 106 s, 20 | 797 s, 21 | |
| a daemon restart between | 0 s, 1 | | |

*read from store; the key exact for 719 s (squeal) and 3,620 s (cezar), inferred for the rest.* A run that stored nothing and was run again at its key is the cost of its part in finding 1; the "result at the same key afterwards" column holds those seconds. Two worktrees on the same key could not be told apart beyond the same clean commit: the prune leaves one row per check and key.

## 4. When catch-up starts

`catchup.mjs` replays the live worktrees' catch-up runs of edits (C4 step 4: a revision of fewer than 10 keyed paths, the files outside the edit cut). Rule Q: a run that started at `s` starts at the first time at or after `s` with Q seconds since the worktree's last watch revision. Rule turn: when the worktree had an edit since its last turn end, it starts at the next turn end. A run whose file a revision re-keyed before the new start is not needed; the runs of a file that move to the same start become one, at the file's usual duration. The 20 s row is close to today's quiet, which holds only after a cancel. *verified by replay (model); turn ends read from transcripts.*

| Catch-up of edits | Modelled recorded s, squeal | Saved | to-FAIL runs later: each delay | Modelled recorded s, cezar | Saved | to-FAIL runs later: each delay |
|---|---|---|---|---|---|---|
| recorded (today) | 7,843 recorded; 5,450 modelled | | 12 runs, 0 s | 22,039 recorded; 8,283 modelled | | 6 runs, 0 s |
| quiet 20 s | 4,989 | 461 | 11, 11, 15 s | 8,283 | 0 | none |
| quiet 60 s | 3,486 | 1,964 (36%) | 36, 36, 51, 51 s; 2 re-keyed first | 7,836 | 447 (5%) | none |
| quiet 120 s | 3,423 | 2,027 (37%) | 96, 96, 111, 111 s; 2 re-keyed | 6,606 | 1,677 (20%) | 22 s |
| quiet 300 s | 3,423 | 2,027 (37%) | 291, 291, 557, 557 s; 2 re-keyed | 5,976 | 2,307 (28%) | 30, 202 s |
| turn end | 3,423 | 2,027 (37%) | 63, 63, 288, 288 s; 2 re-keyed | 6,223 | 2,060 (25%) | 82 s |

At 0.32 to 0.59 CPU-s per recorded second, the saving at 120 s or later is 540 to 1,360 CPU-s per repository in 72 hours. With catch-up of pulls added (squeal 25,939 recorded s, cezar 41,428), the savings are 450 to 2,600 s, and cezar's 13 to-FAIL runs arrive up to 408 s later at 300 s and up to 1,316 s later at the turn end (one run). *verified by replay (model).*

**What the model leaves out.** Recorded catch-up time is larger than the model's because cut files count their wall and ran slower than usual: squeal 7,843 against 5,450, cezar 22,039 against 8,283. In squeal, nearly all the cut work (1,897 s) is on files re-keyed before the deferred start: 113 s are left at 60 s, 69 s at 120 s. In cezar it is not: 8,012 to 9,051 s of it stays, mostly two timed-out 200-file catch-up tiers (2,707 s) and supersessions (4,334 s, upper bound), which a later start does not change. The brief's 29 and 15 FAILs of catch-up of edits: 12 and 6 are in worktrees still live and in this window (2.5 hours later than `edit-load.md`'s); the others' worktrees were removed with their revisions, so their delay is not determined.

## 5. Squeal's checkpoints

`ck.mjs`, the run's checkpoint kind from `checkpoints.kind` (`results/checkpoints.txt`). Squeal keeps the default baseline, `lookup-then-run-missing`; cezar sets `lookup-only` (`squeal.config.json`).

| Squeal, 72 h | Recorded s | Stored nothing |
|---|---|---|
| baseline, worktree removed since | 53,840 | 71% (the prune, mostly) |
| baseline, a worktree's first daemon start | 51,256: 28,959 with no path changed while no daemon ran, 22,297 with paths changed | 69%; 6% |
| baseline, files an edit re-keyed since the start | 22,537 | 31% |
| baseline, a later daemon start | 11,088 | 17% |
| `run --all`, files an edit re-keyed since the start (edit or catch-up work anyway) | 32,258 (66%) | 22% |
| `run --all`, worktree removed since | 14,692 (30%) | 67% |
| `run --all` only | 2,109 (4%) | 0% |

So `run --all` (the `CLAUDE.md` rule) adds about 2,109 s in 72 h to live worktrees beyond the catch-up it starts sooner, by ending the quiet (C4). Its 35% stored nothing is the prune (20.1%), timeouts (8.6%), an edit during a backlog tier (3.7%) and replaced rows (1.0%). The baseline is the larger cost: 162 starts in 72 h, 96 abandoned. Its 49% stored nothing is the prune (16.4%), supersession by the agent's edits (10.1%; `src/**/*.ts` is a declared input of 45 harness and integration files, `edit-load.md` 1), timeouts (8.3%), an edit during a backlog tier (6.7%) and stop or step-down (3.9%). Why a fresh worktree misses at a commit another worktree ran: not determined, because the prune removed the other worktrees' rows; at clean revisions 34,781 s had no earlier row of the file at that commit, 24,526 s ran at a dirty revision (`miss.mjs`). *read from store, inferred.*

## 6. Ranking

Recorded seconds in the stores' 72 hours (squeal + cezar), the tight bound beside the upper one for cut work. No design.

| Candidate | Saves, recorded s (tight) | Costs | Evidence |
|---|---|---|---|
| Measure from the run, not the surviving rows: count a file stored when the run stored it | 0 CPU; removes 73,939 s (15%) of false "stored nothing" | none | finding 1, `pruned.mjs` |
| Squeal's baseline set to `lookup-only`, as cezar | up to 51,256 s of first-start baselines in live worktrees (+ removed ones), about 16,000 to 30,000 CPU-s | no whole-suite verdict at a worktree's start; a stale failure shows only by lookup; repository config, a coordinator's call | finding 5 |
| Durations for a fresh worktree's misses from the file's newest stored rows | squeal timeout in-flight 15,702 s (2,641), part of baseline supersessions 13,956 s (tight under 2,008) | none in correctness; smaller tiers store sooner | finding 2 |
| Catch-up starts after 120 s of quiet (or at the turn end) | 2,027 + 1,677 s of modelled catch-up (540 to 1,200 CPU-s per repository); squeal's cut catch-up work 1,897 s nearly all | catch-up FAILs: 4 of 12 later by up to 111 s (squeal), 1 of 6 by 22 s (cezar); 300 s: up to 557 s | finding 4 |
| A step-down lets its running tier end | up to 4,465 s (2,416) in squeal | newer hooks wait for the tier, up to the budget | finding 1 |
| `run --all` does not re-run a file that timed out alone at its key | 1,200 s of lane time in cezar (2 timeouts of a hanging file) | a timeout caused by load is not retried by `run --all` | finding 2 |
| An edit's tier waits for another worktree's run of the same key | up to 1,924 s in cezar | the edit's verdict waits for the other run | finding 3 |
| A timeout scaled by load | at most 1,200 s (2 files) | 40 of 42 in-flight files hung: lanes held longer | finding 2 |
| Keeping completed files of a timed-out tier | 0: already done (001-179) | | finding 2 |
| C5 re-runs, the stability check, supersession | 617 + 1,900 s; 3,470 + 2,718 s; 15,398 + 6,833 s (3,532) | each guards a verdict: removing one costs correctness | findings 1, 3 |

*inferred from findings 1 to 5.*

## Recommendation for Squeal

None: the brief asks for numbers, not design. Before any design, measure "stored nothing" against the prune: about two fifths of what this window shows as stored nothing (73,939 of 186,186 s in squeal and cezar) is results that existed and were deleted with their worktree. The largest real cost on squeal is its own baseline policy at every new worktree, and the 200-file tiers it builds because a fresh worktree's misses have no duration.

## Open questions

1. What ended files of removed worktrees did: not determined, because the prune deleted their revisions and results. Live worktrees' rate (ended, then not stored for a rule: 4.5% of squeal's live work, 5.3% of cezar's) suggests most stored.
2. CPU of a hung file in flight: not measured; its wall counts in the upper bound only.
3. The FAILs of catch-up of edits that the brief counts and this window lacks (17 in squeal, 9 in cezar): not determined, as 1.
4. Why fresh squeal worktrees missed keys another worktree had run at the same commit: not determined, as 1. Row 011-35's question (keys across releases) is beside it.
5. A file that started and logged nothing counts 0 when cut: the bounds miss up to one such file per worker.

## Sources

- Store copies: `~/projects/{squeal,cezar,toolkit-dev}/.git/squeal/store.sqlite` with `-wal` and `-shm`, copied 2026-10-23 13:25:32Z; `runs/` snapshot copied 13:25:32Z to 13:25:36Z.
- Source at `4e1ba068`: `src/core/scheduler/{store-decision,bootstrap,backlog,tiers,yields}.ts`, `src/core/store/{prune.ts,repos/results.ts,repos/worktrees.ts}`, `src/runners/vitest/run.ts`; spec 011 C4, C7, C9.
- `squeal.config.json` of cezar (`baseline.onStart: "lookup-only"`, `timeoutMs` 900,000) and toolkit-dev; squeal's default policy (`src/core/types/policy.ts:268-272`).
- Transcripts, read only, for turn-end timestamps: `~/.claude/projects/<live worktree>/*.jsonl`, `~/.codex/sessions/2026/10/{19..23}/*.jsonl`.
- `sar`: `/var/log/sysstat/sa20` to `sa23`.
- Probes: `probes/stored-nothing/` (README lists each script and the commands; `results/` holds the outputs quoted here).
