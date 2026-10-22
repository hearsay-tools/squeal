# 011-34 notes (W1 of wave 12, 2026-10-22)

The stopping reading: 011 C9 as amended 2026-10-20, design `tasks/011-30/design.md` section 4 and R4. Base 637e408d0 (row 011-32 on main's db1b15068). Brief `tasks/wave-12.md`, W1.

## Ownership

The brief's W1 list left out three files the row and R4 name. The coordinator gave them to this row on 2026-10-22: `src/core/types/status.ts` (an additive optional `stopping` on both `DaemonLiveness` variants), `src/cli/wait-liveness.ts` and `src/cli/status-wait-lines.ts`. Brief defect: W1 says to read 011-65's notes under `tasks/`; `tasks/011-65/` does not exist, so this row worked from the board row.

## What changed

- `src/core/types/status.ts`: `DaemonStopping { from, since, to?, boundAt?, overdue }`, optional `stopping` on both `DaemonLiveness` variants. Additive; `state` keeps what the heartbeat says.
- `src/core/status/stopping.ts` (new): `withStopping` adds `stopping` when the recorded incarnation has its exit mark and its lock is held (`shutDown`, `daemonGone`, now exported from `died.ts`). `since` is its exit note's time, else its last heartbeat. With a handoff claim for that incarnation, `to` and `boundAt` come from the claim; without one the bound is `since` + `HANDOFF_BOUND_MS`. After the old daemon clears its record, a live claim with the lock still held reads the same way (`claimed`). `stoppingState`, `stoppingNext` and `stoppingText` word it for status, the header and the Outstanding group.
- Where it is read: `snapshot.ts` (status and `--json`), `delivery/liveness.ts` (`readLiveHeader` and `livenessChange`). Where it is said: `status-detail.ts` (`Daemon:`), `delivery/header.ts` (the header sentence), `delivery/format.ts` (a liveness delivery's title), `outstanding.ts` and `outstanding-text.ts` (the no-daemon group, also in the formatter's fallback for a snapshot without groups).
- `src/cli/start.ts`: `stoppingDaemon` finds a daemon whose ping says `phase: "stopping"` or whose status says `stopping`. `finishHandoff` sends `stop`, claims the handoff and spawns the successor with the lock wait, or joins a live claim, then waits for a daemon of at least its own version, as long as `squeal stop` waits (`STOP_BOUNDS`, 90 s). Exit 0 prints `Squeal daemon started for <root>, after the <from> daemon handed over in N s` and status. Exit 1 (`stillHeld`) names the old daemon's pid and the processes it started, on stderr.
- `src/cli/wait-liveness.ts`: a socket that answers with `phase: "stopping"` is `stopping`, not `listening`; past `heartbeatAt + interval + HANDOFF_BOUND_MS` the wait returns `down` with reason `handoff`.
- `src/cli/status-wait-lines.ts`: `liveText` names the handoff where a heartbeat lapse was; `noDaemonText` words reason `handoff`; a named wait past the bound names `squeal start` once.
- Evals parsers: `NO_DAEMON` (`evals/lib/squeal-text.mjs`) matches every new line; `squealState` (`grade.mjs`) reads `daemon.stopping` as no daemon validating; `transcript.mjs` keeps the Outstanding line whole in a trim.
- `commands.md` (three byte-equal copies): the stopping reading under `squeal status`, the handoff's wait lines, a `squeal start` section.

## Decisions the spec did not settle

- **`state` keeps the heartbeat's value; `stopping` is beside it.** A consumer that reads only `state` sees what it saw before. Every reader in Squeal and the evals checks `stopping` first.
- **`stopping.from` is the old daemon's version**, added so `start` and the wait can name it after the record is cleared.
- **The window after the old daemon clears its record** reads stopping from the live claim while the lock is held (since the repair of review 0.1.259, held or free: below). Without it, status said "no daemon running" there and `start` spawned a second process beside the claimed successor (seen in `handover-tier.test.ts`).
- **A wait's bound** is the heartbeat's interval after its last heartbeat, then the 130 s handoff bound. A wait reads the socket's phase, not the store's claim. (Replaced by the repair of review 0.1.259, B2: below.)
- **The header and the Outstanding group give no age**; `--full`'s `Daemon:` line does, as it does for a down daemon.
- **`start`'s exit 1 goes to stderr** and prints no status, as `squeal stop`'s failure does.
- **`status-wait-lines.ts` was already 436 lines**; this row adds 22 (458). Splitting it is not this row's.
- **The judge rubric** (`evals/lib/rubric.mjs`, line 13) lists the phrases that mean Squeal cannot answer. It is a prompt, not a parser, and the eval hold covers judge calibration, so it is unchanged. A later row can add `the daemon is handing over` there.

## Tests

| Test | What it checks | Red on base |
| --- | --- | --- |
| `test/status/stopping.test.ts` (10) | Stopping in status, `--full`, `--json`, the header and a registration, with and without a claim, before and past the bound, after the record is cleared; plain down once the lock is free or the mark is another incarnation's. | Yes, 7 of 10; the 3 plain-down cases pass on base by design. |
| `test/cli/handoff-wait.test.ts` (4) | A wait goes on while the daemon hands over and names it; past the bound it returns `no-daemon`, reason `handoff`, naming `squeal start`; a named wait the same, naming it once. | Yes, all 4: base said "heartbeat went 20 s stale" and timed out. |
| `test/daemon/start-handoff.test.ts` (2) | Against a released 0.1.31 daemon stopping with its tier running: exit 0 with the successor serving; with 3 s bounds, exit 1 naming the holder's pid. The evals read each output. | Yes, both: base printed `Squeal daemon alive`. |
| `test/daemon/handover-tier.test.ts` (1) | Design 011-30's regression: one successor, the old daemon out within 15 s, status saying it hands over, `start` exit 0, the held file run by the successor and stored, the named wait on its result. | Not run on base (base waits out the held tier). |
| `test/evals/stopping-evidence.test.ts` (145) | Each new line from `formatStatus`, `waitText`, `namedText`, `formatRegistration` and `formatDelta`, plain and in a Claude Code hook's JSON, reads as no daemon; `--json` too; the trim keeps the Outstanding line; a settled snapshot still reads a daemon. | Yes: 89 failed before the parser change. |

`handover-tier` does not check that the successor queues the held file in the first group (design 011-30, R4's checks). No daemon output names a tier's group: not the `runs` row, not status, not the daemon's log. Adding one is scheduler work outside W1's ownership. Row 011-33's `test/scheduler/handover-queued.test.ts` ("an open edit move's queued file runs in the first group") pins it at the scheduler. `handover-tier` checks that the successor runs the held file, held again, and stores its pass.

`handover-tier` logged, on a host at load 50 on 24 CPUs: "the successor served 3264 ms after the first hook; 2 of 25 readings stopping; start: Squeal daemon started for …, after the 0.1.0 daemon handed over in 0.1 s".

## For the next row

- `withStopping` reads a missing lock file as held (`daemonGone` returns `false` without one). A test of the lock-free case must create the lock file and release it, as a used store has one.
- `start` and the wait name the bound in seconds from `HANDOFF_BOUND_MS`; change it there only.

## Review 0.1.259 repair, B2 and the handover-tier failure (W3 of wave 12.5, 2026-10-22)

### B2: the wait reads the handoff as status does

`reviews/0.1.259.md` B2: `watchDaemon` read only the nullable record. A wait that polled after the old daemon cleared its record, while the claim was live and the lock held, returned "the daemon stopped" beside a snapshot that said it hands over.

- `watchDaemon`'s `judge` takes the stopping reading of the same read: `stoppingOf` in `src/cli/wait-liveness.ts`, which is `withStopping`'s. Both waits pass it (`status-wait.ts`, `status-wait-paths.ts`). Past the reading's bound the wait finds no daemon, reason `handoff`. Before it, without a fresh heartbeat, the wait goes on (`lapsed`). A fresh heartbeat reads `alive`, as before.
- The bound is the one status names: the claim's `boundAt`, or 130 s after the shutdown began. The wait used the last heartbeat plus its interval plus 130 s, 5 s later than status with a claim.
- A stopping daemon that leaves no reading (no incarnation, before task 001-270) is still judged by its socket's `phase`, with the old bound.
- Past the claim's bound with the record cleared, status reads plain down (this row's rule), and so does the wait: `no-daemon`, reason `stopped`.

### The handover-tier failure on CI

Run 39746558837, attempt 1, Node 22: no status reading had `stopping.to`. Measured locally by logging every reading of the test (about one each 100 ms, load about 30 on 24 CPUs), two runs alike: alive at 74 ms after the first hook; plain down at 190 ms and 293 ms; handing over to 0.1.259 at 405 ms; alive from 520 ms. The old daemon's shutdown, its cancelled tier included, took under 150 ms, and it let go of its lock before the successor's process had started. In that gap the record was cleared, the claim live and the lock free, and `claimed` read plain down. The stopping reading held only before the record cleared and while the successor held the lock and opened the store; on CI no reading fell in either. So it was the sampling and a product gap: a wait that polled in the gap returned "the daemon stopped", the header told no daemon between a daemon and a handoff, and `squeal start` there spawned beside the claimed successor.

Decision (the coordinator, 2026-10-22, both in this wave, since alive, down, then handing over is the flicker this row forbids):

- **The product.** `claimed` no longer reads the lock: with the record cleared, a live claim reads handing over until the successor registers, its lock wait times out (which clears the claim), or the bound. Status, `--json`, the header and both waits read it. `squeal start` that finds the lock free spawns its daemon whatever the claim, then waits as before; the lock decides between it and a successor still starting (D10; a losing `--await-lock` waiter gives up once another daemon registers, `takenOver`).
- **The test.** `handover-tier` starts the old daemon with `testPause("stop-gap")`: it stops itself between its socket's unlink and its lock release, and the test reads status there until it names the handoff to the hooks' version, then resumes it. The `readings` loop stays for the log line and the successor count.

Costs accepted: a successor that dies before it takes the lock leaves "handing over" in status and keeps a lone wait going until the claim's bound (130 s). A hook boundary in that window ensures a daemon as before (the record is cleared), and its registration ends the claim. The text "0.1.31 serves once the old daemon's lock frees" stays when the lock is already free.

| Test | What it checks | Red on base |
| --- | --- | --- |
| `test/cli/handoff-wait.test.ts`, "goes on until the claim's bound, as status reads it" | `judge` with the reading: lapsed until the claim's `boundAt`, down for reason `handoff` at it. | Yes (the old bound was 5 s later) |
| same, "judges a stopping daemon that leaves no reading by its socket" | The socket-phase fallback and its bound. | No, by design |
| same, "goes on and names the handoff, plain and named, where it said the daemon stopped" | The review's probe: record cleared, claim live, lock held, at T + 20 s. Both waits time out naming the handoff. | Yes |
| same, "returns on quiet once the successor registers"; "gives a named wait its verdict once the successor registers" | Both waits go on across the cleared record and end on the registration. | Yes, both |
| same, "goes on with the lock free while the claim lives, and finds no daemon once it ends" | The gap: both waits go on and name the handoff; once the claim is cleared, both find no daemon, reason `stopped`. | Yes |
| same, "finds no daemon past the claim's bound, as status reads none" | Record cleared, past the bound: `no-daemon`, reason `stopped`, no `stopping` in the snapshot. | No, by design |
| `test/status/stopping.test.ts`, "after it cleared its record and let go of its lock, a live claim still reads handing over" | Status, `--json` shape, the header and the text in the gap. Replaces "is plain down whatever the claim". | Yes |
| same, "after it cleared its record, is plain down with a free lock and no live claim" | No claim, and a claim past its bound: plain down in status and the header. | No, by design |
| `test/daemon/start-handoff.test.ts`, "with the record cleared, a live claim and the lock free, spawns its daemon and exits 0" | A claim whose successor never took the lock: `start` spawns, exits 0 and names the handoff; the daemon serves at this version. | Yes: exit 1 after its 25 s bounds, "let go of its lock, but no daemon ... answered" |
| `test/daemon/handover-tier.test.ts` | The status reading in the held stop gap names the handoff from 0.1.0 to this version. | Not run on base; the sampled assertion it replaces failed once on CI |

