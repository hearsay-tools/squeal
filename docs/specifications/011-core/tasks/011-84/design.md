# 011-84: departed and unused daemons end sooner, a design for the human

Board row 011-84, a docs-only design draft (brief `tasks/011-84/brief.md`). The human asked for it on 2026-10-21, from the host-load review. Nothing here is in `spec.md` until the human accepts it. On acceptance, the drafts in section 5 go into 011 C9 and C4, two sentences go into 004 D2 through 004's `status.md`, `status.md` gets a dated line, and the board numbers the code rows of section 6.

Sources: 011 C4 ("Explicit checkpoints"), C9 and C10, with `status.md`; 004 D2 (task 004-60); `research/daemon-scope.md` 3; `research/daemon-memory.md` 3b and 4; `../014-ps/research/should-not-be-up.md` 2 and its `scan-20261021T0822Z.txt`; `src/core/daemon/lifecycle.ts`, `daemon.ts`, `slow-instance.ts`, `policy.ts`; `src/core/scheduler/scheduler.ts`, `slow-tier.ts`, `bootstrap.ts`, `handover.ts`, `queue.ts`; `src/core/slow/slot.ts`; `src/core/capacity/share.ts`; `src/core/delivery/liveness.ts`; `tasks/011-83/design.md` sections 2 and 7. Source at `b3c124871` (0.1.245 code).

Probes, all under `probes/` (its `README.md` lists each script and output): `drains.py` reads the drains every worktree's notes record, with their runs and results, from the cezar and squeal stores; `drains-0822.py` reads the runs and results of the four drains 014-03 saw at 08:22Z; `quiet.py` samples `squeal ps --json` and the stores 12 times in 20 minutes; `ps-20261021T2048Z.json` is one raw `squeal ps --json`. The stores were opened `mode=ro`. `squeal ps --json`, which the brief allows, is the only command that reached a live daemon. No store was written, no process signalled, no clone made, no daemon started and no test run. The one-minute load is beside every timing. Times are UTC.

Evidence tags follow `docs/process.md`: `verified by experiment`, `read in official docs`, `read in source code`, `inferred`.

## Summary

- **A drain runs the backlog of a session that is gone.** When the last session leaves with slow files or owed work pending, the daemon drains them for up to `daemon.idleExitMinutes` (004-29, 001-219). Its slow lane waits for its own fast backlog (004-60), so the drain runs all of the backlog first. A departure with no slow file exits at the 3 s grace and leaves the same backlog queued. *Read in source code.*
- **What drains did.** The cezar store records 28 drains with a known window, 2026-10-14 to 10-21: 780 minutes, 10 of them ended at the 60-minute bound with slow files still pending, and 447 slow runs (11,030 s) on the user's one slow permit (cezar sets `slow.maxParallel` 1). The 18 since 2026-10-20 stored 789 results, and no later lookup read one of them. The four drains of 08:22Z held 3,976 MiB, 1,610 MiB of test processes and 1 to 2 pool permits (014-03). Three of them ran 17 fast runs (256 files, 4,561 s, 4 timed out) and 10 slow runs, and every one of their 4,260 results was read 11 to 13 h later, at keys that other worktrees hold now. At 20:55Z and 20:59Z the cezar main checkout's drain held the one slow permit while a live Codex session's daemon waited for it. *Verified by experiment.*
- **Unused.** Any work queued or running is use (001-415), so the daemon of a quiet session never stops while a backlog or a slow file waits for a permit. At 09:28Z (011-52) four daemons had a session and no edit for 74 to 148 minutes: one ran a slow file and three waited for the slow permit, 4,783 MiB in all. Live at 20:53 to 21:13Z, one such daemon (462 to 1,058 MiB) took turns at the slow permit with 78 to 81 slow files left: a rule that counted only waiting as no use would not have stopped it. *Verified by experiment.*
- **Coming back.** Under `lookup-only`, a daemon's start queues only its predecessor's queued work (011-33). The edit that wakes a resting daemon is in its start revision, which nothing queues (`bootstrap.ts:214`), so that edit gets no verdict: 3 of 3 in 011-53. *Read in source code; verified by experiment (011-53).*
- **Recommendation, four decisions** (next section): a drain runs only its session's own work; a draining daemon takes the slow permit only when no other worktree waits for it; the backlog is no use; a start after a rest queues the changes it finds as a running daemon would, whatever `baseline.onStart`.

## Decisions for the human

| # | Question | Options | Recommendation |
| --- | --- | --- | --- |
| Q1 | The drain (brief question 1). | (a) Stop at the running tier: a departure exits at the grace; the tier in flight stores; the queue stays for the next daemon (011-33) and the `run --all` stays owed (001-219). (b) The session's own work: the drain runs its edits' work, promoted files, slow files, the open `run --all` and the re-runs; the backlog (a baseline's misses, catch-up, an environment's re-key, a predecessor's handed-over files) pauses in the queue, and the slow lane does not wait for it. (c) As today. | (b). It keeps the human's 004-29 and 001-219 drains and removes what 004-60 added to them: a drain runs no backlog, as a departure with no slow file runs none today. (a) frees more and ends both drains. Section 1. |
| Q2 | A drain beside live sessions (brief question 1). | (a) A draining daemon leaves no waiter mark and takes no slow permit while another worktree's mark is fresh. (b) As today: waiting worktrees take turns (004 D2). | (a). The permit is the user's (one on cezar), and a departed session waits for nothing. The pool already serves fast-lane waiters before a slow-only demand (004-61), so no pool rule is needed. Section 1.5. |
| Q3 | Unused (brief question 2). | (a) As today: any work queued or running is use. (b) Waiting is no use: a tier running is use; work that waits for a permit, the slow slot, the load or the fast backlog is not. (c) The backlog is no use: an edit, a request, a wait and the work they caused, queued or running, are use; the backlog and slow files that no request asked for are not, waiting or running. | (c). The next hook boundary starts the daemon again and it queues the backlog again (011-33). (b) misses a daemon that gets a turn of the slot every few files. Section 2. |
| Q4 | Coming back (brief question 3). | (a) A start after a rest resumes: whatever `baseline.onStart`, it queues what its start revision and each unrefined revision reached, as a running daemon queues a revision (C4 step 4); a file it hashes for the first time counts as added. (b) As (a), edits only: catch-up found after a rest stays as the policy leaves it. (c) Every start under `lookup-only` queues its start revision's edits. | (a). A rest is quiet (C9), so after it the daemon does what it would have done had it stayed. (c) reverses the human's 011-30 ruling and the `lookup-only` hold for stops and session starts. Section 3. |

## 1. The drain (brief question 1)

### 1.1 What a drain runs today

- The departure check runs every 250 ms. When the 3 s grace ends, `drainable` (`lifecycle.ts:374`) asks for slow files pending (`Scheduler.slowPending`) and owed work (`Scheduler.owedWork`: an open explicit `run --all` checkpoint, a new failure's re-run). With none, the daemon exits `sessions-gone`: the tier in flight stores, and the queue stays in the rows for the next daemon (C4, 011-33). With some, it drains until none is pending or `daemon.idleExitMinutes` after the departure. *Read in source code.*
- The scheduler is not told of the departure. It runs its queue in its usual order. A slow tier starts only when `#fastFirst` (`slow-tier.ts:233`) is false: no edit's work, and unless a `run --slow` asked, no fast work at all (`#fastIdle`, `scheduler.ts:943`). So a drain's slow files wait for every fast backlog tier: a baseline's misses (default policy), catch-up after a pull, an environment's re-key, a predecessor's handed-over files. *Read in source code.*
- A drain with slow files holds two Vitest instances: the fast one, and the slow lane's own, created for a slow pass and closed when the pass drains (`slow-instance.ts`, 004 D2). Under Q1 (b) the fast one idles during the drain. Closing it would give nothing back: 011-53 found that a closed and reopened instance leaks (`research/daemon-memory.md` 3). *Read in source code.*
- So whether a departure runs the backlog depends on whether a slow file is queued. 004-29 (2026-10-09) came before 004-60 (2026-10-14), and 004-60 was written for a live daemon's warm-up, "so a warm-up's slow files never contend with its fast ones" (`slow-tier.ts:226` to `:232`; board row 004-60: cezar's browser files failed beside its unit baseline), not for a drain. *Read in source code.*

### 1.2 Measured

| Source | Drains | Time | Runs | Results a later lookup read |
| --- | --- | --- | --- | --- |
| Cezar store notes, 2026-10-14 to 10-21 (`drains.py`, load 34.4) | 28 with a known window (30 with notes) | 780 min. Of the 30: 10 ended at the 60-min bound with slow files pending, 5 drained, 13 by a session's registration (11 in the main checkout; inferred from a second start note), 2 by a signal | 447 slow (11,030 s), 42 fast (1,888 s) | 0 of 4,345. Since 10-20, the current key format: 0 of 789, in 18 drains |
| The four drains of 08:22Z (`drains-0822.py`, load 19.0) | 4 | 10 to 42 min old at the scan; each window 60 min from its departure | 17 fast (256 files, 4,561 s, 4 timed out), 10 slow (877 s); one ran nothing | 4,260 of 4,260, 11 to 13 h later (median gaps 651 to 762 min), at keys 1 to 5 other worktrees hold now |
| Live, the cezar main checkout (`quiet.py`, 12 samples, 20:53 to 21:13Z, load 19.0 to 51.5) | 1, with slow files and a `run --all` pending | from 20:48Z; 58 to 60 min stayed left in every sample, since short sessions registered and left (*inferred*) | a slow file in 7 of 12 samples | not measured |

- **Memory and permits.** The four drains of 08:22Z held 3,976 MiB (24% of daemon memory), 1,610 MiB of test processes, and 1 to 2 of the 12 pool permits (014-03 2). The live drain held 438 to 606 MiB, up to 1,384 MiB of test processes, and in 7 of 12 samples the one slow permit. At 20:55Z and 20:59Z the daemon of a registered Codex session (`12bfdcf5`) waited for that permit (`waiting for slot`). *Verified by experiment.*
- **What "read later" counts.** A lookup that hits a result moves its `last_used_at` (`results.ts:54`). A result whose `last_used_at` is more than 60 s after its `recorded_at` was read by a daemon of some worktree after it was stored. A `squeal status` read does not move it, so a human or a coordinator who reads a worker's status is not counted. *Read in source code.*
- **Reading.** In 18 drains since 10-20, no later daemon read a drained result. In 3 drains of one morning, later daemons read all of them, about 12 h later, at keys held now by worktrees at the same files (*inferred* from the gaps and the holders). So the value of a drained result depends on whether another worktree reaches its key later, not on its lane. No revision followed a drain in the drained worktree, in any of the 28.

### 1.3 What a later session loses with each option

| Option | Frees | A later session in the drained worktree | Another worktree at the same keys |
| --- | --- | --- | --- |
| (a) stop at the running tier | The whole drain: on 08:22Z, 3,976 MiB, 1,610 MiB of tests and 1 to 2 permits for the 10 to 60 min left; in the store, 780 min of daemons | Its daemon queues the slow files, the `run --all` and the re-runs again at start (011-33, 001-219). A resumed worker waits for them, the slow files one per permit | Runs what it needs itself. Under `lookup-only` it reads those files stale until its own `run --all` or edit runs them. At 08:22Z: the 4,260 results |
| (b) the session's own work | The backlog's runs and the time the slow files waited for them: at 08:22Z, 17 fast runs, 4,561 s, 4 timeouts and the permits they held. The drain ends when the slow files and the owed work have run | Finds the backlog still queued; its daemon queues it again at start (011-33) | As (a), for the backlog's results only: 4,056 of the 4,260 at 08:22Z |
| (c) as today | Nothing | Nothing | Nothing |

Where a drain is mostly slow files, (b) saves little: in the 28 store drains, 42 of the 489 runs were fast. There a drain ends at the bound (10 of 28), and Q2 is what spares live sessions.

### 1.4 Recommendation: (b)

A drain runs the work its session caused or asked for, which is what 004-29 and 001-219 asked. The backlog waits for the next daemon, as it does after a departure with no slow file. When the drain starts, the scheduler pauses the backlog: a tier takes only an edit's work, promoted files, the open explicit checkpoint's files and the re-runs, and the slow lane's "no fast work" counts only those. The paused files stay `queued` in their rows, so the next daemon in the worktree queues them again (011-33). A session that registers during the drain ends the pause.

(a) is the larger saving and the simpler rule. It ends the drains the human set on 2026-10-09 (004-29) and 2026-10-10 (001-219), so it is the human's call. Its case is section 1.2: the 18 drains since 10-20 stored nothing a later daemon read, and a resumed session's own daemon queues the same work again.

### 1.5 A drain beside live sessions (Q2)

The slow permits are per user, `slow.maxParallel` of them (`slot.ts:79`; 4 by default, 1 on cezar). Worktrees that wait take turns: a tier that took the slot last skips its next turn while another worktree's waiter mark is fresh (`slow-tier.ts:199`; 004 D2, from 004's `lessons.md` defect 2). A draining daemon is one of them, so a live session's slow files wait behind a departed one's every other file. That is what the live samples show. Under Q1 (b) a drain's slow files start sooner, so this contention grows unless the drain yields.

Under (a), a draining daemon writes no waiter mark and takes no permit while another worktree's mark is younger than `SLOT_WAITER_FRESH_MS` (30 s). Two draining daemons do not yield to each other, since neither marks. A live waiter refreshes its mark at each recheck (`SLOW_RECHECK_MS`, 15 s; 2 s under 011-83 Q1 (a)), so its mark stays fresh while it waits. The pool needs no such rule: it serves every fast-lane waiter before a slow-only demand (004-61, `share.ts` `Demand.slow`), and under Q1 (b) a drain has no backlog tier. The cost: on a busy host a drain's slow files can wait out the bound and stay queued for the next daemon.

## 2. Unused (brief question 2)

### 2.1 What counts as use today

At each check, a new revision or `Scheduler.busy()` (`scheduler.ts:501`: a tier in flight, queued work not stalled, or a slow file pending) moves the last use (`lifecycle.ts:243`). A request or a wait moves it in `daemon.ts` (`onActivity`). After `daemon.unusedExitMinutes` (30) with a consumer registered, the daemon marks the rest and stops, reason `idle`. So a daemon whose backlog or slow files wait for a permit, the slot, the load guard or its own fast backlog is in use for as long as they wait. The idle collection (C9, 011-69) already counts work queued and waiting for a slot or for load as idle. *Read in source code.*

A waiting daemon holds no permit, but its pool mark is a demand: `fairShares` (`share.ts`) divides the slots among the marked daemons, so each quiet waiter lowers every live daemon's share. Under 011-83 Q1 (a) no daemon runs a backlog worker without a permit, so more daemons wait. *Read in source code; inferred.*

### 2.2 Measured

| Population | A session, no edit for 30+ min | Their work | Memory |
| --- | --- | --- | --- |
| 09:28Z (011-52 `estimate.txt`, load 26.7) | 4 daemons, 74 to 148 min | 1 ran a slow file (1,702 MiB); 3 waited for the slow permit (1,388, 1,012 and 681 MiB) | 4,783 MiB; test processes not split per daemon |
| 20:53 to 21:13Z (`quiet.py`, 12 samples, load 19.0 to 51.5; 12 to 15 daemons with a session in each) | 1 daemon (`df65774b`, Claude Code, a cezar worktree), 34 to 53 min | a 4-file fast backlog tier on its free worker until about 21:01Z; then 78 to 81 slow files, waiting for the slow permit in 6 samples and running one at 21:04Z | 462 to 1,058 MiB, and 0 to 1,052 MiB of test processes |

"Quiet" in `quiet.py` is the time since the last revision or a consumer's last `seen` or `delivered` in the store. A socket request, such as a status call, is not in the store, so `quiet.py` can call a daemon quiet that was in use: a squeal daemon with nothing queued read 44 min quiet at 20:59Z and was still up. *Inferred.*

### 2.3 What each option frees

| Option | Stops | 09:28Z | Live |
| --- | --- | --- | --- |
| (a) as today | a quiet daemon with nothing queued or running | 0 of the 4 | 0 (one squeal daemon read quiet with nothing queued in one sample and stayed up: a request the store does not show) |
| (b) waiting is no use | also one whose work waited, with no tier run, for the whole bound | at most the 3 that waited (3,081 MiB), and only if none got a turn in 30 min | 0: `df65774b` ran a slow file at 21:04Z, so it stayed in use |
| (c) the backlog is no use | also one that runs backlog or slow files no request asked for | all 4: 4,783 MiB, their test processes, and the slow permit the one held | `df65774b` in all 12 samples: 462 to 1,058 MiB, up to 1,052 MiB of tests, and the slow permit it took at 21:04Z |

- **Permits.** Under (b) a stopped daemon held no permit, but its demand leaves the pool's shares. Under (c) a stopped daemon also frees the permits and the slow permit its running backlog held, once its tier in flight has stored.
- **Why (b) stops few.** Waiting worktrees take turns at the slot (section 1.5). A waiter with files left gets a turn every few files, and each turn is a tier run, so it can stay in use indefinitely. *Inferred from the turn rule; seen live with `df65774b`.*
- **What the session loses under (c).** The backlog no one waits for stops while the session is quiet. At the session's next hook boundary, any tool call and not only an edit, the daemon starts again (the rest, C9): on cezar 16 to 25 s pass before it takes an edit (011-53 3b). It queues the stopped backlog again (011-33), and under Q4 the edit that woke it. Catch-up after a pull has the 30 min after the session's last activity to run: in 011-22's replay of cezar's 795-file case, the rule now in force ran its Vitest files in 857 s (`research/catch-up.md`), so most catch-up ends within the bound. *Inferred.*

### 2.4 Recommendation: (c)

Use becomes an edit, a request, a wait, and the work they caused while it is queued or running: an edit's work, a promoted file (C15), an open explicit checkpoint, an open `run --slow` request, a new failure's re-run. The backlog is no use, waiting or running, and slow files no request asked for are backlog. A drain still runs slow files (Q1) because a departed session does not come back to its daemon, and 004-29 made the drain for that case; a quiet session's next hook boundary starts its daemon again, which queues them again. The stop lets the tier in flight store, as any exit does, and its note names the files it leaves queued. The bound and its setting do not change (`daemon.unusedExitMinutes`, 30, `policy.ts:94`). Q4 must land first: (c) makes rests common, and under `lookup-only` each rest would otherwise lose the edit that ends it.

## 3. Coming back (brief question 3)

### 3.1 Why the edit is lost today

- The unused stop records the rest (`daemon-rest:<wt>`, `{ at }`) and clears its record (C9). The next hook boundary that reads the stale heartbeat spawns a daemon and adds `spawnedAt` (`liveness.ts:249`). *Read in source code.*
- That boundary is often the edit's own. The edit is on disk before the new daemon's watcher exists, so the start scan finds it in the `start` revision (`keying.ts:176`). A file created during the rest is hashed without a revision (`keying.ts` `#seed`), so it is a never-run file. *Read in source code.*
- `bootstrap` (`bootstrap.ts:187` to `:215`) classifies each unseen revision's reach as edits or catch-up (011-22, 011-25). Under `lookup-only` it skips the cut (`:203`) and queues only a predecessor's queued files (`:214`). The edited file is a miss no daemon queued, so it stays stale. 011-53 saw it 3 of 3: "nothing queued it (the baseline is lookup-only)" (`research/daemon-memory.md` 3b, a start after an exit). *Read in source code; verified by experiment (011-53).*
- C4 says so on purpose (row 011-30, Q3 (a) and Q5 (a)): "The misses no daemon queued ... stay as the policy leaves them." A rest is the case that sentence did not cover: the daemon stopped by its own rule while its session stays, and C9 says a rest is quiet.

### 3.2 The rule (draft in section 5)

A daemon resumes a rest when, at its start, the worktree's rest mark is later than every heartbeat its row records, the test `restState` makes (`liveness.ts:260`). Whatever `baseline.onStart`, such a daemon:

1. queues the files that its start revision and each unrefined revision reached, as C4 step 4 classifies a revision: the edit cut in the first group, the rest of a small revision and all of a revision of 10 or more keyed paths as catch-up;
2. counts a file it hashes for the first time as added by its start revision;
3. hands over its predecessor's queued work, as any start does (011-33);
4. leaves every other miss as the policy leaves it.

Other starts do not change: a session's first start, a start after a departure, a step-down's successor, a start after `squeal stop`. A rest followed by `squeal stop` and `squeal start` still resumes, since no heartbeat came after the rest; that start queues only what changed while no daemon ran, which is harmless.

### 3.3 Its tests

- **Red first**, `test/daemon/unused-stop.test.ts` (a real daemon, the file's existing shape): `baseline.onStart: "lookup-only"`; a consumer registers and the daemon stops unused; a test file is edited; the next tool boundary starts a daemon; `squeal status --wait 60000 <file>` returns the file's own verdict at the new revision. Today it returns "nothing queued it (the baseline is lookup-only)".
- The same with a test file created during the rest: it runs.
- `test/scheduler/rest-resume.test.ts` (new, beside `handover-queued.test.ts`): a bootstrap that resumes a rest under `lookup-only` puts an unseen revision's namesake in the first group and a 12-path revision's files in catch-up. Without the resume it queues nothing, which pins the `lookup-only` hold.
- A start after `squeal stop`, with no rest, under `lookup-only` still leaves an edited file stale (011-30 Q3 (a), pinned).

## 4. Rejected options

- **A shorter drain bound** (a `daemon.drainMinutes` setting). It is a new setting, the bound already ends 10 of the 28 drains, and with Q2 a drain no longer delays a live session, so its length costs only memory, which Q1 (a) addresses.
- **A drain that yields pool permits too.** The pool already serves fast-lane waiters before slow-only demands (004-61), and under Q1 (b) a drain runs only its session's fast work. A pool rule would be 011-83's seam (`marks.ts`, `share.ts`).
- **Q3 (b), waiting is no use.** It misses the daemons that take turns at the slot (section 2.3).
- **Q4 (c), every start under `lookup-only` queues its start revision's edits.** It reverses the human's 011-30 ruling for stops and the `lookup-only` hold (2026-10-20) for session starts. Neither is this row's question.
- **Q4 (d), the spawning hook names the edited path** (`squeal daemon --edited <path>`). A shell edit has no path, every harness would need a mapping, and the daemon finds the changes itself.
- **An unused stop that cancels the backlog tier in flight.** A stop cancels (C9, 001-367) because its successor may read another key format. An unused stop's successor is the same release, so the tier's results are kept; the tier ends within `max(120 s, its longest file)` of estimated time (C4 step 5).
- **Closing the Vitest instance instead of exiting.** 011-53 found it gives no memory back and leaks an instance per cycle.

## 5. Spec text drafts

**011 C9, the drain** (replaces "When the 3 s end with slow files pending, ... since a fast tier is never queued behind a slow file (spec 004 D2)."):

> When the 3 s end with slow files pending, queued or running (spec 004 D2; the end of every `codex exec` and `claude -p` session leaves them so, `lessons.md` of 004, defect 1), or with work owed (an open explicit checkpoint, a new failure's re-run; task 001-219), the daemon drains them before it exits (task 004-29, the human's rules, board row 001-162): one note says the drain started, and the daemon exits with reason `sessions-gone` once none of them is pending (one note: they have run) or `daemon.idleExitMinutes` after the departure (one note naming the bound), when no further file starts and the one in flight stores, as at any exit. A drain runs only its session's work: an edit's work, promoted files, the slow files, the open explicit checkpoint's files and the re-runs. The rest of the queue (a baseline's misses, catch-up, an environment's re-key, a predecessor's handed-over files) stays queued for the next daemon (C4), and the slow tier does not wait for it (004 D2). A draining daemon writes no slow-slot waiter mark and takes no slow permit while another worktree's mark is fresh (004 D2) (amended on the human's acceptance, row 011-84: on 2026-10-21 three drains ran 17 fast backlog runs, 4,561 s, before their slow files, and a drain held cezar's one slow permit while a live session's daemon waited for it). The drain is no activity for the idle period. A session that registers in that worktree during the drain (after `/clear`, `/new`, a reset, or a reopened Codex or Claude) cancels the exit and ends the pause: the daemon serves on, its queue in its usual order, and exits by these rules once that session is gone; the session's fast work keeps priority over the drain, since a fast tier is never queued behind a slow file (spec 004 D2).

**011 C9, unused** (replaces the sentence that starts "\"Unused\" (task 001-415, the human, 2026-10-15)" up to "the sessions still registered."):

> "Unused" (task 001-415, the human, 2026-10-15; amended on the human's acceptance, row 011-84): a daemon whose worktree has a consumer registered, and that saw no edit (a new revision), no wait (`status --wait`'s sync), no request, and no work they caused queued or running (an edit's work, a promoted file, an open explicit checkpoint, an open `run --slow` request, a new failure's re-run) for `daemon.unusedExitMinutes` (default 30 minutes, project policy only, as `daemon.idleExitMinutes`), stops with reason `idle` and one note naming the bound, the sessions still registered and the test files it leaves queued. The rest of its queue (a baseline's misses, catch-up, an environment's re-key, a predecessor's handed-over files, slow files that no request asked for) is no use, queued or running: a tier in flight stores, as at any exit, and the next daemon queues the rest again (C4). On 2026-10-21 at 09:28Z four daemons with a session and no edit for 74 to 148 minutes held 4,783 MiB; one ran a slow file and three waited for the slow permit.

**011 C9, the rest** (added after "which serves the consumers still registered."):

> That daemon resumes the rest: when, at its start, the rest mark is later than every heartbeat its worktree's row records, it queues the files its start revision and each unrefined revision reached, whatever `baseline.onStart`, as C4 step 4 classifies a revision, and counts a file it hashes for the first time as added by its start revision. So the edit that wakes it runs as it would have run had the daemon stayed (row 011-84; `research/daemon-memory.md` 3b: under `lookup-only` 3 of 3 such edits were never run). Its other misses stay as the policy leaves them, and other starts are unchanged (C4).

**011 C4, "Explicit checkpoints"** (the last sentence gains a clause): "The misses no daemon queued, such as every check a key-format change re-keys, stay as the policy leaves them, except at a start that resumes a rest (C9) (amended 2026-10-20 ...)."

**004 D2** (two sentences after the 004-60 sentence, through 004's `status.md`): "During a departure drain (011 C9) it waits only for the fast work the drain runs, not for the backlog the drain leaves queued. A draining daemon leaves no waiter mark and takes no permit while another worktree's mark is fresh, so a live session's slow files never wait behind a departed one's (row 011-84)."

## 6. Code rows, in order

1. **011-84a: a start after a rest resumes** (Q4 (a)). Seam: `src/core/scheduler/bootstrap.ts`, the `lookupOnly` branch (`:187` to `:215`): with a resume, the cut is computed, each unseen revision's reach is queued, and the paths `keys.bootstrap` hashed for the first time count as added. The daemon reads the rest before its bootstrap with `restState`'s test, exported as a read from `src/core/delivery/liveness.ts`, and passes it as a start option. Owned: those two files, `src/core/daemon/daemon.ts` (the read), `src/core/scheduler/options.ts`, `src/core/scheduler/keying.ts` (return the first-hashed paths), `test/scheduler/rest-resume.test.ts` (new), `test/daemon/unused-stop.test.ts`. Red first: the tests of 3.3. Type change, additive: `SchedulerOptions.resumesRest?: boolean`.
2. **011-84b: the backlog is no use** (Q3 (c)), after 84a. Seam: `Scheduler.inUse()` replaces `busy()` (`scheduler.ts:501`, read only by the unused check): `#editPending()`, `owedWork()`, the slow tier's open request, a promoted file queued, or a tier of those in flight. `lifecycle.ts` `unused` reads `work.inUse`, and `unusedText` names the queued files. Owned: `scheduler.ts`, `slow-tier.ts` (a read of its open request), `src/core/daemon/lifecycle.ts`, `daemon.ts`, `test/daemon/unused-timers.test.ts`, a new `test/scheduler/in-use.test.ts`. Red first: with a session registered, 50 catch-up files waiting for a permit and no edit or request for the bound, the daemon stops `idle`, records the rest, and its note names 50 files queued; the same with a backlog tier running stops once that tier stored; an edit's tier running, an open `run --all`, an open `run --slow` and a `status --wait` each keep it; the next daemon queues the 50 again (011-33). Type change: `TimerContext.work` returns `inUse` for `busy`.
3. **011-84c: a drain runs its session's work and yields the slow permit** (Q1 (b), Q2 (a)). Seam: `Scheduler.pauseBacklog(on)`: `#fastIdle` (`scheduler.ts:943`) counts only the files that may run, and `Ledger.ordered` (`ledger.ts:164`) skips the paused ones, so `tiers.ts` does not change; `lifecycle.ts` sets it when the drain starts and `countPresence` clears it; in `slow-tier.ts`, `next()` takes no permit while draining and another worktree's mark is fresh, and `#waitAtSlot` writes no mark while draining. Owned: `scheduler.ts`, `ledger.ts`, `slow-tier.ts`, `lifecycle.ts`, `daemon.ts`, `test/daemon/drain-timers.test.ts`, `test/daemon/drain.test.ts`, `test/scheduler/slow-backlog.test.ts`, `test/scheduler/slow-slot-fair.test.ts`. Red first: a session leaves with 2 slow files and 40 catch-up files queued; the slow files start before any catch-up tier, the daemon exits once they ran, and the 40 rows stay `queued` (today the 40 run first); with an open `run --all`, its files run in the drain; a session that registers during the drain ends the pause; a draining daemon with a slow file and another worktree's fresh mark takes no permit and writes no mark, and takes one once the mark is 30 s old. Type changes, additive: `Scheduler.pauseBacklog`, `TimerContext.pauseBacklog?`. Under Q1 (a) instead, the row removes `drainable`, `Presence.draining` and the drain notes, and the drain tests become exit tests.

**Where these rows meet the other host-load designs.**

- **011-83** (`tasks/011-83/design.md` 2 and 7). Its row 83a changes the wait in `slow-tier.ts` (a waiter looks again every 2 s) and takes the free worker out of `pool.ts` and `share.ts`. Row 84c changes `slow-tier.ts` too, in `next()`'s slot step and `#waitAtSlot`, beside 83a's wait: the second to land rebases on the first, and their tests are separate. 83a's waiter mark is the pool's (`marks.ts`); 84c's yield reads the slow slot's marks (`slot.ts`), a different file. With 83a, more daemons wait for a permit; under 84b such a daemon of a quiet session stops at the bound, which is the intent. Row 84b's `inUse` counts no pool wait, so 83a's 2 s re-check is no use. Rows 83b and 83c share no file with these rows.
- **011-82** (its design is not on this base; the board row names `tiers.ts` and checkpoints). Row 84c keeps out of `tiers.ts` by filtering in `Ledger.ordered`. If 82 changes `ledger.ts` or a checkpoint's files, 84c's filter sits beside it. *Inferred.*
- **011-85** (keys, C3 and C11). No shared seam. 84a classifies by keyed paths; 85 changes which paths a lockfile or a config re-keys. They do not depend on each other.
- **014.** `daemon-used:<wt>` (014 D9) is written from the same last-use clock, so 84b changes what `squeal ps`'s past-unused reading means without a format change. 014-03's "draining" state still holds under 84c.

**Compatibility.** An older daemon that waits for the slot marks and takes turns as today; a newer draining daemon yields to its mark. No store row, key or format changes.

## 7. Limits

- The notes keep the newest 20 per worktree, and a removed worktree's notes go with it. So the 28 drains are those of worktrees still registered, and two older drains lost their start notes.
- "Read later" counts daemons' lookups only, not status reads. A result copied to a new key format keeps its old `last_used_at` (`results.ts`, `COPY_SET`), so a read through a format copy is missed.
- The 08:22Z windows are 60 min from the departure the scan read. For one of the four (`6a5e5c80`) the store keeps no run before 13:33Z, so its drain's runs are not known.
- The live samples are one evening, 20:53 to 21:13Z, a busy hour with few quiet sessions.
- The main checkout's drain read 58 to 60 min left for 20 minutes: short sessions registered and left, and each departure restarts the bound. Whether the bound should count from the first departure of a run of short sessions is not examined.
- Q4's loss after a rest was not run again on 0.1.245. 011-53 measured a start after an exit (3 of 3), and a start after a rest takes the same path (`bootstrap.ts:214`). *Read in source code.*
- The time a later session waits for slow files that Q1 (a) leaves queued is not measured.
- macOS is not examined.
