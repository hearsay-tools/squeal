# Research brief for spec 008: OpenCode adapter

Read `docs/vision.md` and `docs/styleguide.md` first. Then `../status.md` for the decisions already made, spec 001 section D9 for the Claude Code adapter, and spec 002 (`../../002-codex-adapter/spec.md` and its `status.md`) for how the second harness was built on `src/harness/shared/`. Read `src/core/types/delivery.ts` (`HarnessDelivery`) and `src/harness/codex/` before proposing anything they already solved. The Codex findings in `../../002-codex-adapter/research/` show the depth expected.

Each topic below is one researcher task. Write your findings to `research/<topic>.md` in this folder. Commit when done.

## Rules for findings documents

- Length: 1 to 3 pages. Signal over completeness.
- Structure: Questions answered (a table), Findings per question, Recommendation for Squeal, Open questions, Sources.
- Mark every finding as one of: `verified by experiment`, `read in official docs`, `read in source code`, `inferred`. Name the version you looked at. OpenCode 1.18.35 is installed on this host; read the source at its tag (`sst/opencode` on GitHub, the `packages/opencode` and `packages/plugin` trees).
- Prefer experiments over reading when an experiment is cheap. Throwaway probes go under `research/probes/<topic>/` and must say they are throwaway in a README. No product code anywhere else.
- Isolation (hard rule): never run `opencode` as this user, and never run a script or package that might write under the real `HOME` (`~/.config/opencode`, `~/.local/share/opencode`, `~/.claude`, `~/.codex`). A scratch `HOME` or `XDG_*` variable is not isolation. Every OpenCode run goes through the throwaway user `squeal-e2e`: `sudo -n -u squeal-e2e -H env -i HOME=/home/squeal-e2e PATH=... <cmd>` with cwd `/`, the probe files sent in through `tar`, never by giving that user access to `/home/agent`. Install OpenCode 1.18.35 for that user with its own npm prefix (`/home/squeal-e2e/.npm-global`, Node in `/opt/squeal-e2e/node24`). Record each step in the probe README.
- Probe model (human, 2026-10-14): `cliproxy/gpt-6-luna`. Give `squeal-e2e` a project-level `opencode.json` in the scratch repository with a `cliproxy` provider (`npm: @ai-sdk/openai`, `options.baseURL: https://cliproxy.home.jarka.pl/v1`, `options.apiKey: "{env:CLIPROXY_API_KEY}"`, model `gpt-6-luna`), and pass the key by name only: `sudo -n --preserve-env=CLIPROXY_API_KEY -u squeal-e2e ...` with `CLIPROXY_API_KEY` kept through `env -i`'s list by name. Never read, echo, copy or persist its value, and never read `~/.config/opencode` or `~/.local/share/opencode/auth.json` of this user. Keep sessions short: a few tool calls each.
- Probes run against scratch repositories under `/home/squeal-e2e`, never against this repository's Squeal store, and never leave a daemon or an `opencode serve` running.
- Reference URLs and file paths. Do not paste large code; a few lines to prove a point is fine.
- Do not design Squeal. Answer the questions and recommend. The spec is written by the coordinator from these documents.
- Do not touch anything outside `docs/specifications/008-opencode-adapter/research/`.

## Topic: opencode-plugins

Squeal needs to deliver validation deltas to an OpenCode agent mid-turn, deny an edit once when an undelivered regression exists, speak at the end of a turn only with news, and never block the agent when its daemon is dead. Spec 001 D9 and spec 002 D3 are the shapes to compare against.

1. Extension surfaces: plugins in `.opencode/plugin/` (project), the global plugin directory, npm packages named in `opencode.json`'s `plugin` list; how each is found, loaded (Bun, TypeScript directly, install of npm plugins) and ordered; what a plugin receives (`client`, `$`, `directory`, `worktree`, `project`). Any command-based hook surface beside plugins. Any trust or permission prompt. Which surface Squeal could install into without editing a user-owned file.
2. Hooks and events: record what fires in one `opencode run` session and one `opencode serve` session driven through its HTTP API: every plugin hook (`tool.execute.before`, `tool.execute.after`, `chat.message`, `chat.params`, `permission.ask`, system-prompt transforms, others at 1.18.35) and every bus event the `event` hook sees (`session.created`, `session.idle`, `session.error`, `session.deleted`, `session.compacted`, `message.updated`, `file.edited`, others). Name the fields: session id, parent session id, message id, call id, tool name, arguments, output, directory. Can a hook tell a subagent's tool call (the `task` tool's child session) from the parent's?
3. Mid-turn injection: does a change to the output in `tool.execute.after` reach the model before its next step in the same turn? Compare with `client.session.prompt` with `noReply` and with any synthetic-part mechanism. Measure the gap, and the size a single injection can carry. Which surface carries a primer at session start (a system transform, `instructions` in config, `AGENTS.md`), and does the model act on it in one run?
4. Deny: does throwing in `tool.execute.before` stop the tool, does the model see the message, and does it continue in the same turn? Which tool names write files (`edit`, `write`, `patch`, others) and run shell commands?
5. End of turn: is `session.idle` the Stop analog? Can a plugin read state at idle and speak only when it has news, by starting a turn, without a loop and without a turn when it has none? Does idle fire under `opencode run`, at an abort, and for a child session?
6. Runtime and failure modes: a hook that throws, hangs or is slow: does it block the agent or the whole process, and is there a timeout? Can code running in OpenCode's Bun process use `node:sqlite`, `node:net` unix sockets and a detached `child_process` spawn (the imports of `src/harness/shared/`)? Measure the per-event cost of three shapes: shared code in-process, a short `node` process per event as the Codex hooks are, and a message to the daemon over its socket.

## Topic: opencode-sessions-and-wake

Squeal keys a consumer by session and agent, credits a `squeal status` pull run from the agent's shell to that consumer, and wakes an idle Claude Code agent through `asyncRewake`. This topic settles what OpenCode gives for each, and how Squeal gets installed for OpenCode at all.

1. How Cezar drives OpenCode: read the installed cezarion dist (`/home/agent/.nvm/versions/node/v24.21.0/lib/node_modules/cezarion/node_modules/@wjarka/cezarion/dist/`, files naming `opencode`). `opencode run`, `opencode serve` with the SDK, or another path; which requests start, steer, interrupt and read a session; whether that server could be a delivery channel beside a plugin, and what it would cost in coupling.
2. Idle wake: can a plugin, or a process outside OpenCode, put text in front of an idle agent and start a turn (`client.session.prompt`, `promptAsync`, the TUI's own endpoints)? Under `opencode run`, under `serve`, in the TUI. Verify the ones that look usable.
3. Identity: which environment variables a shell command run by the agent sees (session id, any `OPENCODE_*`), and which ids a plugin sees, in a plain session, a child session and under `serve`. Does a session id survive a resume, a fork or `--continue`?
4. Packaging and install: what an npm plugin package contains, how it is installed and pinned (the `plugin` list, project and global config, the cache OpenCode installs into), and how updates arrive. Whether a plugin can bring a skill, an `AGENTS.md` fragment or a command onto the shell tool's `PATH`. Recommend how `squeal setup` (spec 005 D3) should install for OpenCode without editing a user-owned file, or say why it cannot.
5. Lifecycle: under `opencode run` and `serve`, which events mark a session's start and end, so the adapter knows when a consumer is gone (spec 001 D10's expiry rules). Whether a daemon spawned from a plugin survives the session and the process, and what OpenCode does to child processes at exit.
6. Worktrees: whether OpenCode places or removes worktrees itself, and what `directory` and `worktree` a plugin sees when Cezar runs it in a git worktree.

Recommendation: the OpenCode events Squeal should hook and what each does, the delivery channel for idle agents or the statement that there is none, the install path, and what a board row's done-when would be.
