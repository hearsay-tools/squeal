# 001-156 notes: the "no daemon" / "validating again" pair

## Cause

`test/e2e/worktrees.test.ts`'s second worktree is the only consumer told
anything before the failing PostToolBatch, and the only tell is its
SessionStart registration. SessionStart spawns the worktree's daemon and
waits `SPAWN_SETTLE_MS` (750 ms) for its heartbeat; a registration without
one told the consumer `down` (`liveness-told`), so the next boundary, finding
the heartbeat, said "a daemon is validating again at revision 0".

Reproduced with a throwaway probe (four linked worktrees in turn, SessionStart,
poll status for the heartbeat, one PostToolBatch), committed bundles:

| load | hook ms | first heartbeat ms | registration | PostToolBatch |
| --- | --- | --- | --- | --- |
| 127 | 1125 | ~1500 | No daemon is running | a daemon is validating again |
| 127 | 774 to 989 | 1192 to 1765 | validating | silent |

At load 50 the same probe saw hooks of 196 to 384 ms and heartbeats by 470 ms,
which is why the case passes alone.

## Running daemons

The signal for a running daemon is the store heartbeat, down once older than
two intervals (10 s at the default 5 s), compared at each boundary
(`livenessChange`); the socket ping only decides whether to spawn. A 1 to 3 s
stall leaves the heartbeat at most 8 s old. Sampling the shared store every
250 ms for 3 min at load 90 to 130, the five live daemons' heartbeat ages
peaked at 5.6 to 7.0 s. A mid-session pair therefore needs a stall past 5 s,
a heartbeat write failing (the daemon's busy timeout is 5 s and a failure is
only logged, to nowhere under a detached spawn), or a real exit and respawn
(`reinstalled`, `superseded`, `sessions-gone`). None was reproduced; the live
reports may be any of these, or this same registration path in a session
started during a build.

## 001-153

Not the same cause: the step-down test waits for the successor spawned with
`--await-lock` to take the lock and record itself; it asserts no delivered
liveness and no heartbeat age. Only the daemon start time under load is
shared.
