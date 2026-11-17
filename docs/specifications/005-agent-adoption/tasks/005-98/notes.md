# 005-98 notes: a session start registers first, then starts the daemon

Worker 71f2262a, 2026-11-17. Wave 19, W1. Option A (the human, 2026-11-17).

## The order as built

`startSession` (`src/harness/shared/session.ts`), shared by Claude Code's SessionStart and SubagentStart and by Codex's SessionStart and subagent start:

1. Open the store (`withContext`).
2. `registerFirst` (`src/harness/shared/ensure.ts`): read a held `squeal stop` (`stopHeld`, the same check `ensure` made first before). Then read the store's daemon record:
   - a stop holds: no `startingSince`; the ensure after the registration starts nothing (`stopped`);
   - the record has a fresh heartbeat: no `startingSince` (the daemon validates; a handoff to a newer daemon still happens in the ensure);
   - else: `startingSince` = now.
3. The registration (`registerAtStart`): sweep on `startup`/`resume`, `register`, the text (no primer on `resume`; only the primer after `compact` for a main agent still registered). Committed here.
4. The ensure (`ensure(…, { stopRead: true })`): handoff, probe, spawn. No wait for the heartbeat (`settle` is not called).
5. The hook writes its text.

Before: ensure, spawn, settle up to 750 ms, then register. The registration now comes before the socket probe and the spawn, and the 750 ms wait is gone.

## Decisions the spec did not settle

- **Which registrations say "a daemon is starting".** Every one with no fresh heartbeat in the store and no held stop. The start probes no socket first: the probe is inside `ensureDaemon` (`src/core/daemon/**`, not this row's), and a probe here would answer differently from the tests' `ensureDaemon` stand-ins. Effect in two rare cases: a daemon that answers its socket with a heartbeat older than two intervals (busy), and a daemon that cannot be started (no CLI, a hung daemon holding the lock). Both are told "starting" at registration, and the truth once the start's grace passes (`DAEMON_START_GRACE_MS`, 10 s), as after a spawn that never heartbeats (task 001-156). Before, a short-late heartbeat read as validating at registration.
- **No settle.** The registration says "starting" even when the daemon heartbeats 200 ms later. The first heartbeat after a told start is no news (task 001-156), so the next boundary stays silent. `SPAWN_SETTLE_MS` and `ensureToRegister` stay for the paths below.

## The boundary after a kill

If the hook is killed after step 3, the registration is committed and the hook's text is lost. The first tool boundary finds the consumer registered (`isRegistered`), so it does not register again and says no primer. It delivers what any registered consumer gets: the news since the registration's view. With nothing changed and the daemon's first heartbeat in, it is silent; a failure since then comes as a normal change delivery. Tests: `test/harness/register-first.test.ts`.

For `resume` this is the intended result (0.1.527: no primer on resume). For `startup` it is a loss: a new session whose SessionStart is killed after step 3 never hears the registration or the primer, where before the kill made the boundary register with the primer. A kill after step 3 is now less likely (no 750 ms wait before the hook ends), but not impossible. Closing it needs a record that the registration's text reached the session, the "heard the primer" record row 005-95 holds; I did not build it.

If the hook is killed before step 3 (store open slower than 2 s), nothing changed against before: the boundary registers with the primer.

If the hook is killed during step 4, the daemon may not be spawned. The registration said "starting"; the next boundary's `ensureIfStale` spawns (stale heartbeat), and after 10 s with no heartbeat the header says no daemon is validating.

## What each harness does

| Harness | Start path | Now |
|---|---|---|
| Claude Code SessionStart, SubagentStart | `startSession` | register first |
| Codex SessionStart, subagent start | `startSession` (`src/harness/codex/handlers.ts`) | register first |
| Claude Code and Codex UserPromptSubmit that registers | `src/harness/shared/prompt.ts`, `ensureToRegister` | unchanged: ensure, settle, register |
| OpenCode | `register` in `src/harness/opencode/bridge.ts`, `ensureToRegister` | unchanged |
| Pi | `startSession` in `src/harness/pi/session.ts`, `ensureToRegister` | unchanged |

The three unchanged paths are outside this row's files. They have the same exposure: a registering UserPromptSubmit has the 2 s hook timeout (`plugins/claude-code/hooks/hooks.json`); OpenCode's bridge has a 2 s deadline that kills the bridge's process group (`EVENT_DEADLINE_MS`, `bridge-client.ts`); Pi's `session_start` has a 2 s deadline that terminates the worker (`src/harness/pi/extension.ts`). Each is a three-line change: call `registerFirst` before the registration and its `ensure()` after it, in place of `ensureToRegister`. Not measured how often they are killed; no evidence like 005-95's exists for them.

## Other changes

- `ensure` takes `{ stopRead }` so the stop is not read twice; `stopHeld` is the old first block of `ensure`.
- `registerNow` (`src/core/delivery/delivery.ts`): its transaction went from complexity 22 to 13. `tellAtRegistration` (5) and `seedRegistered` (6) take the tell part and the first-registration part. No behaviour change; `test/delivery/late-paths.test.ts` passes.
- `test/harness/starting-daemon.test.ts`: the test that the registration waits for the heartbeat is replaced by one that the registration comes before the spawn, says "starting", and takes less than `SPAWN_SETTLE_MS`.
- `test/harness/latency.test.ts`: comment only. It runs the committed bundles (`plugins/claude-code/dist`), which this worktree does not rebuild: the latency of the new order is measured once the coordinator builds.
