# 011-298: why a restarted daemon re-runs what its predecessor stored

Researcher of row 011-298, 2026-11-05, 21:50Z to 22:40Z (Europe/Warsaw 22:50 to 23:40). Brief: `research/restart-baseline-brief.md`. Read: `docs/vision.md`; `019-run-triggers/research/load-split.md` and `probes/load-split/`; `src/core/scheduler/bootstrap.ts`, `scheduler/keying.ts` (`bootstrap`), `scheduler/scheduler.ts` (`inUse`, `owedWork`), `daemon/lifecycle.ts` (`startTimers`, `drainable`), `presence/facts.ts` (`resumesRest`), `keys/check-key.ts`, `keys/environment-hash.ts`, `keys/environment.ts`, `keys/observed.ts`, `keys/key-format.ts`, `store/schema.ts`, `store/repos/results.ts` at squeal `04d9d5e2d` (0.1.405).

Data: one copy of cezar's store (`store.sqlite` with `-wal` and `-shm`), taken 21:56Z. Window as `load-split.md`: 72 h to 2026-11-05T16:50Z. Fixture runs: a fresh repository under my `$TMPDIR`, 9 Vitest files, nice 10, 4 host slots, removed at the end. No test ran in a cezar or squeal worktree. Load1 during the fixture runs: 20 to 37 (24 CPUs). Probes and re-run steps: `probes/restart-baseline/README.md`.

**Units.** Recorded seconds are the per-file durations in `report.json` (node:test: the stored durations), as `load-split.md`. Shares are of the 372,853 recorded s that restart baselines ran.

**A correction to the premise.** `load-split.md` counted 1,058 restart baselines with 67,540 files. Those are the files the baselines *listed* as misses. 691 of the 1,058 listed none. The other 367 listed 67,540, and their runs started 23,861 of them (372,853 s). 43,679 listed files never started before the daemon stopped. *Read from the store copy (`classify.cjs`).*

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Why each restart-baseline file missed | 50.9%: the predecessor listed the file as a miss at its own start and stored nothing for it. 40.0%: a commit move (pull, merge, rebase, commit) re-keyed it. 5.7%: other revisions at the same commit re-keyed it, which the predecessor never ran. 3.2%: the key moved with no local revision. 0.3%: other. No lookup that should have hit | read from the store copy; causes inferred from revisions and commits |
| 2 | Defect share | 0 found. Restarts with no change ran 0 of 8 files, four times (also after an empty commit and after `touch` of every file). The 3.2% "no local revision" share has two reproduced causes that are not lookup defects: another worktree's run grows the shared observed set, and a different Node version | verified by experiment |
| 3 | What settings change | `daemon.idleExitMinutes` does not decide these exits: a daemon with a session exits 3 s after its last session ends. A longer daemon life saves at most the 1.2% cut in flight. `baseline.onStart: "lookup-only"` removes at least 50.9%, at most 99.7%, about 70% by a small sample; it loses 18 FAIL file runs of 23,861 (0.08%) as an early verdict | read in source code; shares read from the store copy; bounds inferred |

## 1. Why each file missed

`causes.cjs` puts each file the restart ran in the first matching class. "Predecessor" is the daemon that started at the worktree's previous baseline. "Moved" compares the restart's own result (commit, revision) with the predecessor's last stored result for the file, or with its start when it stored none.

| Class | Recorded s | Share | File runs | Baselines | Tag |
|---|---|---|---|---|---|
| **1 The predecessor listed it at start and stored nothing** | **189,944** | **50.9%** | 8,850 | 183 | predecessor never stored |
| of it: the predecessor never started it | 185,450 | 49.7% | 8,385 | 178 | |
| of it: its run did not finish (stopped, timed out) | 4,494 | 1.2% | 465 | 44 | |
| **2 and 3 Key moved after the predecessor's last result or start: commit moved** | **148,883** | **40.0%** | 11,674 | 109 | expected re-key |
| **Same commit, later revisions (own uncommitted edits) the predecessor never ran** | **21,406** | **5.7%** | 2,353 | 40 | expected re-key |
| **No local revision since** | **12,010** | **3.2%** | 626 | 41 | expected re-key by design or configuration (below) |
| Later revisions, commit not recorded | 491 | 0.1% | 346 | 32 | expected re-key |
| Own result gone (replaced or discarded) | 119 | 0.03% | 12 | 7 | not determined |

By project: server 291,489 s (78.2%), e2e 64,629 (17.3%), web 9,146 (2.5%), node:test 7,584 (2.0%). In class 1, server is 131,030 s and e2e 52,653.

**Class 1 is continuation, not repetition.** All 182 predecessor baselines behind it ended `abandoned` (one completed). 154 of 183 predecessors ran part of their baseline, then stopped; their last run ended under 15 minutes before the restart in 51% of these seconds. The next daemon listed the rest again and ran it. Only the 1.2% cut in flight was work done twice. *Read from the store copy (`predecessors.cjs`).* Why the predecessor stopped: the source says a baseline is no use and owes nothing (`Scheduler.inUse`, `owedWork`: only a `run --all`, a new failure's re-run or slow files are drained). So a daemon exits 3 s after its last session leaves (`departureGraceMs`, `lifecycle.ts:240`), or after 30 minutes of a session with no edit, wait or request (`daemon.unusedExitMinutes`), or at `squeal stop`, whatever its baseline still holds. *Read in source code.* The store keeps only the last 20 notes per worktree, so exit reasons are not countable over the window. The main checkout's last 5 exits (21:34Z to 21:54Z) were all "no session registered for 3 s after its last one ended". *Read from the store copy.*

**Class 2 and 3: the brief's other key candidates.** A Squeal release did not move key formats in the window: `KEY_FORMAT_VERSION` is 21 since 0.1.388 (2026-11-01), and 0.1.390 to 0.1.405 change nothing in `src/core/keys` (`git diff --stat`); 0.1.392 to 0.1.402 changed runner files, none of them an environment-hash input. *Read in source code.* The installed lockfile (`node_modules/.pnpm/lock.yaml`) has the same content in the 12 newest cezar worktrees, though each install rewrote it. *Read on disk.* Every live cezar daemon, Claude Code and Codex, runs Node 24.22.1, installed 2026-10-27. *Read from `/proc`.* So no lockfile, Node or release change is shown in the window; a per-daemon Node version is not stored, so it is not excluded. Of the commit and edit re-keys, the store cannot say for removed worktrees whether the change came while the predecessor ran (it would have queued them) or while no daemon ran. In the worktrees whose revisions survive (14.7% of all restart seconds), these re-keys hold 11,288 s: the changes came only by revisions a live daemon made (watch, interval) in 6,934 s (61%), only by the start revision in 3,994 s (35%), by both in 360 s. *Read from the store copy; a small sample of 60 baselines.*

**"No local revision since" (3.2%, 10,530 s of it server).** The restart ran at the same revision as the predecessor's last result or start, so no file Squeal hashes changed in the worktree. Three causes fit, and the store does not say which one per case:

- *Another worktree grew the shared observed set.* Spec 001 D3 as amended (task 001-132) keeps one observed set per project, shared by all worktrees, merged and never pruned (`observedMetaKey`, `keys/observed.ts`). cezar's `observed.server` is 1.66 MB. Fixture E8: worktree A's run read `data/extra.json` (behind a flag file only A has); worktree B, unchanged, then re-ran `r.test.ts` at its next start, because the file it never reads joined its key. *Verified by experiment.* `observe.runtimeInputs` is on by default: a configuration choice.
- *A different Node version.* `nodeVersion` is in the environment hash (`environment-hash.ts:53`). Fixture E3: a daemon on Node 22.19.0 re-ran all 8 files; a patch change (24.22.1 to 24.21.0) did too; going back to a version run before re-ran 0. *Verified by experiment.* No such change is shown in cezar's window (above).
- *A file new to the stat cache.* A tracked or untracked file the cache did not hold is hashed at start "without a revision" (`keying.ts`, `bootstrap`). *Read in source code; not reproduced.*

e2e adds a configured re-key in every class: its runtime file `.ai/qa/test-env.json` (cezar's `runtimeFiles`) enters each e2e key. *Read in config.*

## 2. The defect share

No restart ran a file whose key held a stored result. Evidence:

- Fixture E0 to E2 (8 files, `lookup-then-run-missing`): start, let the baseline end, stop, start again. With no change: listed 0, ran 0, twice. After `git commit --allow-empty`: 0. After `touch` of every source and test file: 0. *Verified by experiment.*
- In the store, a restart that misses at a key another row holds is not directly visible: `results` keeps one row per check and key (`INSERT OR REPLACE`), so the restart's own row replaces any earlier one. The only footprint, "own result gone", is 119 s (0.03%), and it also holds results discarded at the end of a run. *Read from the store copy and in source code.* This is the one place a defect could hide; it bounds one at 0.03%.

The double run in fixture E8 step 1 (one file listed, run twice at one start, the first run storing nothing) is a single event, not counted. *Verified by experiment, cause not determined.*

## 3. What settings change

| Setting | Restart-baseline seconds it removes | Cost |
|---|---|---|
| `daemon.idleExitMinutes: 240` | about 0 of the backlog. It times out only a daemon that never had a session, and bounds the drain of slow files after the last session left (`lifecycle.ts`, `departure`). cezar's daemons are started by session hooks. The drain could finish more e2e files (class 1 e2e: 52,653 s), but it runs them either way, so CPU does not fall | up to 4 h of a daemon after its session ends: 620 MiB quiet, up to 1,800 MiB (`daemon-memory.md` finding 1, `daemon-scope.md`) |
| A longer daemon life in general (departure grace, `daemon.unusedExitMinutes`) | at most the 1.2% cut in flight (4,494 s). Class 1 is not-yet-run work, and commit and edit re-keys run as catch-up in a live daemon too. A live daemon can cost more: it runs every intermediate key, a restart only the last | memory as above, per worktree with a parked session |
| `baseline.onStart: "lookup-only"` (Squeal's default since 0.1.284) | at least class 1 (50.9%, 189,944 s): a lookup-only predecessor queues no misses, so nothing is handed over. At most 99.7%. What still runs is what the predecessor queued for its own edits and pulls (handed over, 011-33) and, at a start that resumes a rest (`daemon.unusedExitMinutes` exit), the reach of what changed while no daemon ran (011-91). If the surviving worktrees' 61% held for all 170,780 s of commit and edit re-keys, about 105,000 s (28%) would still run: about 70% removed. Fixture E9: after a commit while down, lookup-only listed 1 and ran 0; `lookup-then-run-missing` ran it | a file's first verdict waits for an edit that re-keys it, or a request. The restart baselines stored a FAIL in 18 of 23,861 file runs (265 s, 8 worktrees, `verdicts.cjs`) |

*Bounds inferred from the classes above and the source. The 99.7% bound assumes every re-key came while no daemon ran and no start resumed a rest; the 70% estimate rests on 60 baselines.*

## Recommendation for Squeal

None as design. For the coordinator's next step, the numbers say: the restart cost is cezar's choice of `baseline.onStart: "lookup-then-run-missing"` together with daemons that stop at each session end. Half of it is one baseline finished across several daemons, not repeated work. A longer idle exit would not change it. Lookup-only would remove at least half, about 70% by a small sample, at the cost of 18 early FAIL verdicts in 72 h. The shared observed set re-keys unchanged worktrees; its share is at most 3.2% here.

**Why cezar runs `lookup-then-run-missing`** (added by the coordinator, 2026-11-05). The human chose it on 2026-10-27 (cezarion PR #1952, task "Update squeal config to start with run missing, not lookup only"), and gave the reason the same day in Squeal task 52adfef4: "new work trees were basically just sitting idle on stale results, and I think that was causing the session to have to wait for them to catch up later." That task first proposed `lookup-only` for cezar and withdrew it; its research (`research/startup-inheritance-2026-10-27.md`, `research/completed-donor-inheritance.md`) found no inheritance bug: same-content recipients inherit with zero runs, and the misses it traced came from a different install (a main checkout whose `node_modules` lagged a pulled lockfile, a mixed npm/pnpm worktree). Read with section 1: class 1 (50.9%) is that requested catch-up, finished across several daemons, not repeated work; only 1.2% repeats. `lookup-only` would remove the cost by bringing back the wait the human chose to avoid.

## Open questions

1. Which of the three "no local revision" causes each of the 626 file runs had: not determined, because the store keeps no dated history of observed sets, Node versions or cache seeds.
2. For removed worktrees, whether a commit or edit re-key came while the predecessor ran or while no daemon ran: not determined, because removal drops revisions.
3. Exit reasons over the window: not determined, because notes keep the last 20 per worktree.
4. The double run in fixture E8 step 1.

## Sources

- Store copy: `~/projects/cezar/.git/squeal/store.sqlite` with `-wal` and `-shm`, copied 2026-11-05T21:56Z; run logs `runs/<id>/report.json` read in place. `~/projects/cezar/squeal.config.json`, read 2026-11-05.
- Source at squeal `04d9d5e2d`: `src/core/scheduler/bootstrap.ts` (`baseline`, misses, `handover`), `src/core/scheduler/keying.ts:178-235` (`bootstrap`), `src/core/scheduler/scheduler.ts:782-862` (`inUse`, `owedWork`), `src/core/daemon/lifecycle.ts:185-345, 461` (exits, `drainable`), `src/core/presence/facts.ts:125` (`resumesRest`), `src/core/keys/environment-hash.ts`, `src/core/keys/environment.ts:43, 134-180`, `src/core/keys/observed.ts:16-25`, `src/core/keys/key-format.ts`, `src/core/types/policy.ts:359-379`, `src/core/store/repos/results.ts:115-137`.
- Release tags `squeal--v0.1.390` to `squeal--v0.1.405`; `git diff --stat` of key and runner paths between them.
- Earlier findings: `019-run-triggers/research/load-split.md` sections 1 and 5; `research/daemon-memory.md` finding 1.
- Probes: `probes/restart-baseline/` (README lists each script and the commands).
