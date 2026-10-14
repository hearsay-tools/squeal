# Research: opencode-sessions-and-wake

Board row 008-02. OpenCode 1.18.35 (npm `opencode-ai`, Bun 1.3.14 inside; source `sst/opencode` tag `v1.18.35` = `53d1eab`). Cezarion as installed on 2026-10-14 (`@wjarka/cezarion` 0.16.0-dev.1634). Probes ran as `squeal-e2e` on model `cliproxy/gpt-6-luna`. Evidence: `probes/opencode-sessions-and-wake/` (README lists each run; `logs/raw/`).

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | How Cezar drives OpenCode | One `opencode serve --hostname 127.0.0.1 --port <random>` per session, as a process-group leader with cwd at the worktree. It talks HTTP and SSE with no password: `POST /session` or `GET /session/{id}` to resume, `POST /session/{id}/prompt_async` to start and to steer, `GET /event` to read, `POST /session/{id}/abort`, then SIGTERM to the group and SIGKILL 4 s later. The server could carry deltas, but a plugin can reach the same API in-process, so it adds no channel and only couples Squeal to Cezar. | read in source code |
| 2 | Idle wake | A plugin's own `client.session.promptAsync` starts a turn on an idle session: 18 ms to busy under `serve`, 16 ms in the TUI. An outside `curl` to `prompt_async` works too, but only under `serve`; `run` and the TUI open no port. Under `opencode run` the process exits at idle, so the wake turn never runs, but its message is stored and `--continue` sees it. `/tui/append-prompt` and `/tui/submit-prompt` start nothing without a TUI. | verified by experiment |
| 3 | Identity | The shell sees only `OPENCODE=1` and `OPENCODE_PID` (the OpenCode process, equal to the plugin's `process.pid`), with no session id. The plugin's `shell.env` hook receives `{cwd, sessionID, callID}` and can export them; the child session's shell then got the child's id. Hooks carry `sessionID`; a subagent is a child session whose `session.created` has `info.parentID`. `--continue` and `--session` keep the id; `--fork` mints a new one. | verified by experiment |
| 4 | Packaging and install | Three surfaces. (a) `plugin/*.{js,ts}` files are discovered in every config directory: global, `.opencode`, `$OPENCODE_CONFIG_DIR`. (b) npm specs in a `plugin` list, installed into `~/.cache/opencode/packages/<spec>` and never refreshed. (c) `opencode plugin <spec> -g`, which installs the package and writes the global `opencode.jsonc` itself. A plugin brought a skill and an instruction file through its `config` hook, and a command on the shell's `PATH` through `shell.env`. | verified by experiment, read in source code |
| 5 | Lifecycle | Start: `session.created` (new sessions only), and `chat.message` for every user message, the first after a resume included. End: no event. `dispose` ran at `run` exit and at the TUI's SIGHUP, but not at `serve` SIGTERM, which is how Cezar stops it. Children a plugin spawns, attached or detached, outlive the process; only a detached one leaves its process group. | verified by experiment |
| 6 | Worktrees | `run`, `serve` and the TUI never create or remove worktrees. Only the experimental `/experimental/worktree` routes do (web or desktop app), under `~/.local/share/opencode/worktree/<project id>/`, removing with `git worktree remove --force`. In a Cezar-style linked worktree the plugin sees `worktree` = the linked worktree's root and `directory` = the cwd. | verified by experiment (directory, worktree), read in source code (placement) |

## Findings

### 1. How Cezar drives OpenCode

All citations in this section are `dist/core/opencode-server-runner.js` unless named. *read in source code*

- **Server.** `OpencodeServerRunner` spawns `opencode serve --hostname 127.0.0.1 --port <40000-59999>` through `spawnSessionLeader` (`detached: true`, so the server leads its own process group), with cwd at the run's worktree (l. 490-500). The env comes from `buildChildEnv`. `OPENCODE_CONFIG_CONTENT` carries only Cezar's MCP CI tool (`ci-wait/injection.js`).
- **Sessions.** It creates a session with `POST /session` (`title: "cezar task"`, plus an optional `permission` rule denying `task`). It resumes with `GET /session/{id}`, falling back to a fresh session on 404. It subscribes to `GET /event` before the first prompt.
- **Prompts and steering.** Every prompt is `POST /session/{id}/prompt_async` with text parts, `model` and `variant`. Mid-turn input uses the same call ("the running prompt loop rereads it between steps", l. 778). Cezar counts steered input as consumed when an assistant `message.updated` names its user message as `parentID`. It re-submits input left unconsumed after idle (2 s grace, upstream issue `anomalyco/opencode#46842`).
- **Turn end and teardown.** The end of a turn is `session.idle` for its own `sessionID`; child sessions are filtered out (l. 1012-1018). Interrupt is `POST /session/{id}/abort`, then SIGTERM to the group, then SIGKILL after 4 s (l. 440-486). Questions go through `GET /question` and `POST /question/{id}/reply|reject`.
- **Auto-end.** A non-interactive step sets `autoEndAfterFirstTurn` (`workflows/run.js:7242`), which ends the server 250 ms after idle (`runner-runtime.js` `AUTO_END_DELAY_MS`).
- **As a channel.** Any local process of the user can reach this server: it binds 127.0.0.1 with no password (s1's stderr: "OPENCODE_SERVER_PASSWORD is not set; server is unsecured"). A plugin inside it already holds a client to the same API (finding 2), so the port adds no capability. Using it from Squeal would mean discovering a random port, a path that only exists under `serve`, and racing Cezar's bookkeeping. *inferred*

### 2. Idle wake

- **Plugin client.** Plugins receive `client`. When no server listens, its `fetch` is `Server.Default().app.fetch` in-process (`plugin/index.ts:145-151`). `serverUrl` is then the placeholder `http://localhost:4096/`, which is what `run` and the TUI reported; under `serve` it was `http://127.0.0.1:4298/`. *read in source code; verified by experiment*
- **`serve` (s1).** The plugin called `promptAsync` 3 s after the first idle. The session went busy 18 ms later, and the model answered "WAKE-OK" 1.9 s after the call. An outside `curl` to `prompt_async` was busy 46 ms after the script's mark and was answered "OUTSIDE-OK". Both arrived as ordinary `user` messages, agent `build`. *verified by experiment*
- **TUI (t1, tmux).** The same plugin wake went busy 16 ms after the call. The pane shows the Squeal text as a user prompt, followed by "WAKE-OK". *verified by experiment*
- **`opencode run` (r1).** The plugin called `promptAsync` inside the `session.idle` hook, and the call returned 204. But `run` stops at the first `session.status` idle (`cli/cmd/run.ts:794-798`): the session went idle again 20 ms later, `dispose` ran and the process exited, with no assistant reply. The message was kept: r2 (`--continue`) quoted it verbatim as an earlier user message. *verified by experiment*
- **TUI control routes.** Under `serve` with no TUI attached, `POST /tui/append-prompt` and `/tui/submit-prompt` returned `true`. They only published `tui.prompt.append` and `tui.command.execute` bus events; no turn started. *verified by experiment*
- **Cezar.** Inside Cezar, a woken turn is not one of Cezar's submissions, so Cezar opens no turn for it. The assistant parts still stream to its transcript. In a non-interactive step, auto-end fires 250 ms after the earlier idle, so a later wake dies with the server, and its message waits in the session for a Continue. The interactive last step keeps the server open. *inferred from source, not run under Cezar*

### 3. Identity

- **Shell.** Main agent and subagent alike see `OPENCODE=1` and `OPENCODE_PID=<opencode pid>`, set at startup (`index.ts:76-77`). That pid matched the plugin's `process.pid` in every run, `run`, `serve` and TUI. There is no session id variable. *verified by experiment (r1, r2, r3, s1)*
- **`shell.env` hook.** It is called with `{cwd, sessionID, callID}`, and its `env` is merged over `process.env` for each bash call (`tool/shell.ts:416-425`). The probe's `PROBE_SESSION_ID` was the main session's id in the main shell and the child session's id in the subagent's shell, with each call's `callID`. *verified by experiment (r1)*
- **Subagents.** A `task` call fires `tool.execute.before` in the parent. Then `session.created` arrives with `info.parentID` = the parent session, then `chat.message` with `agent: "general"` and that child's own tool hooks. `tool.execute.*` inputs carry only `{tool, sessionID, callID}`, so a plugin tells a child from the main agent by the `parentID` it saw at `session.created`, or from `client.session.get` after a resume. *verified by experiment (r1); the resume case inferred*
- **Resume and fork.** `--continue` and `--session <id>` kept the id, and the resumed process fired no `session.created`. `--fork` minted a new id with no `parentID` (r3). Cezar's Continue reuses the id through `GET /session/{id}`. *verified by experiment; read in source code (Cezar)*

### 4. Packaging and install

- **File plugins.** `{plugin,plugins}/*.{ts,js}` are loaded from every config directory (`config/plugin.ts:21`, `config/paths.ts:23-41`):
  - `$XDG_CONFIG_HOME/opencode`;
  - each `.opencode` from the cwd up to the worktree root;
  - `~/.opencode`;
  - `$OPENCODE_CONFIG_DIR`.

  Bun imports them directly. *read in source code; verified for `.opencode` and `OPENCODE_CONFIG_DIR` (r4)*
- **npm plugins.** Specs come from the `plugin` list of any config: global, project, `OPENCODE_CONFIG`, or `OPENCODE_CONFIG_CONTENT`. Arborist installs each into `$XDG_CACHE_HOME/opencode/packages/<spec>/` with `ignoreScripts`. A bare name becomes `<name>@latest`, and an existing directory is reused with no update check (`core/src/npm.ts:123-145`, `plugin/shared.ts:207-212`). So an update arrives only through a new spec (a new version pin) or a deleted cache. `engines.opencode` is enforced. *read in source code*
- **`opencode plugin <spec> -g` (p1).** It installed `file:<cfgdir/pkg>` into the cache, wrote `"plugin": ["file:…/pkg"]` into the global `opencode.jsonc` itself, and the package's `exports["./server"]` loaded on the next run. *verified by experiment*
- **Writes into config dirs.** OpenCode writes `.gitignore`, `package.json`, `package-lock.json` and a `node_modules` holding `@opencode-ai/plugin` into every config directory it loads: global, project `.opencode/` and `OPENCODE_CONFIG_DIR` alike. The `.gitignore` lists itself, so `git status` stayed clean. *verified by experiment*
- **What a plugin can bring (r4).** In one run, from a plugin in `OPENCODE_CONFIG_DIR`:
  - Its `config` hook appended `skills.paths` and `instructions`. The model loaded the skill (`PROBE-SKILL-BODY-42`) and quoted the instruction line.
  - Its `shell.env` hook prepended a `bin/` to `PATH`, and `squeal-probe-cmd` ran from the agent's shell.

  No user file was edited. *verified by experiment*
- **Install without a user-file edit.** A Squeal-owned file at `~/.config/opencode/plugin/squeal.js` is a new file, not an edit. OpenCode loads it for every session of the user, with no trust prompt (none exists in the loader). It goes through the same loop as `OPENCODE_CONFIG_DIR/plugin/` (verified), but was not run at the global path, so as not to touch the sibling's shared config. *read in source code; inferred*

### 5. Lifecycle

- **Start.** Plugin init runs once per instance (directory), before any session. `session.created` fires for new sessions only. `chat.message` fires for every user message, including the first one after a resume and every wake. *verified by experiment*
- **End.** No session-end event exists. `session.deleted` fires only on `DELETE /session/{id}` (s1).
  - `dispose` fired at the end of `opencode run` (r1-r5) and when the TUI got SIGHUP from `tmux kill-server` (t1).
  - It did not fire when `serve` got SIGTERM (s1). `serve` installs no signal handler (`cli/cmd/serve.ts:22`, `Effect.never`), and Cezar stops it exactly that way.

  The process held its sessions until it died, so the reliable end of a consumer is its process: D10's harness-process rule with `OPENCODE_PID`. *verified by experiment*
- **Plugin-spawned children.** Both children the plugin spawned at init outlived `run`'s normal exit, a SIGTERM to `run` and a SIGTERM to `serve`, reparented to the user's subreaper. The attached one stayed in the launcher's process group, where Cezar's group SIGTERM and SIGKILL would reach it (`session-process.js:136-187`). The `detached: true` one had its own group, as D10's daemon spawn does. *verified by experiment; the Cezar group kill read in source code*
- **Shell children.** Shell commands run `detached: true` (`tool/shell.ts:293-309`), so each is its own group, and they are killed only on abort or timeout (l. 548-555). `nohup sleep &` and `setsid sleep &` started by the agent both outlived the turn and the process (r5). *verified by experiment*

### 6. Worktrees

- **Placement.** `Worktree.create` makes `$XDG_DATA_HOME/opencode/worktree/<project id>/<name>` with `git worktree add --no-checkout` (`worktree/index.ts:208-219`). `remove` runs `git worktree remove --force` (l. 419). Only the experimental HTTP routes (`/experimental/worktree`, `…/reset`) and the experimental workspace adapter call them, and the web app's new-session view uses those routes. `run`, `serve`, the TUI and the agent's tools do not. *read in source code*
- **What the plugin sees (r4).** Run from `wt/sub`, a subdirectory of a linked worktree:
  - `directory` = `/…/wt/sub` and `worktree` = `/…/wt`.
  - `project.id` was the same as the main checkout's (the root commit), and `project.worktree` stayed the main checkout's path, the first one registered.

  So the Squeal worktree id must come from `worktree`, never from `project`. *verified by experiment*

## Recommendation for Squeal

- **Hooks:**
  - `chat.message` registers or starts the turn for its `(worktree, sessionID, agent)`; a child is keyed by its own session id, its parent known from `session.created`'s `parentID`.
  - `shell.env` exports `SQUEAL_SESSION_ID` and `SQUEAL_AGENT_ID` from `sessionID`, so `squeal status` from the agent's shell credits the right consumer. The same hook can put Squeal's `bin/` on `PATH`.
  - `session.idle` for a root session is the turn end and arms the idle waiter.
  - Record `OPENCODE_PID` as the harness process for D10's expiry. Do not wait for an end event; none comes under Cezar.
- **Idle wake.** There is a usable channel: the plugin's own `client.session.promptAsync` from the idle waiter. Measured under `serve` and in the TUI; it delivers as a user message and costs a full turn. Under `opencode run`, and Cezar's non-interactive steps, it is lost at the time and read at the next resume. Do not use the HTTP port from outside: it adds nothing a plugin lacks and exists only under `serve`.
- **Install.** `squeal setup` writes one Squeal-owned file, `~/.config/opencode/plugin/squeal.js`, a shim that imports the installed plugin's OpenCode entry. That keeps 005 D3's one full copy and lets `squeal update` cover OpenCode with no OpenCode step. It edits no user file.

  The alternative is `opencode plugin squeal@<exact version> -g`, which follows 002 D1 (OpenCode makes its own config write). It needs an npm package, and an exact pin per update, because a spec is never refreshed.

  The tradeoff that decides between them: one copy of Squeal (shim) against the harness's own install command (npm).
- **Board-row done-when.** A real OpenCode session as `squeal-e2e`, under both `opencode run` and `opencode serve` driven as Cezar drives it, shows each of these:
  - A delta arrives at a tool boundary.
  - `squeal status` from the shell is credited to its consumer.
  - A subagent is its own consumer.
  - An idle `serve` session is woken once with news and not without.
  - The consumer is dropped within a heartbeat of the process's SIGTERM.

## Open questions

- **Wakes inside Cezar.** Whether Cezar should treat a turn it did not start (a Squeal wake) as a turn, and whether a wake should be held back in non-interactive steps that auto-end in 250 ms. That is Cezar's code; not run under Cezar here.
- **Shim with OpenCode alone.** How the shim finds Squeal on a machine with only OpenCode, with no Claude Code or Codex plugin to import from. 005 D3's launcher looks only in those two caches.
- **Global plugin directory.** Not run at `~/.config/opencode/plugin/` itself; only `OPENCODE_CONFIG_DIR` and `.opencode` were.
- **Wake wording.** One phrasing was tried and the model complied. Codex refused a "nonce" phrasing; wording is untested here beyond that.
- **TUI routes with a TUI attached.** `/tui/append-prompt` with a TUI connected through `opencode attach` was not run.

## Sources

- Cezarion 0.16.0-dev.1634, `~/.nvm/versions/node/v24.21.0/lib/node_modules/cezarion/node_modules/@wjarka/cezarion/dist/`:
  - `core/opencode-server-runner.js`;
  - `core/session-process.js`;
  - `core/runner-runtime.js`;
  - `ci-wait/injection.js`;
  - `workflows/run.js:7242`.
- OpenCode `v1.18.35` (`53d1eab`), https://github.com/sst/opencode/tree/v1.18.35, all paths under `packages/opencode/src/` unless named:
  - `plugin/index.ts`, `plugin/shared.ts`, `config/paths.ts`, `config/plugin.ts`, `config/config.ts`;
  - `tool/shell.ts`, `cli/cmd/run.ts`, `cli/cmd/serve.ts`, `cli/cmd/plug.ts`, `index.ts`;
  - `worktree/index.ts`, `skill/index.ts`;
  - `server/routes/instance/httpapi/groups/{session,tui,experimental}.ts`;
  - `packages/plugin/src/index.ts` (the `Hooks` and `PluginInput` types);
  - `packages/core/src/npm.ts`.
- Probes: `probes/opencode-sessions-and-wake/README.md`, logs in `probes/opencode-sessions-and-wake/logs/raw/` (`events.jsonl`, `*.env`, `s1.messages.json`, `t1.pane.txt`).
- Squeal: spec 001 D9 and D10, spec 002 D1, spec 005 D3, `src/core/types/delivery.ts`.
