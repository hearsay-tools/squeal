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
- **The window after the old daemon clears its record** reads stopping from the live claim while the lock is held. Without it, status said "no daemon running" there and `start` spawned a second process beside the claimed successor (seen in `handover-tier.test.ts`).
- **A wait's bound** is the heartbeat's interval after its last heartbeat, then the 130 s handoff bound. A wait reads the socket's phase, not the store's claim.
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
