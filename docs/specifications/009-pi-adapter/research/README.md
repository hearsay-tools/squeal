# Research brief for spec 009: Pi adapter

Read `docs/vision.md` and `docs/styleguide.md` first. Then `../status.md` for the decisions already made, spec 001 D9 (the Claude Code adapter), spec 002 (the Codex adapter, the closest precedent) and `src/core/types/delivery.ts` (`HarnessDelivery`). `src/harness/shared/` holds the logic both adapters share; read it before proposing anything it already does.

Pi is `@earendil-works/pi-coding-agent` 1.0.4, installed at `/home/agent/.nvm/versions/node/v24.21.0/lib/node_modules/@earendil-works/pi-coding-agent/` with its docs under `docs/` (`extensions.md`, `rpc.md`, `packages.md`, `sessions.md`, `security.md`, `settings.md`, `skills.md`, `sdk.md`) and examples under `examples/`. Source: https://github.com/earendil-works/pi at the matching tag. Unlike Claude Code and Codex, Pi has no hook processes: an extension is a TypeScript module loaded into the Pi process, which subscribes to events with `pi.on()` and lives as long as the session. Cezar drives Pi through `pi --mode rpc` (`/home/agent/.nvm/versions/node/v24.21.0/lib/node_modules/cezarion/node_modules/@wjarka/cezarion/dist/core/pi-runner.js`).

Each topic below is one researcher task. Write your findings to `research/<topic>.md` in this folder. Commit when done.

## Rules for findings documents

- Length: 1 to 3 pages. Signal over completeness.
- Structure: Questions answered (a table), Findings per question, Recommendation for Squeal, Open questions, Sources.
- Mark every finding as one of: `verified by experiment`, `read in official docs`, `read in source code`, `inferred`. Name the Pi version.
- Prefer experiments over reading when an experiment is cheap. Throwaway probes go under `research/probes/<topic>/` and must say they are throwaway in a README. No product code anywhere else.
- Isolation: Pi reads and writes `~/.pi/agent` (settings, sessions, trust, installed packages), and the human's own Pi sessions use it. Never run `pi` as the agent user, never install a Pi package or extension into the real `HOME`, and never read `~/.pi/agent/auth.json` or any credential. Run Pi only as the throwaway user `squeal-e2e` (`sudo -n -u squeal-e2e -H env -i HOME=/home/squeal-e2e PATH=... <cmd>`, cwd `/`; Node at `/opt/squeal-e2e/node24/bin`), installing `@earendil-works/pi-coding-agent@1.0.4` into its `~/.npm-global` first. Scratch projects live under `/home/squeal-e2e/` or a `/tmp` directory that user owns; copy probe files in with `tar` through `sudo -u squeal-e2e`.
- No model credentials. Answer the mechanics with a scripted fake provider registered by a probe extension (`pi.registerProvider`, `custom-provider.md`): it returns planned tool calls and records every request context it receives, so "does this text reach the next model request" is an assertion, not a judgement. A real model is not needed in this research; whether a model acts on the primer is a dogfooding question.
- Probes never touch this repository's Squeal store and never leave a daemon or a Pi process running.
- Reference URLs and file paths. Do not paste large code; a few lines to prove a point is fine.
- Do not design Squeal. Answer the questions and recommend. The spec is written by the coordinator from these documents.
- Do not touch anything outside `docs/specifications/009-pi-adapter/research/`.

## Topic: pi-extension-events

Squeal needs to deliver validation deltas to a Pi agent mid-turn, deny an edit once when an undelivered regression exists, speak at the end of a run only with news, tell the agent not to run tests itself, and never block the agent when its daemon is dead. Spec 001 D9 and spec 002 D3 are the shapes to compare against.

1. Events and payloads: record, in one `pi -p` run and one `--mode rpc` session, every event an extension receives (`session_start`, `before_agent_start`, `agent_start`, `turn_start`, `tool_call`, `tool_result`, `turn_end`, `agent_before_settle`, `agent_end`, `agent_settled`, `session_shutdown`, compaction, and any others) with their fields: session id, cwd, tool name and input, tool output. What identifies a session and a run, and what does a shell command run by the `bash` tool see in its environment?
2. Mid-turn injection: which surface puts text in front of the model before its next step within the same run: a `tool_result` handler appending to the result, `turn_end` with a `custom_message` entry, `pi.sendMessage` while streaming, `context`. Verify with the fake provider that the text is in the next request, and name how it is persisted in the session file and shown in the TUI. With parallel tool calls from one assistant message, how many times does each fire, and in what order?
3. Deny: `tool_call` blocking. Verify the model sees the reason and continues in the same run. Which tool names write files (`edit`, `write`, and `bash`), and how do extension and MCP tools appear?
4. End of run: `agent_before_settle` with `continue: true` against `agent_end`: does a continuation cost one model request, can a handler stay silent at no cost, what guards a loop, and do they fire under `-p`, `json`, `rpc` and at an abort (Escape, RPC `abort`)?
5. Primer: `before_agent_start` system-prompt sections, `--append-system-prompt`, a skill, `AGENTS.md`. Which carries a short primer into every run of a session, including after compaction, and how large can it be?
6. Failure modes and cost: a handler that throws, hangs or is slow; is there a timeout, does a hang block the agent, how is the error shown? Measure the wall time one trivial handler adds to a tool call, and the cost of an extension that holds a unix socket open to a process outside Pi.
7. Subagents and forks: does Pi 1.0.4 run subagents (built in, or through an extension or package the human uses; look at `~/.pi/agent/settings.json` by its keys only), and do they load the parent's extensions? What do `--fork` and session replacement (`withSession`) do to an extension's state?

## Topic: pi-sessions-and-packaging

Squeal keys a consumer by session and agent, credits a `squeal status` pull from the agent's shell to that consumer, wakes an idle agent where the harness allows, and ships as a plugin the user installs with the harness's own commands. This topic settles what Pi gives for each.

1. Idle wake: `pi.sendMessage` and `pi.sendUserMessage` with their delivery options (steer, follow-up, trigger a turn) while the agent is idle, under the TUI, `-p` and `rpc`. Does an extension-originated message start a run, how does it look to the model (user authority or a custom message), and what does Cezar's RPC client see when a run starts that Cezar did not request (read `pi-runner.js`)? Verify with the fake provider.
2. How Cezar drives Pi: which RPC commands and events Cezar uses, whether it passes `-e`, `--no-extensions`, `--approve` or a session dir, and so whether a user-installed extension loads in a Cezar worker at all.
3. Packaging: Pi packages (`packages.md`): `pi install` from npm, git or a local path, user against project scope (`-l`), what a package may carry (extensions, skills, prompt templates), project-local resources and the trust model (`trust.json`, `--approve`). Which route installs Squeal for a user with Pi's own commands, without Squeal writing a user-owned file? Can one package directory in this repository serve, as `plugins/codex/` does, with committed bundles?
4. Bundling: can an extension be a prebuilt `.mjs` bundle, or must it be TypeScript Pi compiles? Which Node runs it and can it import Node built-ins (`net`, `child_process`)? Where does it find the Squeal CLI and daemon bundles, and what does a `bash` tool command need to run `squeal status` (PATH, an absolute path)?
5. Daemon lifecycle: can an extension spawn a detached daemon from `session_start` that outlives Pi (`-p` end, TUI quit, RPC stdin EOF, a kill)? Does `session_shutdown` fire in each case, so a consumer can be unregistered, or must 001 D10's expiry cover it?
6. Identity and lifecycle: does a session id survive `--continue`, `--resume`, `--session`, `--fork`, compaction and `/new`; which of these replace the extension's session context? Recommend the consumer key.

Recommendation: the Pi events Squeal should use and what each does, the idle-wake channel or the statement that there is none, the install path, and what a board row's done-when would be.
