# 011-30: a daemon upgrade hands its work over, a design for the human

Board row 011-30, a docs-only design draft (brief `brief.md`). The human approved the row on 2026-10-20 (triage round 8, gh-47, "design row"). Code follows the human's acceptance and the landing of 011-22.

Nothing here is in `spec.md` until the human accepts it. On acceptance, the drafts in "Spec text" go into 011 C9, C4, C6 and C8, `status.md` gets a dated line, and the board numbers the code rows in section 5.

Sources: `research/issue-47.md` and its probes `research/probes/issue-47/` (runs 1 to 5, shipped 0.1.223 and 0.1.224 bundles); 011 C4, C6, C7, C8, C9 and `status.md`; board rows 001-436, 011-08 and gh-27; the source at `b7f20ee2` (main, 0.1.224) and at `origin/cand/0.1.225` (011-21 slice 2). One new probe, `probes/successor-cpu.sh`, output `probes/output-cpu-run1.txt` (section 2). Its one-minute load was 14.25 on 24 CPUs at the start. Other work on the host raised it to 24.79 by the +60 s sample. The probe used no full suite, no build and no daemon in this worktree.

Evidence tags follow `docs/process.md`: `verified by experiment`, `read in source code`, `inferred`.

## Summary

- **Step-down cancels.** A daemon asked to step down cancels its tiers in flight in every lane, as `squeal stop` has done since 0.1.200. It does not wait for them. The hook whose step-down was accepted also sends `stop`, so older daemons from 0.1.200 on cancel too. In the probe, `stop` sent to a stepping 0.1.223 daemon with a held tier had the successor answering 1.3 s later. Waiting for the tier gains almost nothing: every recent release changed the key format (14, 15, 16, 17 for 0.1.223 to 0.1.226), so the old tier's results land under keys its successor never looks up.
- **One successor per handoff.** The hook that wins the step-down claims the handoff in the store. Any other hook that reads that claim asks nothing and spawns nothing. Today six hooks spawned six successors. Waiting, they held 582 MB and used 12 CPU-seconds a minute together.
- **Pending work survives a restart.** The successor queues again whatever its predecessor left queued or running, whatever `baseline.onStart` says, in the group step 4 gives it. Today, under `lookup-only`, the start baseline treats that file as a cold-start miss and its commit drops the `queued` phase. That is why run 5's file went stale with no version change at all.
- **`start` and `status` say "handing over".** The test is one reading of the store: a daemon whose shutdown has begun and that still holds its lock is stopping, not down and not alive. `squeal start` is the recovery command: it finishes a stuck handoff by itself.
- **Four code rows, R1 to R4** (section 5). R1 and R3 can run side by side. R2 follows R1 and R4 follows R2. All four come after 011-22. The probe's shape becomes one regression test, which lands with R4.

## Decisions for the human

One recommendation each. The spec text below follows the recommendations.

**Decided 2026-10-20 by the human:** Q1 (a), Q3 (a), Q4 (a), Q5 (a); Q2 (a) as the coordinator's default, which the human did not change. The spec text below is in 011 C4, C8 and C9 (`status.md` 2026-10-20). R1 to R4 are board rows 011-31 to 011-34.

| # | Question | Options | Recommendation |
| --- | --- | --- | --- |
| Q1 | What does a step-down do with its tiers in flight? | (a) Cancel them as `stop` does. Results already stored stay, the rest is queued for the successor. (b) Wait with a bound B, then cancel. (c) Wait for them, and raise the successor's lock wait to at least `runner.timeoutMs`. | (a). It is bounded the way `stop` is: the successor answered 1.3 s after a `stop` in the probe. The old tier's results are almost always under a key format the successor does not read. Section 1. |
| Q2 | How do concurrent hooks converge on one successor? | (a) A handoff claim in the store's `meta`, written by the first hook in one write transaction. (b) The old daemon answers a repeated step-down with "already handed over". (c) Successors race for a second lock and the losers exit. | (a). It works from the hook side alone, so the first upgrade after the fix already spawns one successor. Status reads the same row (Q4). Section 2. |
| Q3 | How does the successor learn the pending work under `lookup-only`? | (a) Its baseline queues every row the predecessor left `queued` or `running`, whatever the policy. Each file goes in the group step 4 gives it for the revisions whose re-key moves are still open. (b) The old daemon writes an explicit handover list. (c) No change: status names the stale files, and `run --all` runs them. | (a). The rows and the moves are already in the store, written by every release since 001-258. A kill leaves them too. Cold-start misses stay as the policy leaves them. Section 3. |
| Q4 | What do `start` and `status` say during a handoff, and what is the recovery? | (a) Both read "stopping" from the store. A claim names the version that follows and its bound. Past the bound, status names `squeal start`, which finishes the handoff. (b) The same texts, with `squeal stop && squeal start` as the named recovery. (c) The stopping daemon keeps its heartbeat, so it reads "alive" until it exits. | (a). One command, idempotent, and it leaves no stopped mark (011-08). Section 4. |
| Q5 | Does the handover include a new failure's pending re-run (task 001-171) under `lookup-only`? Today it waits for a later daemon (review wave 13i, S1). | (a) Yes: a predecessor queued it, so it is handed over like any queued file. (b) No: it stays pending until a daemon with the default baseline starts. | (a). Q3's rule is "what a daemon already queued", and the re-run is that. Under (b), a `lookup-only` worktree never re-runs the failure. |

## 1. Step-down (brief question 1)

**Today.** The `step-down` handler calls `onStepDown`, which runs `#shutdown("superseded")` without `#cancelTiers()`. `#shutdown` stops the timers, writes the exit mark and the note, then awaits `loop.close()`, which waits for the tier in flight. Only after that does it close the socket and release the lock (`src/core/daemon/daemon.ts:582`, `:711`; `handlers.ts`, `step-down`). Only `onStop` cancels. *Read in source code.* In run 2 the 0.1.223 daemon wrote its note at 21:46:44.622Z and held the lock until the hold was released at 21:49:11. All six successors gave up at 21:48:44 to 21:48:48. *Verified by experiment* (`research/issue-47.md`, finding 1).

**Recommendation: cancel, as `stop` does.** Three reasons:

1. **It is bounded.** The cancel is the runner's own. Vitest's `cancelCurrentRun` is forced after 1 s, and its instance is dropped if its workers do not stop. node:test and pytest have every process carrying the daemon's mark stopped after `CANCEL_GRACE_MS` (2 s). In run 4, `stop` was sent to a stepping daemon whose Vitest tier was held. 1.3 s later the waiting successor was serving (21:51:56.558 to 21:51:57.857). *Verified by experiment.*
2. **What the old tier would store is almost never reusable.** `KEY_FORMAT_VERSION` is part of every environment hash and changes whenever the guarded sources change. That covers all of `src/` (`src/core/keys/key-format.ts`). It was 14 at 0.1.223, 15 at 0.1.224 and 16 at `cand/0.1.225`, and 001-365 plans 17 for 0.1.226. A result stored under the old format is never found by the successor's lookup. Only its duration survives, for ordering. *Read in source code.* Waiting for the tier therefore buys nothing at almost every upgrade. Only a release that leaves the guarded sources alone keeps those results, and the cancel loses at most the files still in progress.
3. **The edit loses little.** An edit's tier shares only with files of comparable last-known duration (C4, `SHARE_RATIO`), so a cancelled edit tier is usually one or a few short files. R3 puts them first in the successor's queue. The cases where the cancel matters most are the long ones: a new test file with no known duration, a file that hangs until `runner.timeoutMs` (600 s on cezar), or the probe's held file. In those cases waiting is what breaks the handoff. *Inferred.*

**What a cancelled tier keeps and re-queues.** This is unchanged from `stop` (C9 as amended for 001-367, C4 step 5). Files whose module ended before the cancel keep their results, under the stability check and the completion barrier. The rest go back to the queue uncounted (`unfinishedFiles`, `src/core/scheduler/scheduler.ts:650`), still forced when they were. Their rows read `queued` in the cancelled tier's record. No run, crash or timeout is stored under a key. The slow tier is retired at close (004 D8), and the successor decides it again. An explicit `run --all` checkpoint left open is owed to the next daemon (`checkpoints.owe()`), as today. *Read in source code.*

**Older daemons.** The hook whose step-down was accepted also sends `stop`. Since 0.1.200 (`0dd072ca`, 001-367) a `stop` cancels the tiers in flight under a shutdown already begun. `#shutdown` is one promise, so the stop's shutdown neither writes a second note nor runs twice. Run 4 shows exactly this sequence. The stopped mark is written only by the `squeal stop` CLI (`src/cli/stopped-mark.ts`), never by the daemon's `stop` handler, so the hook's `stop` leaves no mark and the successor is not held off (011-08). Step-down plus `stop` is still at most two round trips of the 100 ms budget, the C8 limit. A daemon from before 0.1.200 still finishes its tier. That is accepted: it is 25 releases old, and Q4's text and `squeal start` cover it. *Read in source code; run 4 verified by experiment.*

**011-21's lanes and slots.** The cancel is one signal per scheduler (`#stop`), so it reaches the tier of every lane at once. That includes slice 1's edit tier beside a node:test or pytest backlog tier. Each run's escaped-process sweep is keyed by its own run, and `stopMarked` stops every carrier of the daemon's mark. Under slice 2's slots (on `cand/0.1.225`), each backlog slot is a one-file tier, so a cancel loses at most the W files in flight. A slot that ended first is recorded through `SlotRecords` before the close resolves: `#close` awaits the pump, and the pump awaits the slots' records. Slots make a bounded wait look cheaper, because it is bounded by one file rather than one tier. But one file can still hold, as the probe's did, so the recommendation stands. *Read in source code (cand/0.1.225 `slot-records.ts`, `scheduler.ts`); not measured.*

**011-22's catch-up.** Catch-up runs on the backlog's route, and a later edit already cancels it (Vitest) or runs beside it (node:test, pytest). A step-down's cancel is the same move. What changes is the stake of Q3. A pull of hundreds of re-keyed files, in catch-up when an upgrade lands, is exactly what `lookup-only` drops today. Cezar's 740-file case was seen with `lookup-only` on. *Inferred, from `research/catch-up.md` and finding 4.*

C4 step 5 says that "a daemon that exits still lets its tier store (D10), so a departure waits for the running backlog tier however long it takes". That sentence gains the exception, below.

## 2. One successor per worktree (brief question 2)

**Today.** Every boundary that reads a fresh heartbeat of an older daemon calls `stepDownIfOlder`. The stepping daemon answers `steppingDown: true` every time, and each such hook spawns `squeal daemon <root> --await-lock 120000` (`src/harness/shared/ensure.ts`, `ensure`, `ensureIfStale`, `successor`). The heartbeat stops with the timers, so the requests end after two intervals (10 s), but within them they repeat: six hooks over 3.4 s gave six successors in every cross-version run. *Verified by experiment* (runs 1 to 4). Each successor retries the lock every 10 ms on a connection of its own (`src/core/daemon/lock.ts`, `awaitDaemonLock`) and reads the store every 250 ms (`takenOver`, `src/core/daemon/open.ts`). *Read in source code.*

**Cost, measured** (`probes/successor-cpu.sh`, 0.1.223 to 0.1.224, hold 90 s). Six successors spawned. They used 0 s of CPU at +10 s, 1 s each at +30 s and 2 s each at +60 s. That is 12 CPU-seconds a minute for the six, about a fifth of a CPU. Their RSS was 90 to 97 MB each, 582 MB in total. Ten seconds after the release one successor was left, and it served (the last one spawned). The CPU figures have 1 s resolution, and this is one run. *Verified by experiment.* On a host whose load this project already fills, that is the cost of six waiters per worktree being upgraded. Past 120 s all six give up, and nothing follows until a later boundary finds no socket (run 2).

**Recommendation: a handoff claim in the store.** The claim is a `meta` row `daemon-handoff:<worktree>`. It holds the old daemon's incarnation (`from`), the claiming hook's version (`to`), the claim's time (`at`) and its bound (`at` plus `SUCCESSOR_LOCK_WAIT_MS` plus 10 s).

- A hook that reads an older daemon with a fresh heartbeat first reads the claim. A live claim for the same incarnation means: send nothing and spawn nothing.
- With no live claim, the hook asks for the step-down, plus `stop` (section 1). On acceptance it writes the claim in a write transaction that reads it first. It spawns the successor only when the claim it wrote is its own.
- The claim ends in three ways: when its successor registers (the `#register` transaction deletes it), when the successor's lock wait ends without the lock (in the write of that wait's note), or at its bound. After that, the next boundary claims again.
- A hook that cannot write the claim within its busy timeout spawns as today. The lock's winner serves and the rest exit, so the old behaviour is the fallback, never "no successor".

This is the same pattern as 011-08's stopped mark and 001-415's rest mark, a short `meta` row read at every boundary. Its write sits in the step-down path only, at most once per handoff per hook. *Inferred; to be measured in R2.*

A successor whose store open waits on a busy store (up to 120 s, C7) after it takes the lock can outlast the claim's bound. Then a second claim spawns a second successor. That one loses the lock and exits, as today. This is accepted.

## 3. Pending work (brief question 3)

**Why run 5's file went stale.** This happens on every restart under `lookup-only`, not only on upgrades. Same version, `stop` with the edit's tier held, then `start`:

1. The cancelled tier records `tests/hold.test.ts` as unfinished. Its row reads `queued` (section 1).
2. The new daemon's `#register` turns leftover `running` rows into `queued` (`releaseRunning`). `start` prints `2 queued` (run 5, 21:53:12.7).
3. `baseline()` (`src/core/scheduler/bootstrap.ts`) looks every listed file up. The held file's key at revision 1 has no result, so it is a miss. Under `lookup-only` the baseline checkpoint is started over the misses and then `finish("abandoned")`. The enqueue loop is in the `else` branch and never runs, so nothing is queued, whatever the row said. `previousKeys` reads each row's key but not its `pending` phase.
4. `ledger.commit` writes every dirty file's row with its in-memory phase, which is `null`. Status reads `0 queued, 2 stale` 3.3 s after `start` (21:53:16.0). *Read in source code; consistent with runs 4 and 5, verified by experiment, n=1 each.*
5. The wait then returns on quiet. `heldPending` (`src/cli/status-wait-edit.ts`) counts the window's files whose row has a pending phase. The re-key move of `hold.test.ts` is still open (the window names one test file), but the file has no phase, so nothing holds the wait: `Returned on quiet: nothing the edits since revision 1 re-keyed is pending (1 test file)`, 0.5 s. *Read in source code; verified by experiment.*

The `scan` step does not save the file either. Its changed set covers revisions after the refined one, and the old daemon had already refined revision 1, the edit's. Under `lookup-only` that set is ignored anyway. With the default baseline (run 3) the file re-runs, but as a baseline miss in the second group, not as an edit's work. So even there it waits behind every other miss of a key-format change. *Read in source code.*

**Recommendation: hand over what was queued.** Whatever `baseline.onStart` says, the start baseline queues every file whose row its predecessor left `queued` or `running`, at this daemon's key, unless the lookup finds a result there. The order is step 4's, as of the revisions whose re-key moves (`rekeyedMoves`) are still open for the file. An edited file or a direct importer goes in the first group. A file re-keyed only by the environment goes in the second. A file re-keyed by a catch-up revision goes in catch-up (011-22). Any other file goes in the second group. A pending re-run of a new failure is queued too (Q5). Explicit checkpoints are already handed over (`owe`, `resumeOwed`).

The rule covers every way a daemon leaves work: a step-down's or a stop's cancelled tier, a revision recorded but not refined (a `reinstalled` exit), and a kill (`running` rows). It needs nothing from the predecessor beyond what releases since 001-258 already write. What it does not touch:

- **Cold-start misses.** Files whose key moved while no daemon ran, and every check a key-format change re-keys, stay as `lookup-only` leaves them: stale, current by 011-23's adoption once another worktree runs them, named by 011-27 with the command that advances them.
- **Promotions** (C15). These live in daemon memory. A named wait sends its promotion once, so after a handoff a promoted file keeps only its group. Not decided here (see "What is not known").
- **The slow tier and split caps.** These are memory by C4 and 004 D8, and the successor decides them again.

**The wait.** With R3, the handed-over file has a pending phase again, so `heldPending` holds the wait until its result. A file with an open move and no pending phase is the residue of a cold start under `lookup-only` (gh-38's scenario A). It still reads as not held. 011-27 already owns naming such a file with `retry`. This design leaves that line to 011-27 rather than changing the quiet rule here.

## 4. `start` and `status` during a handoff (brief question 4)

**Today.** `squeal start` prints `Squeal daemon ${result}` from `ensureDaemon`, and that result comes from a socket ping. The stepping daemon answers the ping, so the result is `alive`. Below that line, the snapshot reads the heartbeat through `daemonLiveness`. The heartbeat stops with the timers, so the snapshot reads `down` two intervals later. Runs 2 to 4 printed `Squeal daemon alive for …` above `Daemon: no daemon running since …`, and `status --json` said `down`. The named wait said that the heartbeat "went 146 s stale while its socket showed it alive (a busy store or a stalled daemon)". `start` spawns nothing in that state. *Verified by experiment; read in source code.*

The store already says more. `#shutdown` sets the phase to `stopping` and writes the exit mark (`daemonExitMetaKey`, the incarnation) synchronously, before anything it awaits. `withDeath` (`src/core/status/died.ts`) already reads that mark and probes the lock to tell a death from a shutdown. The ping has carried `phase` since the first daemon (`fd6ffee3`). *Read in source code.*

**Recommendation: one reading, "stopping".** A recorded daemon is stopping in two cases: its incarnation's shutdown has begun (the exit mark, or a note naming the incarnation, as `shutDown` reads it), or its ping says `phase: "stopping"`. While its heartbeat is down, it must also still hold its lock, or it is gone. Status reads the store and `start` reads both. They agree within one store write, since the phase and the mark are set together. Every place that says the daemon's state uses this reading: the `Daemon:` line, the registration header's liveness, a wait's liveness line, `start` and `status --json`. A stopping daemon is never "alive", and while its lock is held it is never "no daemon running".

Draft texts (sample times from run 2):

- With a claim: `Daemon: handing over from 0.1.223 to 0.1.224 since 21:46:44 (12 s); 0.1.224 serves once the old daemon's lock frees`
- Past the claim's bound: `Daemon: handing over from 0.1.223 to 0.1.224 since 21:46:44 (146 s), past its 130 s bound; \`squeal start\` finishes it`
- Without a claim (a stop, a reinstall, an older hook): `Daemon: stopping since 21:46:44 (12 s); nothing validates until its lock frees` and, past 130 s, the same `squeal start` clause.
- The wait's liveness line: `the daemon is handing over from 0.1.223 to 0.1.224 (since 21:46:44), so the wait went on`. Past the bound the wait returns without a daemon: `Returned without a daemon: the handoff to 0.1.224 did not finish within 130 s; \`squeal start\` finishes it`.
- `status --json`: `daemon.state` keeps its two values. An additive `daemon.stopping` gives `{ since, to?, boundAt?, overdue }`.

**`squeal start` finishes a handoff.** When the daemon is stopping, `start` never prints `alive`. Instead:

1. It sends that daemon `stop`, which cancels what it runs. For a daemon already cancelling this does nothing more.
2. It takes part in the handoff. It joins a live claim, or claims one and spawns its own CLI's daemon with the lock wait.
3. It waits for a daemon of at least its own version to answer, at most as long as `squeal stop` waits (60 s for the socket, 30 s for the lock).
4. It prints `Squeal daemon started for <root>, after the 0.1.223 daemon handed over in 1.3 s`, then the status.

Past that bound it says what still holds the lock, in `squeal stop`'s words (the process, its children), and exits 1. So the named recovery is one command. It also covers a daemon from before 0.1.200, whose tier only `stop` can cancel. 011-08's stopped mark is untouched: `start` clears it as today, and a hook's or `start`'s socket `stop` never writes one.

## 5. Code rows

Provisional names; numbers come from the board on acceptance. All four come after 011-22, which defines the catch-up group R3 hands over and rewrites the scheduler's queue that R1's cancel feeds. Each row: version bump, review PASS on its candidate.

**R1. A step-down cancels its tiers in flight (C9, C4 step 5).**
- Seams: `src/core/daemon/daemon.ts`, where `onStepDown` calls `#cancelTiers()` before its shutdown, as `onStop` does. `src/harness/shared/ensure.ts`, where `stepDownIfOlder` sends `stop` after an accepted step-down, still within two round trips.
- Tests: `test/daemon/step-down.test.ts`'s `stepsDownAfterItsTier` (the 0.1.0 case) is replaced. It now checks that the slow file's tier is cancelled, the old daemon exits within 15 s while the file would run 60 s, its row reads `queued`, and the note is the one `superseded` note. The released 0.1.31 case stays: before 0.1.200 the tier finishes. Two more tests, in the shape of `test/daemon/stop-cancel.test.ts`: a step-down with a Vitest tier and a node:test tier in flight cancels both and leaves no marked process; `test/harness/step-down.test.ts` gets the `stop` that follows an accepted step-down, and the budget test still holds.

**R2. One successor per handoff (C9, C8).** After R1, in the same file.
- Seams: a new `src/core/delivery/handoff.ts` (claim, read, clear; its key in `src/core/types/store.ts`'s meta-key table). In `src/harness/shared/ensure.ts`: `ensure`, `ensureIfStale` and `successor`. `src/core/daemon/daemon.ts`, where `#register` deletes the claim. `src/core/daemon/open.ts`, where `lockWaitTimedOut` deletes it.
- Tests: in `test/harness/step-down.test.ts`, six boundaries (three concurrent, three sequential) against a stepping daemon call `ensureDaemon` with `awaitLockMs` once. Past the claim's bound, the next boundary claims and spawns. After a successor's timed-out wait, the next boundary spawns at once. On a store held busy, the boundary spawns as today. In `test/daemon/handover.test.ts`, six SessionStart hooks leave one `--await-lock` process.

**R3. A restart hands the queued work over (C4).** Can run beside R1, since its seams are in the scheduler.
- Seams: in `src/core/scheduler/bootstrap.ts`, `baseline` queues `previousKeys`' pending rows whatever `onStart` says, ordered from the revisions of their open moves, with `scan`'s range for them. `src/core/scheduler/rerun.ts`: `restoreReruns`' `queue` under Q5 (a).
- Tests: a new scheduler test over a seeded store under `lookup-only` checks four cases. A predecessor's `queued` row with an open edit move is queued in the first group and runs. An environment-only re-key's row goes to the second group. Under a key-format change, the queued file is queued at its new key and the other files stay stale. Under the default baseline, the handed-over edit's file runs before the baseline's misses; red today, where it is a second-group miss. A daemon test of run 5's shape (same version, `lookup-only`, `stop` with the tier held, `start`): `status --wait 60000 tests/hold.test.ts` holds until the file's result after the hold is released. Red today: quiet in 0.5 s.

**R4. `start` and `status` name the handoff, and `start` finishes it (C6, C9).** After R2, whose claim it reads.
- Seams: `src/core/status/died.ts` (`withDeath`), or a `stopping.ts` beside it, for the stopping reading. `src/core/delivery/liveness.ts` for the header. `DaemonLiveness` in `src/core/types/`, which gains an additive `stopping`. `src/core/status/format-status.ts` for the `Daemon:` line. `src/cli/wait-liveness.ts` and `src/cli/status-wait-lines.ts` for the wait's liveness and no-daemon lines. `src/cli/start.ts` for the ping's phase, the `stop`, joining or claiming, and the wait.
- Texts: `commands.md`'s `start` and status sections. The evals parsers that read the `Daemon:` line or `daemon.state` get a round-trip through the real formatters, plain and hook JSON.
- Tests: a store whose recorded incarnation has its exit mark and holds its lock reads stopping, in status, the header and `--json`. It never reads alive beside down. Past the bound it names `squeal start`. `start` against a stepping daemon with a held tier exits 0 with the successor serving. `start` against a holder that keeps its lock past the bound exits 1 and names the process.

**The probe's regression** (brief question 5) is one daemon test, `test/daemon/handover-tier.test.ts`. It lands with R4, once all four rows are in.
- Fixture: four Vitest files, one held by a flag, and `baseline.onStart: "lookup-only"`. The old daemon is `buildAt("0.1.0")`. The hold is turned on and the held file edited. Then six SessionStart hooks run at the sources' version, three concurrent and three a second apart.
- Checks: one `--await-lock` successor; the old daemon exits within 15 s with its tier cancelled; `start` and status meanwhile say handing over, never alive beside down; the successor serves within the bound and queues `tests/hold.test.ts` in the first group; once the hold is released, the file's pass is stored; `status --wait 60000 tests/hold.test.ts` returns on that result, not on quiet.
- Red on main at three points: six successors, the hold outlasting the step-down, stale-and-quiet.

Each row's discriminating test comes first, in its own row. With the host's limit of three workers: R1 and R3 side by side, then R2, then R4.

## Spec text (drafts, for the amendments)

**011 C9**, replacing "A tier in flight finishes and stores its results, then the daemon exits; the queue behind it is left to the next daemon. `squeal stop` is the exception (task 001-367, hearsay-tools/squeal#2, the coordinator, 2026-10-16): its request cancels … is served by the successor." with:

"A step-down and `squeal stop` cancel the tiers in flight in every lane, as a timeout stops one (task 001-367, hearsay-tools/squeal#2; amended 2026-10-NN, row 011-30, gh-47: a step-down that waited for its tier outlasted every successor's 120 s lock wait, and the results it waited for were stored under a key format its successor does not read, `research/issue-47.md`). Results the runner already stored stay, under the stability check. Files that did not complete stay queued for the next daemon (C4). The test processes the daemon started are stopped (D12). No further tier starts, the slow drain of a departure included, and a daemon that has accepted either request never starts a tier. Any other exit lets its tier in flight finish and store, and leaves the queue behind it to the next daemon. The hook whose step-down a daemon accepted also sends it `stop`, so a daemon from 0.1.200 on that took a step-down without a cancel cancels too. A daemon before 0.1.200 still finishes its tier. A session that starts meanwhile finds a daemon stopping and is served by the successor."

**011 C9**, replacing "Hooks that ask again while the old daemon stops each spawn a successor, and all but the lock's winner exit." with:

"One successor per handoff. The hook whose step-down a daemon accepted claims the handoff: `daemon-handoff:<worktree>` in the store's `meta`, holding the old daemon's incarnation, the hook's version, the time, and a bound of the successor's lock wait plus 10 s. It writes the claim in the transaction that reads it, and spawns only when the claim is its own. A hook that reads a live claim for the same incarnation asks nothing and spawns nothing. The claim ends when its successor registers (in the registering transaction), when that successor's lock wait ends without the lock (in its note's write), or at its bound. After that, the next boundary claims again. A hook that cannot write the claim within its busy timeout spawns as before: the lock's winner serves and the rest exit (row 011-30: six waiting successors held 582 MB and used 12 CPU-seconds a minute between them)."

**011 C9**, after "Status reports "no daemon running since <time>" when the heartbeat is older than its interval, or with the last heartbeat once a daemon stopped and cleared its record.":

"A daemon is stopping in two cases: the store shows that its shutdown has begun (its exit mark, or a note naming its incarnation), or its ping says `phase: "stopping"`. While its heartbeat is down it must also still hold its lock. A stopping daemon is neither alive nor down. Status, the registration header, a wait's liveness line, `squeal start` and `status --json` (an additive `daemon.stopping`) say that it is stopping, since when, and with a claim, the version that follows and the claim's bound: `handing over from 0.1.223 to 0.1.224 since 21:46:44 (12 s)`. Past that bound, or 130 s after the shutdown began without a claim, they say the handoff did not finish and name `squeal start`, and a wait returns without a daemon. With a daemon stopping, `squeal start` asks it to `stop` and takes part in the handoff: it joins a live claim, or claims one and spawns its own CLI's daemon with the lock wait. It waits for a daemon of at least its own version to answer, at most as long as `squeal stop` waits, then prints that daemon and the status. Past that bound it says what holds the lock, as `squeal stop` does, and exits 1. It never prints `alive` for a stopping daemon (amended 2026-10-NN, row 011-30, gh-47: `start` printed alive above a down snapshot)."

**011 C4**, appended to "Explicit checkpoints: … or lookup only, per policy.":

"Whatever the policy, a daemon's start queues again every file its worktree's rows leave `queued` or `running`, at this daemon's key, unless the lookup finds a result there. That is the work a predecessor queued and did not finish: a step-down's or a stop's cancelled tier, a revision it recorded and never refined, or a kill. Step 4 orders those files as of the revisions whose re-key moves are still open for them. An edited file or a direct importer goes in the first group, an environment's re-key in the second, and a catch-up revision's file in catch-up. A new failure's re-run a predecessor queued is queued again too (task 001-171). The misses no daemon queued, such as every check a key-format change re-keys, stay as the policy leaves them (amended 2026-10-NN, row 011-30, gh-47: under `lookup-only`, a stop and start left the edited file stale with nothing queued, and the wait returned on quiet)."

**011 C4 step 5**, "A daemon that exits still lets its tier store (D10), so a departure waits for the running backlog tier however long it takes" becomes "A daemon that exits still lets its tier store (D10), unless a stop or a step-down cancels it (C9), so any other departure waits for the running backlog tier however long it takes".

**011 C8**, "a hook newer than the daemon asks it to step down (C9)" becomes "a hook newer than the daemon asks it to step down and claims the handoff, once per handoff (C9)".

**011 C6** needs no text of its own: its daemon states come from C9's reading, and the drafts above say where they appear.

## Rejected options

- **Wait for the tiers with a bound, then cancel (Q1 b).** It keeps a tier that ends within the bound. But at almost every upgrade the key format changed, so the tier's results land under keys its successor never reads. It also needs a timer and a second shutdown path. And once two heartbeat intervals pass, every reader sees the stepping daemon as down.
- **Wait unbounded, with the successor's lock wait raised to `runner.timeoutMs` plus grace (Q1 c).** On cezar that is 666 s of an older release validating while hooks see it down. That is the reporter's incident.
- **Wait only for an edit's tier, cancel the backlog and catch-up.** The sharing rule keeps edit tiers short, except in the cases that matter: a new file with no known duration, a hang, the probe's held file. The bound question comes back, and the key-format argument holds as for (b).
- **The old daemon spawns its successor.** It would run the old daemon's CLI path with the old hook's environment (D11), and old daemons cannot learn it.
- **The old daemon answers a repeated step-down with "already handed over" (Q2 b).** That works only for daemons from the fix on, so the first upgrade after it still spawns six. The store claim works from the hook side alone.
- **Successors converge among themselves on a second lock (Q2 c).** That still pays for N Node starts, about 95 MB each in the probe, and gives status nothing to read.
- **The old daemon writes an explicit handover list (Q3 b).** It works only from the fix on, and a kill writes nothing. The rows and moves are already in the store.
- **Treat a handoff as a baseline under `lookup-only` (queue every miss).** A key-format change re-keys every check, so every upgrade would run the whole suite, against the policy the reporter chose.
- **Keep the heartbeat while stopping (Q4 c).** A daemon that is leaving would extend its claims (C7), and readers would see alive until it exits. With the cancel, the shutdown ends within the grace, and the exit mark already tells stopping from down.
- **`squeal stop && squeal start` as the named recovery (Q4 b).** It is two commands, and the stop writes a stopped mark (011-08) that only the start clears. `start` doing both is one idempotent command.
- **A third `daemon.state` value, `"stopping"`.** Parsers that switch on two values would break. An additive field is used instead.

## What is not known

- **What held the reporter's 0.1.223 daemon** (`research/issue-47.md`, open question 1): an edit's tier, a slow-tier run, the escaped-children step or another shutdown step. The cancel bounds the first two. A shutdown step that hangs is still unbounded, and only R4's text and `start`'s bound cover it.
- **Whether other paths drop a `queued` row at start.** Only `baseline` and `releaseRunning` were read. R3's tests cover the restart; a held file (`takeHeldFiles`) and a blocked project were not traced.
- **Promotions across a handoff.** A named wait sends its promotion once, at its first decided read, and the promotion lives in daemon memory. After a handoff a promoted file keeps only its group. The wait could send again when the registered incarnation changes. That is not decided here; it is a candidate for a C15 row.
- **The claim's cost on a busy store.** One write per handoff per hook is assumed to fit the 2 s budget, as the stopped mark's print does. R2 measures it.
- **n=1.** Every probe run is one run. The CPU figures have 1 s resolution, and the host's load rose during the CPU probe from other work.
- **Out of scope, untouched:** gh-27's session-end lifecycle; 001-436, where `squeal stop` returns before the daemon's process has gone (`start`'s wait for a daemon of its own version answering is not affected); 011-20's stop-gap race.
