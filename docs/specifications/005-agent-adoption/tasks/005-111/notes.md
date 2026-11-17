# 005-111: a daemon stopped during its start

Row 005-111, wave 23 W1. Open point of 005-108 (`tasks/005-108/notes.md`, "A daemon SIGSTOPped
inside its start").

## The seam

- `lifeOf` (`src/core/daemon/terminate.ts`) reads `/proc/<pid>/stat`; `Life.stopped` is the state
  `T` (job-control stop, SIGSTOP) or `t` (tracing stop). No caller changes behaviour.
- `processStopped(pid, platform, life)` (`src/core/presence/marks.ts`): Linux only; elsewhere no
  state is read and a process reads as running. The start mark's reading (`LockMarks.start`) and
  `DaemonStart` `locked` carry `stopped`.
- `withStartState` (`src/core/presence/views.ts`, was `withSlowStart`): a start said by its start
  mark (`startMark` `start`, so the marks are read already) whose process is stopped gets
  `startStopped` (`src/core/types/status.ts`) in place of `startSlow`. `toldOf` says it with the
  note `start stopped` (`presence/state.ts`, `told.ts`), so `alreadyTold` tells it once. A start
  the session was told of (a hook's spawn, `withToldStart`) reads no marks within its
  `DAEMON_START_GRACE_MS` (10 s; review 0.1.403-r2 B2, pinned by `test/presence/reads.test.ts`),
  so the first boundary that can see the stop is the first one past that grace.
- `newsChange`: a start is news once when slow (005-108) or once when stopped. A process that
  continues reads as starting again, no news; past `DAEMON_START_SLOW_MS` the slow start is told
  once as before.
- The registration tells the stopped note it said (`tellAtRegistration`, `delivery.ts`, one line),
  as it does a slow start (review 0.1.547 B1).
- No spawn: the start mark still names a live process, so 005-108's spawn guard holds.

Edits outside the listed files, agreed with the coordinator (2026-11-17): `delivery.ts` (one
condition), `presence/state.ts` and `told.ts` (the note), `status/outstanding-text.ts`
(`startText`) and `status/status-detail.ts` (the `Daemon:` line and `startStoppedText`, the one
owner of the clause; `header.ts` imports it as it imports `untilStartText`).

## Texts, before and after

Start mark written at 09:00:01Z, revision 0, no results yet.

Stopped while starting, first hook boundary that sees it (PostToolBatch, Stop alike):

- Before: nothing until 60 s, then
  `SQUEAL · a daemon is still starting at revision 0` /
  `Revision 0: A daemon has been starting since 2026-11-18T09:00:01.000Z, and Squeal has no results in this worktree yet.`
- After, at the first boundary past the spawn's 10 s grace:
  `SQUEAL · a starting daemon may be stopped at revision 0` /
  `Revision 0: A daemon has been starting since 09:00:01 UTC, and it may be stopped: no results come until it runs again, and Squeal has no results in this worktree yet.`
  Later boundaries while it stays stopped: nothing. No pid, no `squeal start`.
- With results (the header's daemon sentence, `daemonText`):
  ` A daemon has been starting since <HH:MM:SS UTC>, and it may be stopped: no results come until it runs again; results are as of revision N.`

`squeal status`, Outstanding:

- Before: `no daemon has validated; results are as of revision 0; a daemon holds this worktree's lock but does not serve yet: it is starting or stopping`
- After: `no daemon has validated; results are as of revision 0; a daemon has been starting since 2026-11-18T09:00:01.000Z, and it may be stopped: no results come until it runs again`

`squeal status --full`, Daemon line:

- Before: `Daemon: no daemon running; a daemon is starting`
- After: `Daemon: no daemon running; a daemon has been starting since <time>, and it may be stopped: no results come until it runs again`

Running while starting: unchanged (no news, then the one "still starting" past 60 s).
Stopped, then continued: the one stopped message; then nothing while it starts; past 60 s the
slow start is said once as before; its registration follows the normal path.
Not Linux: unchanged; a stopped process reads as a slow start.

`squeal stop` (`src/cli/stop.ts`, unchanged, coordinator's call): the stopped process has no
socket, so it prints `No daemon running for <root>; …` and leaves the stop mark. It does not
contradict the hook, since no daemon serves; it does not name the stopped start.

## Time format

Hooks print times as `utcTimeText` (`HH:MM:SS UTC`, 005-94 C4), the coordinator's steer from the
quality scan (2026-11-17). The new hook sentence uses it, and so does 005-108's slow-start
sentence now (`slowStartText`, `header.ts`): before
`A daemon has been starting since 2026-11-18T09:00:01.000Z, and Squeal has no results in this worktree yet.`,
after `A daemon has been starting since 09:00:01 UTC, and Squeal has no results in this worktree yet.`
Its tests (`starting-no-row`, `starting-second-session`) pin the new form; no e2e, parser or
skill text pinned the old one. `squeal status` keeps ISO, as its neighbours on the same lines
(`no daemon running since <ISO>`, the late heartbeat's time); `startStoppedText` takes the
formatter, so one function owns the clause.

## Tests

- `test/harness/starting-stopped.test.ts`: production Claude Code hooks, `lifeOf` mocked to set
  the state: stopped (once, no spawn, NO_DAEMON on the full text and the title alone), continued
  (no leftover, slow start later), Stop and status agree, running (as today), not Linux
  (`process.platform` set to `darwin`: as today).
- `test/presence/marks-stopped.test.ts`: `processStopped` with an injected reader on and off
  Linux; a real child SIGSTOPped and SIGCONTed, read through the real `lifeOf`, skipped off Linux.

Evals: `NO_DAEMON` (`evals/lib/squeal-text.mjs`) also matches the title
`a starting daemon may be stopped`; the header already matched `A daemon has been starting`.
The skill copies do not quote the slow-start sentence; no change.
