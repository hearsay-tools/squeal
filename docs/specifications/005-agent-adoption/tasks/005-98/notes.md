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
- **No settle.** The registration says "starting" even when the daemon heartbeats 200 ms later. The first heartbeat after a told start is no news (task 001-156), so the next boundary stays silent.

## The boundary after a kill (decision C, the coordinator 2026-11-17)

Contract: a session reads its registration text once; a new session reads it with the primer, a resumed one without.

Built as a record of the text a registration still owes (`src/core/delivery/registration-owed.ts`, `meta` row `registration-owed:`):

- Each registration writes it in its own transaction: `RegisterOptions.owesText` (`{ primer }`), or clears it when absent. SessionStart owes `{ primer: false }` on a main agent's `resume`, else `{ primer: true }`; a boundary's or a prompt's own registration owes `{ primer: true }`.
- The hook clears it as its last step, in a write held until its output is written (`HarnessDelivery.registrationSent`, which opens a hold as a delivery's report does, row 011-288). A kill before the output, or an output that fails, rolls the clear back.
- A tool boundary (`deliver.ts`) or a prompt (`prompt.ts`) that finds the consumer registered with its text still owed registers it again in the turn, owing the same text, says that text (with the primer or not) in place of its delta, and clears the record the same way.
- The record is read only while the consumer is registered, and its slot is dropped at the next write after the consumer leaves, so it ends with the consumer.

The inverse of the coordinator's "sent" mark, on purpose: a consumer registered by an earlier version has no record and owes nothing, so an upgrade does not say every registration again. The meaning is the same: no record, nothing owed.

Accepted: a kill after the output is written and before the clear commits gives the text twice.

A compaction is unchanged: a `compact` SessionStart for a main agent still registered says the primer only and neither writes nor clears the record. A text still owed from before is said at the next boundary.

What a boundary after a SessionStart killed after its registration delivers:

| Case | That boundary | The next one |
|---|---|---|
| `startup`, killed before output | the registration and the primer | only news |
| `resume`, killed before output | the registration, no primer | only news |
| hook completed | only news | only news |
| the boundary's own output lost too | the registration again (with the primer when owed) | only news |

Tests: `test/harness/registration-owed.test.ts` (the hand-off's abandon stands for the kill, its commit for the written output), `test/harness/register-first.test.ts` (a daemon start that does not end within the hook's 2 s, with the registration in place before it).

If the hook is killed before its registration (store open slower than 2 s), nothing changed against before: the boundary registers with the primer.

If the hook is killed during the ensure, the daemon may not be spawned. The registration said "starting"; the next boundary's `ensureIfStale` spawns (stale heartbeat), and after 10 s with no heartbeat the header says no daemon is validating.

## What each harness does

Every path that registers and may start a daemon now registers first (`registerFirst`), then ensures, with no heartbeat wait. `ensureToRegister`, `settle` and `SPAWN_SETTLE_MS` are removed.

| Harness | Path | File | Deadline that can cut it | Owed text |
|---|---|---|---|---|
| Claude Code SessionStart, SubagentStart; Codex SessionStart and subagent start | `startSession` | `src/harness/shared/session.ts` | the hook's 2 s timeout | yes |
| Claude Code and Codex UserPromptSubmit that registers | `submitPrompt` | `src/harness/shared/prompt.ts` | 2 s | yes |
| Claude Code PostToolBatch, Codex PostToolUse, Pi and OpenCode boundaries that register | `deliver` | `src/harness/shared/deliver.ts` | 2 s | yes (they already ensured before) |
| OpenCode session register | `register` | `src/harness/opencode/bridge.ts` | the bridge's 2 s deadline (`EVENT_DEADLINE_MS`), which kills its process group | yes, header only |
| Pi session start | `startSession` | `src/harness/pi/session.ts` | the worker's 2 s deadline, which ends the worker | yes, header only |
| Pi run start | `startRun` | `src/harness/pi/run.ts` | 2 s | yes, header only; a registered run start says an owed header as its news first |

Repair after review 0.1.541 B1: OpenCode and Pi owe their registration header too (`{ primer: false }`, `PI_OWED`), cleared last through the held hand-off (OpenCode's at the plugin's verdict, Pi's at the host's). Their primer stays on the system prompt, so the owed text never carries it. Pi's run start reads the owed header before `startTurn`; Pi's and OpenCode's tool boundaries use the shared `deliver`, and OpenCode's prompt the shared `submitPrompt`, which say it. Re-saying it re-registers a registered consumer, which keeps its own count's `since` (row 005-100). Tests: `test/harness/register-first-harnesses.test.ts` (order, one per path) and `test/harness/registration-owed-harnesses.test.ts` (kill during the ensure for Pi's session start, Pi's first run registration and OpenCode's register; the next delivery says the registration with its failure once, the one after only news; lost and taken hand-off controls). All six kill and lost-hand-off cases fail without the repair (checked by reverting the three source files).

Other paths checked for the same gap: the shared prompt (`prompt.ts`, Claude Code and Codex, and OpenCode's prompt) registers owing its text and replays an owed one; Codex's SessionStart, subagent start, PostToolUse and prompt use the shared `startSession`, `deliver` and `submitPrompt`. Not covered: a Stop (`stop.ts`, every harness) and the idle waiter (`waiter.ts`) do not say an owed registration; it waits for the next tool boundary, prompt or Pi run start. Neither path drops it, so the text comes late, not never. They were outside this row's files.

The Stop hook's registration (`src/harness/shared/stop.ts`) is unchanged: it ensures only when the heartbeat is stale and does not wait for one.

## Other changes

- Type changes, all additive: `RegisterOptions.owesText`, `HarnessDelivery.registrationSent`, `WORKTREE_META_ROWS.registrationOwed`. Removed exports: `ensureToRegister`, `settle`, `SPAWN_SETTLE_MS` (`src/harness/shared/ensure.ts`); no other user. `test/keys/key-format.test.ts` and `test/store/worktree-meta.test.ts` pass with the new row; the row is in `src/core/types/store.ts`, not under `src/core/store/**`.

- `ensure` takes `{ stopRead }` so the stop is not read twice; `stopHeld` is the old first block of `ensure`.
- `registerNow` (`src/core/delivery/delivery.ts`): its transaction went from complexity 22 to 13. `tellAtRegistration` (5) and `seedRegistered` (6) take the tell part and the first-registration part. No behaviour change; `test/delivery/late-paths.test.ts` passes.
- `test/harness/starting-daemon.test.ts`: the test that the registration waits for the heartbeat is replaced by one that the registration comes before the spawn, says "starting", and takes less than `SPAWN_SETTLE_MS`.
- `test/harness/latency.test.ts`: comment only. It runs the committed bundles (`plugins/claude-code/dist`), which this worktree does not rebuild: the latency of the new order is measured once the coordinator builds.
