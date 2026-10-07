# 002 Codex adapter

Stage: approved 2026-10-07. Amendments: `status.md`. Research: `research/codex-hooks.md`, `research/codex-sessions-and-wake.md` (Codex CLI 0.160.1, Linux). Spec 001 is the reference: its D6 (state and delivery views), D9 (the Claude Code adapter), D10 (daemon) and D11 (policy) hold unless a section here says otherwise.

## Problem

Squeal delivers to Claude Code only. The human's Cezar workers run on Codex through `codex app-server`, other sessions run `codex exec` or the TUI, and none of them hears about a `PASS -> FAIL`, is stopped before editing over an undelivered regression, or is told not to run the tests itself. Codex has a near-copy of Claude Code's hook model (research, codex-hooks 2), the core's `HarnessDelivery` is harness-neutral, and the Claude Code hook scripts already carry most of the logic. What is missing is the adapter, its plugin, and an install path that respects Codex's hook trust.

## Goals

Each goal is testable, and each holds under `codex exec`, under a Cezar-shaped `codex app-server` thread (`thread/start`, `turn/start`), and in the TUI.

1. An agent editing a project under validation learns about a `PASS -> FAIL` within one tool call of the result being known, in the same turn, through PostToolUse, without running tests itself.
2. The matching `FAIL -> PASS` arrives the same way. Nothing arrives for `PASS -> PASS` or for an unchanged failure. Several tool calls in one code-mode cell each fire PostToolUse; only the first with news speaks.
3. With `interrupt.onRegression` on, the next `apply_patch` after an undelivered regression is denied once with the regression entries as the reason; the model re-issues the edit. Shell writes are never denied.
4. Stop speaks only with news, as a `block` whose reason is the report; a silent Stop costs no model request; a Stop with `stop_hook_active` never blocks again.
5. A subagent's tool calls deliver only to its consumer `(session_id, agent_id)`; SubagentStop unregisters it; the parent's view is untouched.
6. SessionEnd unregisters at `exec` end, at app-server stdin EOF and at TUI `/quit`; Interrupt ends the consumer's turn; a killed TUI falls to 001 D10's expiry.
7. No hook ever blocks the agent for more than its 2 s timeout, and a dead or missing daemon degrades to silence, as in 001 goal 6. Per-tool hooks at calm load: 80 ms p95 for the Node path, 10 ms p95 for the shell fast path that exits before Node starts.
8. `squeal init --harness codex` makes the plugin installable from this repository with Codex's own commands, writes no user-owned file, and states the trust step; `squeal status` run in a Codex session whose hooks never ran says so.

## Non-goals

- Idle wake. `codex queue --thread <id>` is the one channel that starts a turn on an idle thread (1.5 to 7 s), but it lands as a user-authority prompt, costs a turn, is lost under `exec`, survives the process and fires on a later resume, and cannot reach subagents (research, codex-sessions-and-wake 2). The vision's "pull at the next turn" is the fallback; a wake is a later, policy-gated row at most.
- Delivery relayed by Cezar through `turn/steer` or `thread/inject_items`. Both work (research, 1), but the stdio app-server is private to Cezar, and the relay would be a Cezar change against an experimental Codex API.
- Sandboxed shells. Hooks run unsandboxed in every mode; the agent's shell under `workspace-write` or `read-only` cannot connect to any socket and may not read a WAL store, and neither mode runs on this host (research, codex-hooks 7). Pull from such a shell is best effort and honest.
- Pull credit (board, Later). The shell's `CODEX_SESSION_ID` and `CODEX_THREAD_ID` are recorded for it.
- Writing `AGENTS.md`: it applies with no daemon and edits a project file.
- PermissionRequest, PreCompact and PostCompact hooks; Windows and macOS.

## Design

### D1. Plugin and install

The adapter ships as a Codex plugin in this repository, `plugins/codex/`: `.codex-plugin/plugin.json`, `hooks/hooks.json` in Codex's format with every hook `timeout: 2` (Interrupt and SessionEnd `timeout: 3`, their clamp), commands as `node "${PLUGIN_ROOT}/dist/hooks/<event>.mjs"` or the shell fast path of D4, `skills/squeal/` and `dist/` (committed bundles, D5). The skill's source stays under `plugins/claude-code/skills/squeal/`; `npm run build:plugin` copies it into `plugins/codex/skills/squeal/`, and CI's bundle drift check covers the copy. `bin/` is not on Codex's PATH, so the agent's `squeal` comes from the npm install and hooks call the bundled CLI by path.

The repository's marketplace lists both plugins. Codex's loader accepts `.claude-plugin/marketplace.json` (research, codex-sessions-and-wake 4, read in source code); whether it accepts this repository's file with a second entry is open question 1 and the first wave-0 check. Codex loads a plugin only from `~/.codex/plugins/cache`, enabled in `~/.codex/config.toml`, so no install path avoids a user-file write; Codex makes those writes itself through `codex plugin marketplace add <source>` and `codex plugin add squeal@squeal`. Plugin hooks run only after the user trusts them once (`/hooks` in the TUI, or `hooks.state` in the user config), and a changed command text or a new plugin version needs trust again.

`squeal init --harness codex` writes `squeal.config.json` if absent, prints the two plugin commands and the trust step, and edits nothing under `~/.codex`. `squeal init` without `--harness` keeps today's Claude Code behaviour. For launchers that pass `thread/start` `config`, as Cezar does, `squeal init --harness codex --print-launcher-config` prints the hook declarations in the form Codex accepts there; their `hooks.state` trust hashes are open question 3. A committed `.codex/hooks.json` with absolute command paths is the fallback, and a linked worktree takes the main checkout's `.codex/` (research, codex-hooks 1).

### D2. Consumers and identity

A consumer is `(session_id, agent_id ?? "main")`, both from the hook's stdin; hooks receive no `CODEX_*` variables. `session_id` is the thread id, which the shell sees as `CODEX_SESSION_ID`; a subagent's tool events carry `agent_id`, its own thread id, which its shell sees as `CODEX_THREAD_ID`, and `agent_type`. The consumer record carries `harness: "codex"`, an additive field.

SessionStart `source` values: `startup`, `resume` and `clear` act as 001's `startup` and `resume` (unregister every other consumer of the session, register, inject); `fork` mints a new thread id and is a new consumer; `compact` keeps the view and says only the primer. SessionStart in the TUI runs at the first prompt, not at launch.

### D3. Hooks

- `SessionStart`: ensure the daemon (001 D10, spawned detached with closed stdio so a hook timeout's process-group kill cannot reach it), register, inject the header and the primer as `additionalContext`. The output is capped at 8,000 characters, under Codex's default spill threshold of about 2,500 tokens (research, codex-hooks 3), so the model sees all of it rather than a head, a tail and a file path.
- `PostToolUse`, matcher `*`: `onToolBoundary(consumer)`, the primary push. It fires once per nested tool call and reaches the model before its next step, about 100 ms after the tool output (research, 3). The delivery view makes it idempotent: the second call of a batch finds nothing undelivered. Forks need no special case; Codex subagents are real threads.
- `PreToolUse`, matcher `*`: put an idle consumer back in a turn before the call runs (001 D9 as amended by 001-93). On `apply_patch` with `interrupt.onRegression` on: `permissionDecision: "deny"` with `permissionDecisionReason` built from the regression entries of a `peek`, once per regression, phrased as facts plus one sentence that the edit was not applied and can be re-issued. `Bash` is never denied; the watcher stays the source of truth. `write_stdin` runs no hooks (research, 4) and needs none.
- `Stop`: speak only with news. News is a delta, a first registration carrying known failures, or a policy block; it goes out as `{"decision": "block", "reason": <report>}`, which continues the same turn with the reason as a prompt. Stop has no `additionalContext`, so news at Stop always costs a continuation, and silence costs nothing. When `stop_hook_active` is true, Stop never blocks again, whatever landed since. A silent Stop ends the turn (`endTurn`) and records the pending files as 001 D9 does. `stop.waitMs` (capped at 1,500 ms), `stop.blockOnKnownFailures` and `stop.requireFullSuite` keep their 001 meaning.
- `UserPromptSubmit`: `startTurn`, and the undelivered delta as context on the prompt. It also fires for `turn/steer` and queued input, which are turns too.
- `SubagentStart` and `SubagentStop`: register and unregister `(session_id, agent_id)`; a subagent's own PreToolUse and PostToolUse carry `agent_id`.
- `Interrupt`: `endTurn`, since no Stop follows an interrupt and no PostToolUse follows the interrupted call. One store write, within its 1 to 3 s clamp.
- `SessionEnd`: unregister. It fires at `exec` end, at app-server stdin EOF, at TUI `/quit`, and by the docs after 30 idle minutes with no client; not on a killed TUI.

Output shapes: `hookSpecificOutput.additionalContext` for SessionStart, UserPromptSubmit and PostToolUse; `hookSpecificOutput.permissionDecision` for PreToolUse; `decision` and `reason` for Stop; plain stdout is accepted for context too. Exit 2 with stderr blocks a tool but is not used, because its text is less controlled. Every script exits 0 with no output on any internal error, as in 001.

### D4. Hook processes, budgets and the fast path

A hook runs outside the sandbox, in its own process group, with Codex waiting for its stdout to close; a timed-out hook's group is killed, a completed hook's children live on. A hang, a non-zero exit or invalid JSON is invisible to the model and costs the turn the full timeout, so the 2 s budget and the silent exit are the whole error policy. A trivial hook costs 3 to 14 ms in Codex plus the command's own start, and this host's Node start is 140 to 200 ms under load (research, codex-hooks 6), so the per-call hooks, PreToolUse and PostToolUse, run behind the same POSIX `sh` test 001 D9 uses: Squeal is found from the hook's working directory, else the script exits 0 before Node starts. Whether the hook's working directory is the thread's `cwd` is open question 2 and a wave-0 measurement; if it is not, the fast path reads `cwd` from stdin with `sh` alone.

### D5. Shared hook code and bundles

The harness-neutral logic now under `src/harness/claude-code/hooks/` (register and inject, deliver, peek and deny, Stop news and turn state, sweep, ensure) moves to `src/harness/shared/`, and both adapters import it. `src/harness/codex/` holds the stdin parser (`session_id`, `agent_id`, `turn_id`, `cwd`, `tool_name`, `stop_hook_active`, `source`, `hook_event_name`), the output shapes of D3, the entries, the `hooks.json` builder and the build step; `plugins/codex/dist/` is committed like `plugins/claude-code/dist/`, the drift check and the version-raise rule cover both. The Claude Code bundles keep their behaviour: their recorded-JSON tests pin it, and the move is a slice with no behaviour change, verified by those tests before any Codex entry exists.

### D6. Status under Codex

`squeal status` and the header are unchanged. Run in a shell where `CODEX_SESSION_ID` is set and no consumer of that session exists, `squeal status` adds one line: Codex hooks have not run in this session, with the trust step. Untrusted hooks are skipped silently by Codex, so this line is the only place a user learns why Squeal is quiet.

### D7. Daemon and worktrees

001 D10 holds. A daemon spawned by a hook outlives the turn and the session in every mode (research, codex-sessions-and-wake 6). Codex worktrees sit at `$CODEX_HOME/worktrees/<4 hex>/<repo>` with a detached HEAD and the source repository's common dir, so they share its store by 001 D1; Codex removes one without a process check, which 001's placement rules (waves 7.6b to 7.7) already tolerate. Each create makes a fresh bucket, so Codex never reuses a worktree path across repositories.

### D8. Policy

No new keys. `interrupt.onRegression` governs the `apply_patch` deny. 001 D11 is amended by reference: "the Claude Code plugin" becomes "the harness plugin".

## Testing

- Recorded hook JSON from `research/probes/codex-hooks/logs/` and `research/probes/codex-sessions-and-wake/` becomes fixtures under `test/fixtures/codex-hooks/`: every event under `exec`, app-server and the TUI; subagent events with `agent_id`; Stop with and without `stop_hook_active`; Interrupt; SessionEnd reasons; SessionStart sources `startup`, `resume`, `fork`, `clear`, `compact`.
- Unit tests on the entries: output shapes of D3; PostToolUse idempotency over three calls with one transition; the deny once per regression and never on `Bash`; the `stop_hook_active` guard; Interrupt and silent Stop end the turn; SessionEnd unregisters; consumer keys for main and subagent events; the 8,000-character cap.
- Bundled hooks: p95 under 80 ms at calm load (asserted as 001 does, skipped above a load threshold), the shell fast path under 10 ms, exit 0 and silence with no store, no config and a newer schema.
- The shared-code move: the Claude Code recorded-JSON and e2e suites green with no fixture change.
- End to end, as 001's `test/e2e`: the Codex plugin archived from HEAD, a fixture repository, hook bundles driven by recorded JSON, daemons spawned by the bundles; transitions, lifecycle, policy and worktrees parametrized over the two plugins.
- Proof: in a scratch repository with the plugin installed and trusted, one `codex exec` run and one Cezar-shaped app-server thread show that SessionStart registers `(session_id, main)` and injects the header and primer; a `PASS -> FAIL` reaches the model through PostToolUse in the same turn; a subagent's call delivers only to `(session_id, agent_id)`; SessionEnd unregisters at `exec` end and at stdin EOF; every hook exits 0 within budget with no daemon. Then a dogfooding row: a Cezar worker on Codex working this repository or cezarion with the plugin, reported in `lessons.md`.

## Open questions

Owner is the coordinator unless noted.

1. Does Codex accept this repository's `.claude-plugin/marketplace.json` with a second entry at `./plugins/codex`, or does the Codex plugin need its own marketplace file? Wave-0 experiment.
2. Is a hook's working directory the thread's `cwd`? Decides the shape of the D4 fast path. Wave-0 measurement.
3. How Codex computes a hook's `trusted_hash`, so `--print-launcher-config` can emit `hooks.state` entries for Cezar and a plugin update can be re-trusted without the TUI. Read in source; a later row if feasible. Whether plugin trust survives a plugin update is expected to be no, since the key holds the cache path.
4. Sandboxed shells: whether `squeal status` under `workspace-write` can read the WAL store read-only, and how a connect refusal reads. Needs a host where bubblewrap works.
5. A long-running command that yields to `write_stdin` delivers its PostToolUse late. Measure during dogfooding.
6. Idle wake through `codex queue`: whether the human wants a policy-gated wake for TUI and app-server sessions, never under `exec`. Human.

## References

- ADR 0004: `../../decisions/0004-codex-and-node-test-next.md`.
- Spec 001: `../001-core-loop/spec.md` D6, D9, D10, D11, D12.
- Research: `research/codex-hooks.md`, `research/codex-sessions-and-wake.md`, and from 001 `research/claude-code-integration.md` section 7, `research/pull-advances-push.md` question 4, `research/daemon-under-harnesses.md`.
- Cezar's Codex runner: the installed cezarion `dist/core/codex-app-server-runner.js`, `dist/core/codex-permissions.js`.
