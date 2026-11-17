# 005-95 notes: why a running session registers again at a tool boundary

Worker 06919461, 2026-11-17. First step of the row, no code. Result: the 17 short-gap re-registrations of `tasks/005-91/notes.md` "(d)" have one cause, and it is a defect of its own. The brief says to stop there and report; the record of the slice (a "heard the primer" mark) is not built.

## The cause

Under Squawk, a Claude Code process lives for one turn, or for a few turns, not for the whole task:

1. The turn ends and Squawk closes the session (`session.ended` in the run log). Claude Code runs SessionEnd; Squeal unregisters every consumer of the session (`endSession`, `unregisterSession`) and parks the registration.
2. When the session was the worktree's last consumer, the daemon stops 3 s later ("daemon stopped: no session registered for 3 s after its last one ended").
3. The next human turn starts a new process with `--resume`. Its SessionStart hook (`startSession`) first ensures a daemon. None runs, so it spawns one and waits up to `SPAWN_SETTLE_MS` (750 ms) for the heartbeat (`ensureToRegister`), and registers only after that.
4. The SessionStart hook has a 2 s timeout (`plugins/claude-code/hooks/hooks.json`, the first SessionStart entry; the same in the installed 0.1.526 and 0.1.531). Process start, store open, spawn and settle on this host pass 2 s. Claude Code kills the hook: Squawk logs `SessionStart:resume` with `status: cancelled`, `exitCode: 1`, no output. Nothing was registered.
5. The first tool boundary finds no registration (`!isRegistered` in `deliver.ts`) and registers with the whole primer (`withPrimer`).

So the consumer did not expire and was not dropped by the daemon. SessionEnd removed it on purpose, and the SessionStart that should have registered it again (with no primer, since 0.1.527) was killed. `dropGoneHarnesses` and `dropLeft` play no part in the cases with evidence.

## Evidence (read-only)

Transcripts: Claude Code JSONL under `~/.claude/projects/` for the squeal and cezar directories, modified in the 6 days before 2026-11-17 (a longer window than 005-91's 4 days). Squawk run logs: `~/projects/{cezar,squeal}/.ai/squawk/runs/<task>.ndjson`; most tasks of the window are deleted, so only some cases have one. Scripts in the worker's scratch directory, not kept.

A cancelled hook does not appear in the Claude Code transcript; only Squawk's run log records it. That is why 005-91 saw "no SessionStart `resume` between them".

| Measure | Count |
|---|---|
| Tool-boundary registrations after an earlier registration in the same transcript | 192 |
| … of these with a Squawk run log still on disk | 41 |
| … with a run log and a `SessionStart:resume` `cancelled` between the two | 39 |
| … with a run log and no SessionStart between (gaps 35 min, 35 min: an expiry is possible) | 2 |
| … with a compaction between | 2 |
| Of the 192, gap under 10 min | 33 |
| … with a run log | 3, all 3 a cancelled `SessionStart:resume` after `session.ended` |
| … with no run log, a new human prompt between the two | 29 |
| … with no run log and no prompt between (gaps 6 s, 8 s, 19 s in a subagent, 153 s) | 4, cause not determined |

All Squeal-or-cancelled SessionStart hook items in the 378 Squawk run logs of the window: 76 `resume` completed, 53 `resume` cancelled, 18 `startup` cancelled, 1 `compact` cancelled. A cancelled one ends 2.8 s or more after its user message; completed ones end as early as 1.4 s.

One case in full (cezar task e67b2b14, session a58f5f67, 2026-11-16 UTC):

- 12:05:36 `SessionStart:resume` completed: registration.
- 12:08:48 turn end; 12:08:50 `session.ended`, "goal achieved, session closed" (`cezar_done`).
- 12:08:53 daemon log: "daemon stopped: no session registered for 3 s after its last one ended".
- 12:13:29 next human message; `SessionStart:resume` cancelled, exit code 1; 12:13:33 turn started.
- 12:13:41 PostToolBatch: `SQUEAL · registered at revision 0` with the whole primer.
- 12:14:32 the next daemon starts (the boundary's ensure spawned it).

The same chain is the most likely cause of most of 005-91's 87 "expired" cases: 36 of the 39 run-log cases above have a gap of 10 minutes or more. They are a closed session and a killed SessionStart, not the 10-minute or 12-hour expiry.

## Why this stops the slice as briefed

The brief asks for a record that the session heard the primer, which outlives the consumer's expiry and ends with the session. In the cases measured, the session ends (SessionEnd) at each turn end under Squawk, while the context, and the primer in it, goes on in the resumed process. A record that ends at SessionEnd would not cover them. A record that outlives SessionEnd needs a decision on its end (the 12-hour parked lifetime, or `resume` keeping it).

If SessionStart registered reliably, these cases become SessionStart `resume` registrations, which already send no primer (0.1.527). What is left at the tool boundary is then the true expiry (2 of 41 with a run log here), the first registrations, and the 4 undetermined short cases.

## Proposed defect row (for the coordinator)

"A SessionStart that must start a daemon is killed by its 2 s timeout before it registers." Options:

- A: register first, then ensure; the registration then says a daemon is starting (`startingSince`), as it does after a settle that timed out. Smallest change; the hook's output is still lost when the kill comes later, but the registration (and the `resume` no-primer rule) holds.
- B: raise the SessionStart hook's timeout (2 s since the plugin's first version; the waiter beside it has 3600 s). Simple; a slow host then delays the session's first turn.
- C: give `startSession` a deadline under the timeout and skip the settle when it is near.

Separate observation for the coordinator: since each Squawk turn end is a SessionEnd, the daemon stops 3 s after each turn of a task that is the worktree's only consumer, and the next turn starts it again (a full start each turn).
