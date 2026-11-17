# 005-115 notes: every hook reads a row-less worktree's start by its lock

## Reproduced on main (18450706c)

`test/harness/rowless-start-readers.test.ts`: a worktree with no row, whose daemon holds the lock
and its start mark (the session registered again after the row was removed, as removing a row
removes its consumers). Each `readLiveHeader` call is recorded by its caller's file.

| Reader | On main | After |
| --- | --- | --- |
| Stop's decision (`stop-decide.ts` `readRequired`) | `down`, `since: null`, no start mark | `down` with `startMark: "start"` (starting) |
| Stopped-by-request read (`stop-required.ts` `stoppedText`) | `down`, no start mark | starting |
| Waiting Stop entry (`stop-slow.ts` `read`) | `down`, no start mark | starting |
| Test-command deny (`deny.ts` `denyCurrentTestCommand`) | `down`, no start mark | starting |
| Delivery (`delivery.ts`, unchanged since 005-108) | starting | starting |

Visible effect on main: the quick Stop's block (the slow file not current) ended with the
decision's header, "Revision 1 (changed src/math.ts): No daemon is running; results are as of
revision 1." After: it does not say "No daemon is running".

The deny's outcome does not change: it denies only while `alive`, and starting is not alive. The
stopped-by-request read's outcome does not change either: it acts only on `stopped`. Both now read
the same state as delivery.

## The slow Stop wait (the coordinator's decision)

`stop-slow.ts` `daemonDown`: the wait's `STOP_SLOW_DOWN_MS` (10 s) rule counts the daemon down
only when it is down and not in a start whose mark names a live, running process: `startMark`
`start` and no `startStopped`. A stopped start (row 005-111) and a start mark whose process is
gone (presence then reports no `start` mark) end the wait as before. A `spawn` mark (a hook spawned
a daemon that may not hold the lock yet) counts as down, as before: it names no process that holds
the lock, and it lasts only the start's grace.

Tests (fast monotonic clock, 5 s per read, `slowWaitMs` 60 s): a running start waits to its 60 s
bound (on main the wait ended after about 10 s); a stopped start and a gone process end it before
40 s, as today.

## `readLiveHeader`

`readLiveHeader(store, worktreeId, now, { commonDir, states?, since?, keys? })`. `commonDir` is a
required key of type `AbsolutePath | undefined`: delivery's own option `commonDir` is optional
(`DeliveryOptions`, outside this row), so delivery passes it on as it is. Every hook caller passes
`HookContext.commonDir`, never undefined. Test callers that read a worktree with a row pass
`commonDir: undefined` (behaviour unchanged): `test/delivery/descriptor-fixture.ts`,
`test/evals/no-verdict-evidence.test.ts`, `test/harness/until-start-spawn.test.ts`,
`test/presence/{news.test,trace}.ts`, `test/scheduler/feed-delivered.test.ts`,
`test/status/{feed-late,not-current,stopping}.test.ts`.

Type change: new exported interface `LiveHeaderRead`; `readLiveHeader`'s parameters 4 to 7 became
that object (not additive; every caller changed in this commit).
