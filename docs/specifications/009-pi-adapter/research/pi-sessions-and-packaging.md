# Pi sessions and packaging

Examined 2026-10-14: **Pi 1.0.4**, Node 24.21.0, Linux; **Cezar 0.16.0-dev.1634**. All Pi execution used `squeal-e2e`, an empty inherited environment, a private `PI_CODING_AGENT_DIR`, and a scripted provider with no network requests or credentials. No real user settings, authentication files or Squeal store were inspected by these probes. Evidence and repeat instructions: [probes/pi-sessions-and-packaging](probes/pi-sessions-and-packaging/README.md).

## Questions answered

| Question | Answer and evidence tag (Pi 1.0.4 throughout) |
| --- | --- |
| 1. Idle wake and Cezar | **verified by experiment:** custom `triggerTurn: true` and `sendUserMessage` wake an idle TUI/RPC agent. Both reach the provider as `user`. Print exits after its prompt. Cezar handles the unsolicited second turn while its process remains open; auto-end can close before news arrives. |
| 2. Cezar launch | **read in source code; verified by experiment:** RPC, explicit Cezar extension(s), ordinary user extensions enabled, no project approval or session-directory override. A user-installed probe loaded through the actual runner. |
| 3. Package and trust | **read in official docs; verified by experiment:** `pi install` owns settings writes; user scope loads without project trust, `-l` is project scope and requires trust to load. Explicit package manifests can point at committed bundles. |
| 4. Bundles, Node and CLI | **verified by experiment:** an explicit `.mjs` entry works, including host Pi imports and Node `net`/`child_process`; implicit extension scanning ignores a bare `.mjs`. The shell receives `PI_SESSION_ID`; installing a Pi package does not supply a `squeal` shell command. |
| 5. Daemon lifetime | **verified by experiment:** a detached, unreferenced child with ignored stdio outlives print exit, TUI quit, RPC EOF, SIGTERM and SIGKILL. Shutdown handlers cover the first four, not SIGKILL. |
| 6. Identity | **verified by experiment:** `--session`, `--continue`, `--resume` and compaction preserve the ID; CLI/RPC fork and RPC new-session create IDs; switching back restores the old ID. |

## Findings per question

### 1. Idle wake is available while Pi remains open

**verified by experiment:** after the first run settled, a 200 ms timer ran with `ctx.isIdle() === true`. In both TUI and RPC:

| Extension call while idle | Extra requests before another human prompt | Model representation |
| --- | --- | --- |
| `sendMessage(custom, { triggerTurn: true, deliverAs: "steer" })` | 1 | `user` text |
| Same with `deliverAs: "followUp"` | 1 | `user` text |
| `sendMessage(custom, { triggerTurn: false })` | 0 | Present in the next request |
| `sendMessage(custom, { triggerTurn: true, deliverAs: "nextTurn" })` | 0 | Present in the next request |
| `sendUserMessage(text, { deliverAs: "steer" })` or `"followUp"` | 1 | `user` text |

The custom entry retains `customType`, `display` and custom identity in Pi; the TUI showed `squeal-probe` for displayed custom messages. Its provider request contained only ordinary user content. **read in source code:** `core/messages.js:89` performs this conversion; custom messages are not a lower-authority provider role. `nextTurn` takes precedence over `triggerTurn`; while streaming, `steer`/`followUp` instead choose the corresponding queue (`agent-session.js:1788`). `sendUserMessage` always prompts; it has no `triggerTurn: false` option. A silent custom message is not evidence that the model has read it.

**verified by experiment:** `-p` emitted one reply, `session_shutdown`, then exited before the delayed wake. Cleanup must cancel timers and pending listeners. An initial probe without cancellation called the captured `ctx` after shutdown and Pi threw “This extension ctx is stale after session replacement or reload.” There is no durable post-exit wake channel in these APIs.

**verified by experiment, Cezar 0.16.0-dev.1634:** the installed `PiRunner` copied unchanged into the test account saw two text responses and two `turn-end` events; its UI mapper emitted a second `turn.started`/`turn.completed` pair without a Cezar prompt. Both persistent mode and auto-end with a 200 ms wake worked. With auto-end and a 600 ms wake, only the first reply ran. **read in source code:** `run()` enables auto-end; the timer is 250 ms after settlement. Only Cezar's `sendMessage` clears that timer, so a new extension run is not itself a guarantee against teardown. Idle wake must be qualified by the launcher's lifetime policy.

### 2. Cezar leaves user extensions enabled

**read in source code:** `buildPiArgs` uses `--mode rpc --extension <pi-retry-degraded-service.mjs>`; with `cezarTools`, it adds `pi-ci-wait.mjs`. It passes `--session-id` for a named initial session or `--session` on resume, optional `--append-system-prompt`, model/thinking/tool options and `--exclude-tools subagent` when delegation is restricted. It does **not** pass `--no-extensions`, `--approve`, `--session-dir` or `--no-session`. Cwd is the worker directory; the environment is Cezar's filtered child environment plus explicit per-run values.

Commands observed in source are `get_state`, `set_steering_mode` (`all`), `prompt` (with `streamingBehavior: "steer"` when active), and `abort`; end closes stdin, then escalates to signals. It consumes prompt acknowledgements, `agent_start`, user `message_start`, assistant updates/end, tool execution events, `agent_settled` and `extension_error`. `agent_settled` is its turn completion boundary. **verified by experiment:** the user-installed fake provider loaded with these Cezar arguments, with no `-e` for the probe.

### 3. Install through Pi; make the bundle a declared resource

**read in official docs:** supported sources are `pi install npm:<package>@<version>`, `pi install git:github.com/<owner>/<repo>@<ref>`, and `pi install /absolute/local/package`. Personal declarations go to `~/.pi/agent/settings.json`; `-l` writes `.pi/settings.json`. Packages may carry extensions, skills, prompt templates and themes, plus dependencies. Local sources are referenced in place, not copied or installed. Pi supplies its own packages through host module mapping; declare them as peer dependencies and leave them out of the bundle.

**verified by experiment:** `pi install <probe-directory>` wrote the declaration and subsequent ordinary Pi/Cezar launches loaded its manifest's `.mjs`. `pi install <marker-directory> -l --approve` wrote a project declaration. The marker was skipped under default noninteractive trust and `--no-approve`, and loaded with `--approve`. Removing a local declaration also needed `--approve` once protected project settings existed. Package subcommands come first: `pi install <source> -l --approve`.

**read in official docs:** project trust protects `.pi` settings/resources, project packages and project `.agents/skills`; `AGENTS.md`/`CLAUDE.md` are separate and still load. Decisions live in `~/.pi/agent/trust.json`, use canonical paths and the nearest saved ancestor. CLI overrides win, then user/CLI extension decisions, saved trust and global default. Default `ask` skips protected resources in print/JSON/RPC. Trust controls loading, not execution permissions; extensions run as Pi's OS user.

**inferred from documented manifest/local-path support and the successful probe:** `plugins/pi/` can hold a small `package.json`, explicit `pi.extensions: ["./dist/extension.mjs"]`, a skill, and committed CLI/daemon bundles. The user can install that directory through Pi; Squeal need not edit user settings. A published npm package can ship that directory independently. **read in source code:** git sources resolve a repository/ref, not a selectable package subdirectory (`utils/git.js`, `package-manager.js`); installing the whole Squeal git repository would require a root manifest exposing the nested resources or a separate package repository. Merely adding `plugins/pi/` does not make that root git install discover it.

### 4. A bundle can use its own location and the existing Node

**verified by experiment:** an ESM `.mjs` declared in `pi.extensions` loaded with `import.meta.url` pointing to its installed file. `process.execPath` was `/opt/squeal-e2e/node24/bin/node`; `node:net`, `node:child_process` and Pi's host-provided `AssistantMessageEventStream` imported successfully. A bare `.mjs` in the automatic extensions directory did not load; renaming it `.js` did. **read in source code:** `extensions/loader.js` imports explicit entries through Jiti; automatic scanning accepts `.ts`/`.js`. **inferred:** a prebuilt ESM bundle needs no TypeScript wrapper when declared explicitly.

**verified by experiment:** an actual scripted `bash` call saw `PI_SESSION_ID` equal to `ctx.sessionManager.getSessionId()` and a matching `PI_SESSION_FILE`; `command -v squeal` found nothing. **read in official docs/source:** shell metadata is resolved per invocation, including after session/model changes, for built-in `bash`/`powershell` and their standard factory tools. It is not injected into interactive `!`/`!!` shell commands, and custom tools can disable it.

**inferred recommendation:** resolve sibling CLI/daemon files from `import.meta.url`; use an absolute, shell-quoted Node executable and CLI path in the primer, as the Codex adapter does. Attribute built-in shell pulls through `PI_SESSION_ID` and `main`, without adding a Pi-specific core consumer field. A custom shell tool that strips metadata needs separate evidence.

### 5–6. Cleanup belongs to the session instance; identity belongs to the session

**verified by experiment:** the sentinel spawned at `session_start` with `{ detached: true, stdio: "ignore" }` and `unref()` continued updating its heartbeat after every tested exit. This tests process survival, not Squeal daemon behavior. `session_shutdown` fired on normal print completion, TUI Ctrl-D, RPC stdin EOF and RPC SIGTERM (exit 143); it did not fire on SIGKILL. Every sentinel was terminated after the check. **inferred:** unregister on shutdown, retain spec 001 D10's dead-process/expiry backstops, and reuse the shared daemon-ensuring logic. Record Pi’s own process identity: the existing `findHarnessProcess()` defaults to walking from `process.ppid`, appropriate for hook subprocesses but not for an extension inside Pi.

**verified by experiment:** compaction kept both ID and extension factory and emitted `session_before_compact`/`session_compact`. RPC fork/new/switch emitted shutdown for the outgoing instance and loaded a fresh factory with `session_start` reason `fork`/`new`/`resume`. Switching back recovered the original ID. Each RPC replacement delivered `session_start` **twice to the same new factory** in this build; startup registration must be idempotent. The terminal `--resume` picker recovered the original ID. CLI `--fork <path|id>` created a new ID; it cannot be combined with `--session`. `--session` and `--continue` recovered the old ID. **read in source code:** `--resume` selects a path then calls `SessionManager.open`, preserving its ID; `/new` uses the same runtime replacement as RPC `new_session`. Old contexts are invalid after replacement; `withSession` receives the replacement context (`agent-session-runtime.js`).

**inferred recommendation:** the existing `(worktreeId, Pi session ID, "main")` consumer fits these observations. Bind connections, waiters and cancellation to each extension instance; use the current context after replacement. Do not clear an existing delivery view merely because compaction or a duplicate start event occurred. Concurrent processes deliberately opening the same session ID are not distinguished by this key and need an explicit policy if supported.

## Recommendation for Squeal

**inferred:** ship an explicitly declared ESM Pi package, installed with Pi's command. Use `session_start` for idempotent setup, `session_shutdown` for cleanup and `agent_settled` for the idle boundary. A bounded `waitForDelta` can wake a still-open TUI/RPC session with a displayed custom message and `triggerTurn: true`; print and closed Cezar workers cannot be awakened this way. Keep the shared registration, daemon, delivery and waiter semantics. `tool_result`, `tool_call`, `before_agent_start` and `agent_before_settle` are the candidate primary push, deny, primer and end-of-run surfaces; their precise contracts belong to the sibling events research.

A proof row's done-when should cover install/trust and bundle relocation, fake-provider context assertions, no-news silence, native shell pull attribution, fresh/resumed/forked/compacted sessions, duplicate starts, graceful teardown and SIGKILL, plus both persistent RPC wake and Cezar auto-end. No core interface change is established here.

## Open questions

- **Not determined:** whether the product should opt into idle wake in Cezar despite its closure policy; the runner probe proves mechanics, not the full cockpit task-state behavior.
- **Not determined:** concurrent use of one session ID, third-party subagent/custom shell identity and model compliance with the primer. These require separate scope or dogfooding, not credentials in this research.
- Npm and remote-git install are **read in official docs/source**, not exercised; local install and trust were exercised.

## Sources

- Pi 1.0.4 installed package: `/home/agent/.nvm/versions/node/v24.21.0/lib/node_modules/@earendil-works/pi-coding-agent/`; matching execution package under `/home/squeal-e2e/.npm-global/lib/node_modules/`. Official repository: <https://github.com/earendil-works/pi>. Read installed `docs/{packages,security,sessions,session-format,extensions,custom-provider,rpc,rpc-commands,cli,environment-variables}.md`; online counterparts under `packages/coding-agent/docs/`.
- Versioned installed implementation: `dist/core/{agent-session,agent-session-runtime,session-manager,messages,package-manager}.js`, `dist/core/extensions/{loader.js,types.d.ts}`, `dist/core/tools/bash.js`, `dist/modes/{print-mode.js,rpc/rpc-mode.js,interactive/interactive-mode.js}`, `dist/{main,package-manager-cli}.js`, `dist/utils/git.js`.
- Cezar 0.16.0-dev.1634: `/home/agent/.nvm/versions/node/v24.21.0/lib/node_modules/cezarion/node_modules/@wjarka/cezarion/dist/core/{pi-runner,pi-ui-mapper,runner-runtime,agent-env}.js`. `pi-runner.js` SHA-256 `0db6974c0806ea035a72041790f3db4c8b264f81dacf4967dcdefd50782f73d1`; mapper `f88600bab71ebcf0dd752a0c708f7bfea4e0773f09729c72e7dd7925e0411ea2`.
- Squeal: spec 001 D9/D10, spec 002, `src/core/types/delivery.ts`, and `src/harness/shared/{index,context,session,ensure,waiter,harness-process}.ts`.
