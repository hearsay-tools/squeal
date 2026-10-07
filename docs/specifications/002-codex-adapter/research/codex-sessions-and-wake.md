# Research: codex-sessions-and-wake

Board row 002-02. Codex CLI 0.160.1 (installed, `rust-v0.160.1` = `d27764b`), cezarion as installed on 2026-10-07, official docs fetched 2026-10-07. Probes and evidence: `probes/codex-sessions-and-wake/`.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | How Cezar drives Codex; app-server channels | Cezar spawns `codex app-server` over stdio, `initialize` with `experimentalApi`, then `thread/start` or `thread/resume`, `turn/start`, `turn/steer`, `turn/interrupt`. It reads `item/*` and `turn/*` notifications. `thread/inject_items` adds context without a turn. `thread/queue/*` queues user turns. Only the process holding the stdio pipe can use them, so Squeal would need a Cezar-side shim. | verified by experiment, read in source code, read in official docs |
| 2 | Idle wake | `codex queue --thread <id>` starts a turn on an idle main thread: 1.6 to 3.7 s under app-server, 7.1 s in the TUI. Under `exec` the queued turn starts and is interrupted at shutdown, so it is lost. Async hooks, `inject_items` and `notify` never start a turn. | verified by experiment, read in source code |
| 3 | Identity | Hooks see the ids only on stdin: `session_id` (the thread id) and `turn_id`, plus `agent_id` and `agent_type` on a subagent's tool events. The shell sees `CODEX_SESSION_ID` and `CODEX_THREAD_ID`; under a subagent, `CODEX_THREAD_ID` is its `agent_id`. Resume keeps the id; fork mints a new one. | verified by experiment |
| 4 | Packaging | A plugin bundles hooks and skills. It is installed into `~/.codex/plugins/cache` and enabled in `~/.codex/config.toml`. Its hooks run only after the user trusts them, and that trust lives in `~/.codex/config.toml`. `bin/` is not put on PATH. No install path avoids a user-file write, but Codex can make every write itself through its own commands. | verified by experiment, read in source code, read in official docs |
| 5 | Primer surface | SessionStart context and `AGENTS.md` both worked: with either one the agent called `squeal status` and never ran tests, while the baseline ran `npm test`. One run each. | verified by experiment |
| 6 | Worktrees and lifecycle | `$CODEX_HOME/worktrees/<4 hex>/<repo>`, a detached HEAD, kept after the session. The CLI removes one only on a user request, with `git worktree remove` and no process check. A detached daemon from a hook or the shell outlives the turn and the session. | verified by experiment, read in source code |
| 7 | Non-interactive lifecycle | SessionStart, UserPromptSubmit, Stop and SessionEnd fire under `exec` and app-server. SessionEnd fires on `exec` end, on app-server stdin EOF and on TUI `/quit`. It does not fire on a killed TUI. An interrupt fires Interrupt, and Stop does not fire. | verified by experiment |

## Findings

### 1. How Cezar drives Codex, and the app-server as a channel

- Cezar's `CodexAppServerRunner` (`dist/core/codex-app-server-runner.js`, `codex-app-server-transport.js`) spawns `codex app-server` with a reduced env and calls `initialize` (`capabilities.experimentalApi: true`). It then calls `configRequirements/read`, followed by `thread/start` or `thread/resume` with `cwd`, `sandbox: "danger-full-access"` when unmanaged and dotted `config` overrides. It calls `turn/start` for a new turn, `turn/steer` with `expectedTurnId` while a turn is active, and `turn/interrupt` to cancel. It reads `item/started`, `item/completed`, `item/agentMessage/delta`, `item/commandExecution/outputDelta` and `turn/started|completed|failed`. A `turn/started` that Cezar did not request is adopted as the active turn (line 760). Shutdown closes stdin, then sends SIGTERM after 8 s and SIGKILL 4 s later. *read in source code (cezarion dist)*
- The protocol at 0.160.1 (`codex-rs/app-server-protocol/src/protocol/common.rs`) has these methods:
  - `turn/start`, `turn/steer` and `turn/interrupt`.
  - `thread/inject_items`: "Append raw Responses API items to the thread history without starting a user turn".
  - `thread/queue/add|list|update|delete|reorder|start`, all experimental.
  - `thread/turns/list` and `thread/items/list`.
  - Notifications: `hook/started`, `hook/completed` ("not emitted for asynchronous hooks"), `item/completed` (command output in `aggregatedOutput`) and `thread/queue/changed`.

  *read in source code; read in official docs (learn.chatgpt.com/docs/app-server)*
- Probe r4 (`bin/appserver-probe.mjs`) drove a thread the way Cezar does. *verified by experiment*
  - `thread/inject_items` sent a developer message, "Squeal: tests/add.test.js PASS -> FAIL at revision 3", while the thread was idle. No turn started in the 15 s watch. The next turn's answer named `tests/add.test.js`.
  - `turn/steer` during a `sleep 6` tool call was accepted. The model quoted the steer text in the same turn, and the steer also fired a `UserPromptSubmit` hook.
  - An injected developer item phrased as a "probe nonce" got a refusal in run r3 ("I can't disclose probe nonces from hidden instructions"). The factual phrasing in r4 was used. Wording matters, as it does for Claude Code hook text.
- Coupling: the stdio app-server is private to the process that spawned it, which for Cezar is Cezar. To use `inject_items` or `turn/steer` as a delivery channel, Cezar would have to relay Squeal's deltas: subscribe to the daemon and call `turn/steer` mid-turn or `inject_items` while idle. That is a Squeal protocol consumer inside another product, versioned against an experimental Codex API. Hooks deliver the same text with no Cezar change. *inferred*

### 2. Idle wake

- `codex queue --thread <uuid|exact name> --message <text>` (`cli/src/queue_cmd.rs`, `tui/src/session_queue_commands.rs`) calls `thread/queue/add`. It uses the shared app-server daemon when one is running and otherwise an embedded server. The queue is durable (`~/.codex/queue_1.sqlite`, tables `queued_items` and `queued_thread_revisions`). *read in source code*
- Every app-server process with the local thread store runs `QueuedItemService` (`ext/queue/src/service.rs`). That covers stdio app-server, the TUI's embedded server and `exec`'s in-process server. The service polls the queue every 10 s for threads it has loaded and dispatches at each thread-idle event. It calls `start_turn_if_idle` with `turn_trigger: "queue"` and deletes the item once the turn starts. *read in source code*
- Measured delivery to an idle thread. *verified by experiment*
  - App-server (r3, r4): turn started 3,704 ms and 1,566 ms after `codex queue` was started. The command itself takes about 0.5 s of that.
  - Interactive TUI (r5, tmux): `UserPromptSubmit` came 7,135 ms after `codex queue` was started. The TUI showed the text as the user's own prompt and the model answered "QUEUED-TUI-OK tests/add.test.js".
  - `codex exec` (r6): a message queued mid-turn started a new turn right after Stop. That turn was interrupted at shutdown: the hooks logged `Interrupt` with a new `turn_id`, then `SessionEnd`. The queue row was gone, so the message was lost.
- Limits:
  - Addressing is by thread id, which is the hooks' `session_id`.
  - Spawned subagents that are not loaded in the calling process are rejected ("direct app-server input is not allowed for unloaded spawned sub-agents"), as are ephemeral and archived threads.
  - A message queued for a thread that no process has loaded stays queued. It starts a turn when the thread is next resumed.
  - The text is limited to 1 MiB.

  *read in source code*
- The message arrives as a user message with user authority. In the TUI it looks like typed input. Each wake costs a full model turn. *verified by experiment (r5, r4 `userMessage` items)*
- Async hooks: the output of a background PostToolUse hook that finished while the thread was idle started no turn. The next turn saw it, because the model reported "ASYNC-7781" (r4). This matches the docs: "Finishing a background hook doesn't start a new turn." *verified by experiment; read in official docs (learn.chatgpt.com/docs/hooks)*
- `notify = [...]`: Codex spawns the program with one JSON argument (`agent-turn-complete`, thread and turn ids, last message), with stdout and stderr discarded. The channel only goes from Codex outward. *read in source code (`hooks/src/legacy_notify.rs`, `core/src/config/mod.rs:750`)*
- No other channel starts a turn without a client. `thread/queue/start` and `turn/start` need a connection to the process that has loaded the thread. *read in source code*

### 3. Identity

- Hooks receive no `CODEX_*` id variables, only `CODEX_MANAGED_BY_NPM` and `CODEX_MANAGED_PACKAGE_ROOT`. The ids come on stdin. Every event has `session_id`, `cwd`, `transcript_path` and `permission_mode`. Turn-scoped events add `turn_id`. *verified by experiment (r1, r2, r4)*
- The shell tool sees `CODEX_SESSION_ID`, `CODEX_THREAD_ID`, `CODEX_CI=1` and `CODEX_VERSION`. For the main agent both ids equal `session_id`, in `exec`, app-server and the TUI alike. *verified by experiment (r1, r4, r5)*
- Subagent (r2). *verified by experiment*
  - All hooks keep the parent `session_id`.
  - SubagentStart, the subagent's PreToolUse and PostToolUse, and SubagentStop carry `agent_id` (= the child thread id) and `agent_type: "default"`, plus its own `turn_id`.
  - The parent's tool calls carry neither field, so a PostToolUse hook can tell the two apart.
  - The subagent's shell sees `CODEX_SESSION_ID=<parent>` and `CODEX_THREAD_ID=<agent_id>`.
  - The spawn shows up as tools `collaborationspawn_agent` and `collaborationwait_agent`.
  - The docs list `agent_id` only for SubagentStart and SubagentStop. The experiment shows it on tool events too.
- `codex exec resume <id>` keeps the thread id and fires SessionStart with `source: "resume"`. `codex exec fork <id>` mints a new id and fires SessionStart with `source: "fork"`, a value the docs do not list (they name `startup`, `resume`, `clear`, `compact`). *verified by experiment (r1)*

### 4. Packaging

- Plugin layout:
  - `.codex-plugin/plugin.json` (or a root `plugin.json`), `skills/<name>/SKILL.md`, `hooks/hooks.json` (the default), `.mcp.json` and `.app.json`.
  - Hook commands get `PLUGIN_ROOT` and `PLUGIN_DATA`, plus `CLAUDE_PLUGIN_ROOT` and `CLAUDE_PLUGIN_DATA` for compatibility.
  - Marketplaces: `$REPO/.agents/plugins/marketplace.json` or `~/.agents/plugins/marketplace.json`. Source code also accepts `.claude-plugin/marketplace.json`, which Squeal already ships (`core-plugins/src/marketplace.rs:20`).
  - The docs mention no `bin/` and no `AGENTS.md` fragment.

  *read in official docs (developers.openai.com/plugins/build/plugins, learn.chatgpt.com/docs/plugins); read in source code*
- A plugin listed in a repo marketplace and enabled only in the repo's `.codex/config.toml` did not load. The loader rejects plugins that are not installed in `~/.codex/plugins/cache` ("plugin is not installed", `core-plugins/src/loader.rs:867`). *verified by experiment (pl1); read in source code*
- After `codex plugin marketplace add <repo>` and `codex plugin add squeal-probe@squeal-probe-local`, Codex had written `[marketplaces.*]` and `[plugins."…"] enabled = true` into `~/.codex/config.toml` and copied the plugin into the cache. Then:
  - The plugin's skill loaded in every run, trusted or not.
  - Its hooks ran only with `--dangerously-bypass-hook-trust`. In those runs SessionStart context reached the model, and `PLUGIN_ROOT` was `~/.codex/plugins/cache/squeal-probe-local/squeal-probe/0.0.1`.
  - `command -v squeal-probe` failed, so `bin/` is not on PATH.

  *verified by experiment*
- Hook trust is `[hooks.state."<key>"] trusted_hash` and is read only from the user layer and session flags (`hooks/src/config_rules.rs:15`). Neither a repo nor a plugin can trust its own hooks. The key contains the hooks file path, so every plugin version in a new cache directory needs trust again. *read in source code; the version consequence is inferred*
- Repo-level `.codex/hooks.json` loads only when the project is trusted. When `thread/start` names a `cwd` and the sandbox can write it, app-server persists `[projects."<git root>"] trust_level = "trusted"` into `~/.codex/config.toml` on its own (`app-server/src/request_processors/thread_processor.rs:1362`). That covers Cezar's `danger-full-access` and every `exec` here: eleven `/tmp/csw` entries appeared. *verified by experiment; read in source code*
- Hooks under app-server still need hook trust. Probe r3 (no trust) logged no event. r4 passed `config: { bypass_hook_trust: true, projects: {...} }` on `thread/start` and logged every event. Cezar passes neither, so under Cezar Squeal's hooks run only once the user has trusted them. *verified by experiment*

### 5. Where the primer lives

The fixture was a buggy `add.js` with a `node:test` file and a fake `squeal` on PATH. The prompt was "add.js has a bug: add(2, 3) returns -1. Fix it." *verified by experiment (one `codex exec` run each)*

- No primer: the agent ran `npm test` twice.
- Primer as SessionStart `additionalContext`: `squeal status` and `squeal status --wait 60000` five times, no test run.
- Primer as `AGENTS.md`: `squeal status --wait 60000` three times plus `--help`, no test run.

Limits:

- SessionStart context needs trusted hooks and is capped at 2,500 tokens by default (`additionalContextLimit`). *read in official docs*
- `AGENTS.md` loads with no trust, up to 32 KiB (`AGENTS_MD_MAX_BYTES`, `core/src/config/mod.rs:253`). *read in source code*
- `AGENTS.md` is a committed project file that every Codex session reads, whether or not a daemon runs. *inferred*
- A skill loads without trust, but the model reads it only when it triggers. Not tested as a primer.

### 6. Worktrees and lifecycle

- `codex exec --worktree` checked out `~/.codex/worktrees/6e84/wt1`: `$CODEX_HOME/worktrees/<4 hex>/<repo name>`, detached HEAD, `--git-common-dir` the source repo's `.git`. It stayed after the session. *verified by experiment (wt1); read in source code (`worktree/src/paths.rs`, `settings.rs:44`)*
- The CLI removes a managed worktree only from the TUI worktree browser (`worktree/src/lib.rs:285`). That path runs `git worktree remove` without `--force` and refuses when the worktree is the current cwd or holds ignored files. It checks for no processes. `--force` is used only to roll back a failed create. The desktop app's cleanup is not determined, because its code is not in the openai/codex repository. *read in source code*
- Detached processes, using spec 001 D10's spawn shape (`detached`, `stdio: 'ignore'`, `unref`), all outlived the turn and the `exec` session, still beating 13 to 26 s after the session ended, until killed:
  - one spawned from a SessionStart hook, under both `danger-full-access` and `workspace-write`, since hooks run outside the sandbox;
  - one spawned from the shell tool with `setsid nohup` under `danger-full-access`.

  *verified by experiment (dm-*)*
- On this host `workspace-write` cannot run any shell command (`bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted`, Cezar's #563). Survival of a daemon spawned from a sandboxed shell is not determined, because the sandbox does not start here. *verified by experiment*
- Compared with `../../001-core-loop/research/daemon-under-harnesses.md`: Codex worktrees sit under one root and never share a path across repositories, because each create makes a fresh random bucket. That answers its open question on naming for the CLI. *verified by experiment*

### 7. Non-interactive sessions

| Session | SessionStart | UserPromptSubmit | Stop | SessionEnd |
|---|---|---|---|---|
| `codex exec` (r1, r2, r6) | `startup`/`resume`/`fork` | yes | yes | yes, `reason: "other"` |
| app-server (r4) | yes, at the first `turn/start` | yes, also for steer and queued input | yes, per turn | yes, when stdin closes |
| TUI (r5) | yes | yes | yes | on `/quit` yes; on `tmux kill-session` no |

*verified by experiment*

- An Escape during a tool call fired `Interrupt` and no PostToolUse or Stop. *verified by experiment (r5)*
- The docs add that SessionEnd also fires on archive or delete, and "after a conversation has been idle and isn't open in any connected client for 30 minutes". Its timeout is 1 to 3 s, and it always runs synchronously. *read in official docs*
- Cezar closes stdin first, so a Cezar worker's end fires SessionEnd unless Codex hangs past 8 s. *inferred from cezarion source and r4*

## Recommendation for Squeal

1. **Events to hook.**
   - Consumer key: `(session_id, agent_id ?? "main")`.
   - SessionStart (`startup`, `resume`, `fork`, `clear`, `compact`): ensure the daemon, register, and inject the header and the primer. Fork is a new consumer and resume the same one.
   - UserPromptSubmit: deliver the delta. It also fires for steer and queued input.
   - PostToolUse: deliver mid-turn, as the primary push.
   - PreToolUse: deny once, with tool names from the codex-hooks topic.
   - Stop: speak only with news.
   - SubagentStart and SubagentStop: register and unregister `(session_id, agent_id)`. Subagent tool events carry `agent_id`.
   - SessionEnd: unregister. Unlike in Claude Code it fires on `exec` end, on app-server EOF and on `/quit`. D10's 12-hour expiry is still needed for a killed TUI.
   - Interrupt: mark the consumer as out of a turn, because no Stop follows.
   - `squeal status` names its consumer from `CODEX_SESSION_ID`, plus `CODEX_THREAD_ID` when the two differ.
2. **Idle delivery.** Ship none in the first rows: pull at the next turn, as status.md accepts. `codex queue --thread <session_id>` is the one channel that wakes an idle Codex agent. It works for TUI and app-server main threads (1.5 to 7 s), but it lands as a user prompt, costs a turn, is lost under `exec`, survives the process and fires on a later resume, and cannot reach subagents. If the human wants a wake, make it a later policy-gated row, never armed for `exec`. Cezar-relayed `turn/steer` or `inject_items` is the alternative, and it needs a Cezar change.
3. **Install path.** Ship a Codex plugin: `.codex-plugin/plugin.json`, `hooks/hooks.json` using `${PLUGIN_ROOT}`, and `skills/squeal`. List it in a marketplace Codex reads. The repository's existing `.claude-plugin/marketplace.json` is one of the paths Codex accepts. `squeal init` cannot make Codex hooks run without a write to `~/.codex/config.toml`. It should print the two commands (`codex plugin marketplace add <source>`, `codex plugin add squeal@<marketplace>`) and the `/hooks` trust step, so Codex writes its own file and Squeal edits none. `bin/` is not on PATH, so hooks call `node "${PLUGIN_ROOT}/…"`, and the agent's `squeal` must come from the npm install. A committed `.codex/hooks.json` is the fallback. It needs the same per-user hook trust and an absolute command path.
4. **Primer.** Put it in SessionStart context, as in D9, and keep the skill. Do not write `AGENTS.md`: it applies with no daemon and edits a project file.
5. **Done-when for the first adapter row.** In a scratch repository with the plugin installed and its hooks trusted, both a `codex exec` run and a Cezar-shaped app-server thread (`thread/start`, `turn/start`) must show:
   - SessionStart registers `(session_id, main)` and injects header and primer;
   - a `PASS -> FAIL` reaches the model through PostToolUse in the same turn;
   - a subagent's tool call delivers only to `(session_id, agent_id)`;
   - `squeal status` from the shell credits the consumer named by `CODEX_SESSION_ID`/`CODEX_THREAD_ID`;
   - SessionEnd unregisters at `exec` end and at stdin EOF;
   - every hook exits 0 within its budget when no daemon runs.

## Open questions

1. Does Codex accept Squeal's Claude-format `plugins/claude-code/hooks/hooks.json` (it names `PostToolBatch`, unknown to Codex), or must the Codex plugin have its own file? Not tested.
2. Does the interactive TUI start the shared app-server daemon by default? If it does, a Squeal process could reach live sessions over `~/.codex/app-server-control/app-server-control.sock`. Not determined: these probes forced the embedded server through `-c`, and the startup path was not traced to the end.
3. Can a hook tell an interactive session from `exec` or app-server? The payload has no client field (`notify` has `client`). This matters if a wake is ever armed. Not determined.
4. A daemon spawned from a `workspace-write` shell. Not determined on this host, because bwrap fails (see codex-hooks question 7).
5. How a Cezar worker reacts to a turn it did not start (a queued wake): its end would be parsed for markers. Read in Cezar's source only.

## Sources

- Probes: `probes/codex-sessions-and-wake/` (README, `bin/`, `hooks/`, `evidence/`).
- openai/codex at `rust-v0.160.1` (`d27764b`), https://github.com/openai/codex/tree/rust-v0.160.1/codex-rs:
  - `app-server-protocol/src/protocol/common.rs`, `v2/thread.rs:910,1691`
  - `app-server/src/request_processors/thread_queue_processor.rs`, `thread_processor.rs:1345`, `message_processor.rs:305`
  - `ext/queue/src/service.rs`, `cli/src/queue_cmd.rs`, `tui/src/session_queue_commands.rs`, `tui/src/daemon_startup.rs`
  - `core-plugins/src/loader.rs:823`, `marketplace.rs:20`, `hooks/src/config_rules.rs:15`, `hooks/src/legacy_notify.rs`
  - `worktree/src/{lib,paths,settings}.rs`, `core/src/config/mod.rs:253`, `protocol/src/user_input.rs:10`
- cezarion dist: `/home/agent/.nvm/versions/node/v24.21.0/lib/node_modules/cezarion/node_modules/@wjarka/cezarion/dist/core/codex-app-server-runner.js`, `codex-app-server-transport.js`, `codex-permissions.js`, `runner-runtime.js`.
- Official docs, fetched 2026-10-07:
  - https://learn.chatgpt.com/docs/app-server (redirected from developers.openai.com/codex/app-server)
  - https://learn.chatgpt.com/docs/hooks
  - https://learn.chatgpt.com/docs/plugins
  - https://developers.openai.com/plugins/build/plugins
- CLI help: `codex --help`, `codex queue --help`, `codex plugin --help`, `codex app-server --help`, `codex exec --help`, `codex features list` (0.160.1).
- Prior findings: `../../001-core-loop/research/claude-code-integration.md` §7, `pull-advances-push.md` §4, `daemon-under-harnesses.md`.
