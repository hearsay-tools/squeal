# 005-108 notes: a starting daemon told as "no daemon is running"

## Cause (reproduced, `test/harness/starting-no-row.test.ts`)

Not the coordinator's reading. The text does not come from `ensureIfStale` returning
`unavailable` (that path prints a "Not validated:" line). It is the news delta of
`onToolBoundary`, and its cause is the missing worktree row:

1. A new worktree has no row in the store until its daemon registers
   (`recordRegistration`, `src/core/presence/events.ts:80`). A daemon in its store check
   (`quick_check`, before the socket and the registration) holds the lock and has written its
   start mark (`src/core/daemon/open.ts:185`), but there is no row.
2. `readPresenceFacts` finds the lock file only through the row
   (`src/core/presence/facts.ts:79-82`), so `facts.marks()` is `null` without a row.
3. The session start told the consumer `startingSince` (`registerFirst`,
   `src/harness/shared/ensure.ts:335`). `withToldStart` keeps that start for
   `DAEMON_START_GRACE_MS` only (`src/core/presence/views.ts:114`).
4. Past the grace, `newsView` returns the bare heartbeat liveness when the row is missing
   (`src/core/presence/views.ts:234`), without reading the start mark: state `gone`.
   `toldOf` says `gone`, which differs from the told `starting`, so it is news.
5. The header for a worktree with no listed test files and `noneRunning`
   (`src/core/delivery/header.ts:53-57`) prints
   "Squeal has no results in this worktree yet, and no daemon is running; `squeal start` starts one."

The same missing row also stops `spawnStartCurrent` (`src/core/presence/findings.ts:31`): the
hook ensure probes the socket, which the daemon binds only after its store check, finds
`ENOENT` and spawns another daemon at each boundary (it then waits for the lock).
`squeal status` reads `statusView` → `withRecordFacts`, which also returns early without a row
(`src/core/presence/views.ts:192`), so status says "no daemon is running" too.

Control: the same sequence with a row whose record is cleared passes (the start mark is read,
the daemon is told as starting, no second spawn).

## Fix (coordinator decision (a), 2026-11-17)

Three commits:

1. Row-less marks: `readPresenceFacts(store, id, now, row?, commonDir?)` finds the lock by
   `commonDir` only when the row is missing (`facts.ts`); `readPresence` passes it
   (`decide.ts`); `startOfMarks` (`findings.ts`), `withRecordFacts` and `newsView` (`views.ts`)
   read the marks without a row as with the record cleared.
2. Spawn guard: `spawnStartCurrent(row, now, lockFile?)` (`findings.ts`), called from the hook's
   `ensure` through `startCurrent` (`src/harness/shared/ensure.ts`), with the lock beside the
   hook's common dir when the row is missing.
3. Still starting: `DAEMON_START_SLOW_MS = 6 * DAEMON_START_GRACE_MS` (60 s,
   `heartbeat.ts`), a plain multiple of the grace, not the store's start history (row 011-391
   changes what a start costs). A down liveness with `startMark: "start"` older than it gets
   `startSlow` (`withSlowStart`, `views.ts`); news tells it once (told note `start slow`,
   `state.ts`, `told.ts`).

A hook gets no slower: with a row, every reader reads the lock as before; the lock file is
computed (hook ensure) or `resolveCommonDir` is read (status) only when the row is missing.

### Edits outside `src/core/presence` (condition 1)

- `src/core/delivery/delivery.ts`: `DeliveryOptions.commonDir` (new optional field after `root`);
  the 4 calls of `livenessChange` / `readLiveHeader` pass `options.commonDir` (the one in
  `registerNow`, near line 583, only gets the argument).
- `src/core/delivery/liveness.ts`: `readLiveHeader` and `livenessChange` take an optional last
  `commonDir` and pass it to `readPresence`.
- `src/core/status/snapshot.ts`: lines 142-144 only (`rowless` by `resolveCommonDir(root)` when
  `worktree === null`). Not `recoveryNote`, which cand/0.1.545 changes.
- `src/harness/shared/context.ts`: `commonDir: location.commonDir` in `createDelivery`'s options.
- `src/core/delivery/header.ts`, `src/core/delivery/format.ts`: the slow-start sentence and title.
- `src/core/types/status.ts`: `DaemonLiveness` down gets `startSlow?: true` (additive).
- `evals/lib/squeal-text.mjs`: `NO_DAEMON` reads `A daemon has been starting` and
  `a daemon is still starting`.

## Texts before and after

New worktree, daemon holds its lock in its start (not registered), first boundary past the 10 s
grace:

- Before, tool boundary: `SQUEAL · no daemon is validating at revision 0` /
  `Revision 0: Squeal has no results in this worktree yet, and no daemon is running; \`squeal start\` starts one.`
- After, tool boundary: nothing (the session start said "still starting").
- Before, `squeal status` Outstanding: `no daemon has validated; results are as of revision 0; \`squeal start\` starts one`
- After, `squeal status` Outstanding: `no daemon has validated; results are as of revision 0; a daemon holds this worktree's lock but does not serve yet: it is starting or stopping`
- Stop: nothing before the slow bound and after it (the news was told at a tool boundary).
  Stop and status agree: both treat the daemon as starting, neither names `squeal start`.

The same start past 60 s from its start mark (new), once:

```
SQUEAL · a daemon is still starting at revision 0
Revision 0: A daemon has been starting since 2026-11-18T09:00:01.000Z, and Squeal has no results in this worktree yet.
```

With listed results (a worktree with a row whose record went stale), the sentence after the
counts is ` A daemon has been starting since <time>; results are as of revision N.` (by the code, not tested) in place of
` A daemon is starting; results are as of revision N.`

Unchanged ("told as now"):

- A spawn that never takes the lock (died): starting within the 10 s spawn grace, then
  `Squeal has no results in this worktree yet, and no daemon is running; \`squeal start\` starts one.`,
  and the next boundary spawns again.
- A start mark whose process is gone: the same "no daemon is running" past the grace.
- A registered daemon that holds the lock and does not answer (SIGSTOP):
  `SQUEAL · the daemon's heartbeat is late at revision 1` /
  `Revision 1 (changed src/math.ts). The daemon's heartbeat is late: the last one was 6 min ago, at …; the daemon may be busy or stopped; results are as of revision 1.` /
  `Not validated: the daemon's heartbeat is late: …; any change this call made has no result until it validates again.`
  A daemon SIGSTOPped inside its start (lock and start mark held, not registered) reads as a
  slow start: starting, then the one message at 60 s. Telling a stopped process apart needs
  `lifeOf` to read the state `T` (`src/core/daemon/terminate.ts`), outside this row.

## The extra daemons (condition 2)

In the reproduction (boundaries at +2, +11, +30, +85 s during one held start, no row), the hooks
spawned 4 extra daemons beside the first: `[0, 2000, 11000, 30000, 85000]`
(`test/harness/starting-no-row.test.ts`, red before the spawn guard). Each extra loses the lock
and waits up to `VACANT_LOCK_WAIT_MS` (30 s), polling the lock every 10 ms and opening the store
every 250 ms to check for a serving daemon (`src/core/daemon/open.ts` `servedElsewhere`). It exits
at once with no note when the first daemon registers within its wait, else at 30 s with the note
`a daemon gave up: the lock was still held after 30000 ms with no daemon serving; the next hook
boundary starts one` (`test/daemon/rowless-extra-spawn.test.ts`). In an 83 s start, every extra
spawned before second 53 leaves that note. With the guard, none is spawned.

Bundles: `plugins/*/dist` drift from these sources (the package tests fail on main's bundles
until the coordinator builds); no build in this worktree per the wave rules.

## Repair: review 0.1.547 B1 (a second session during one slow start)

Base: `cand/0.1.547` (`ca67710d8`), branch `cez/bce98856-r`. Row 005-106's lines in
`registerNow` are untouched.

Cause, as the review reads it, reproduced with the production hooks
(`test/harness/starting-second-session.test.ts`): session B registers at +90 s during one start
whose mark is at T. `registerFirst` gives B a synthetic `startingSince` of its own time, and
`withToldStart` (`src/core/presence/views.ts`) put that time over the marked start's while
keeping `startSlow`. `tellAtRegistration` (`src/core/delivery/delivery.ts`) then stored only the
synthetic `{ startingSince }`, so B's next boundary past its 10 s grace read the slow start from
the mark and said it again. Before the repair:

```
B registration: Revision 0: A daemon has been starting since 2026-11-18T09:01:30.000Z, and Squeal has no results in this worktree yet.
B at +101 s:    SQUEAL · a daemon is still starting at revision 0
                Revision 0: A daemon has been starting since 2026-11-18T09:00:00.000Z, and Squeal has no results in this worktree yet.
```

Repair (2 source lines):

- `withToldStart`: a start the lock's mark names (`startMark: "start"`) is returned as it is, so
  its time is the mark's. The grace fallback stays for a spawn with no observed start.
- `tellAtRegistration`: a header that said a slow start is told as said (`toldAtRegistration`,
  state `starting` with the note `start slow`), not as the synthetic start.

After: B's registration says `since 2026-11-18T09:00:00.000Z`; its boundary at +101 s says
nothing; no hook spawns a second daemon.

Tests (`test/harness/starting-second-session.test.ts`, 6):

- the reviewer case: A told at +85 s, B registered at +90 s with the mark's time, silent at
  +101 s, spawns `[0]`;
- B registered at +30 s, before the bound: no slow sentence in its registration, one notice at
  the bound with the mark's time, then silent;
- the first session unchanged: one notice at the bound;
- a resumed session (`source: resume`) past the bound: the mark's time in its registration, silent
  at its next boundary;
- after a told slow start, a start that dies is told `no daemon is running`, and one that
  registers is told `a daemon is validating again`.

Commands and results:

- `timeout 300 node_modules/.bin/vitest run test/harness/starting-second-session.test.ts` with
  the two source edits reverted: 4 failed, 2 passed (the before-bound and first-session cases
  hold before the repair too). With them: 6 passed.
- `timeout 300 node_modules/.bin/vitest run test/harness/starting-second-session.test.ts test/harness/starting-no-row.test.ts`: 2 files, all passed.
- `pnpm run lint`, `pnpm run typecheck`: clean.
- The held-start fixture moved to `test/harness/starting-fixture.ts`, shared by both test files.
- `squeal status --wait 570000 <the 5 changed paths>` at revision 52: 952 test files, each with a
  current result; 4 known failures, all the bundle checks (`plugin.test.ts`,
  `codex/packaging/runtime.test.ts`, `opencode/package.test.ts`, `pi/package.test.ts`: the
  committed bundles of 0.1.547 differ from the changed sources; no build here). The worktree is
  all 1939 test files current.
