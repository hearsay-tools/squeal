# 001-415 notes: subagent registrations end, and an unused daemon stops

Wave 14 W2b. Commits: `95ffe6a0` (subagent roots), `9195ac8c` (unused stop), and the rest bound with the spec and notes after them.

## What Claude Code's subagent hooks carry

- **SubagentStart** keys (probe log `research/probes/claude-code-integration/logs/subagent.hooks.trim.jsonl`): `agent_id`, `agent_type`, `cwd`, `hook_event_name`, `prompt_id`, `session_id`, `transcript_path`.
- **SubagentStop** keys: those, plus `agent_transcript_path`, `background_tasks`, `effort`, `last_assistant_message`, `permission_mode`, `session_crons`, `stop_hook_active`.
- `session_id` is the parent's. `agent_id` identifies the subagent: `a` plus 16 hex digits.
- **Where `cwd` comes from:** read in the Claude Code 2.1.x bundle (`claude.exe` strings, no execution). The subagent runner fires SubagentStart (`hook_event_name:"SubagentStart",agent_id,agent_type`) from the shared hook input builder, which reads `cwd` at fire time.
- **Isolated worktrees:** an isolated subagent's worktree is created as `agent-<agent_id>` (`function iDs(e){return\`agent-${e}\`}`, with patterns `^agent-a[0-9a-f]{16}$`).
- **Evidence that `cwd` is the subagent's worktree:** the cezar session's ten daemons in `.claude/worktrees/agent-*` were started by hooks whose `cwd` was those worktrees. Before 001-405, each hook located its own `cwd`.
- **Not run:** an isolated subagent's SubagentStart `cwd` was not verified by experiment. That would need a real `claude` under the `squeal-e2e` user. If it turns out to be the parent's `cwd`, the subagent keeps the session's root, which is no worse than W2. Its leftover consumer then falls to the unused stop.

## Why the daemons lived 10 to 12 hours

SubagentStop already unregisters its consumer (`finishSubagent` in `shared/stop.ts`), but only after it waits up to `stop.waitMs`, capped at 1.5 s, for pending checks. The hook's timeout is 2 s. At load 38 to 48, Node's start plus that wait can outlast the timeout, so the hook is killed before it unregisters. The parent's harness process stays alive, so the consumer is never dropped, and the 12-hour expiry is the only backstop. The unused stop covers this case. A SubagentStop that unregistered before it waited would also help, but that is not done here.

## The unused stop (D10 as amended)

- **Key:** `daemon.unusedExitMinutes`, default 30, in project policy (`squeal.config.json`), beside `daemon.idleExitMinutes`. User config cannot change it. `~/.config/squeal/config.json` holds only capacity today. If the human wants the key host-wide, it would go in `user-config.ts` as a follow-up.
- **When it applies:** only while a consumer is registered. With none, the departure grace or the idle period decides, and a drain keeps its own bound.
- **What counts as use:**
  - The daemon's ready time.
  - Any request through `onActivity`: nudge, retry, run-all, run-slow, and now `sync`, so `status --wait` counts.
  - A new revision (an edit), seen by the check timer comparing `scheduler.status().revision`.
  - `Scheduler.busy()`: in-flight tiers, fast work queued, or slow files pending.
- **What does not count:** hook boundaries are store reads, not requests, so a session that only reads lets the daemon rest. The idle waiter does not count either.
- **Exit:** reason `idle`, one note: "daemon stopped: no edit, run, wait or request for 30 min (daemon.unusedExitMinutes), with N sessions registered; the next hook starts it again".
- **Rest mark:** the stop first writes `daemon-rest:<wt>` = `{ at }` (`markRest`, `src/core/delivery/liveness.ts`).
- **Quiet while it rests:** `livenessChange` treats a cleared record with `at >= lastHeartbeatAt` as no news. Without this, every session that came back after 30 minutes was told "no daemon is validating", and the primer tells agents to run tests themselves on that line.
- **The coordinator's bound:** `ensure()` adds `spawnedAt` at the first spawn after the rest (`spawnedAfterRest`). Once 10 s (`DAEMON_START_GRACE_MS`) passed from it with no heartbeat, the next delivery reports the daemon down and clears the mark.

## Seams

- `src/core/daemon/lifecycle.ts`: `unused(at)`, run by the check timer.
- `src/core/daemon/daemon.ts`: `#lastUsed` and the `work` callback.
- `src/core/scheduler/scheduler.ts`: `busy()`, also added to the `Scheduler` type.
- `src/core/delivery/liveness.ts`: `markRest`, `spawnedAfterRest`, `restState`.
- `src/harness/shared/ensure.ts`: records the spawn.
- `src/core/types/store.ts`: the `daemonRest` row.

## Tests

- `test/daemon/unused-timers.test.ts`: the bound with a consumer registered; an edit, a tier or a request resets it; with no consumer, the idle period applies.
- `test/daemon/unused-stop.test.ts`, with real daemons:
  - A registered consumer's daemon stops, then the next prompt and boundary are silent and restart it.
  - A worktree subagent's SubagentStop lets its daemon exit while the parent stays registered in the main worktree.
- `test/harness/liveness.test.ts`: the rest is quiet at prompt and boundaries; an overdue restart is reported once and the mark is cleared; a mark older than the last heartbeat is not a rest.
- `test/harness/session-root.test.ts`:
  - An isolated subagent validates in its own worktree.
  - A subagent in its parent's worktree is unchanged.
  - A subagent whose start kept nothing falls back to the session's root.
  - Codex subagent threads follow the same rules.
