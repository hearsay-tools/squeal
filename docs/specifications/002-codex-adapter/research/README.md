# Research brief for spec 002: Codex adapter

Read `docs/vision.md` and `docs/styleguide.md` first. Then `../status.md` for the decisions already made, spec 001 section D9 for the Claude Code adapter this one mirrors, and the prior Codex findings: `../../001-core-loop/research/claude-code-integration.md` section 7 and `../../001-core-loop/research/pull-advances-push.md` question 4. Both were read in docs or source, never run; this brief turns them into experiments.

Each topic below is one researcher task. Write your findings to `research/<topic>.md` in this folder. Commit when done.

## Rules for findings documents

- Length: 1 to 3 pages. Signal over completeness.
- Structure: Questions answered (a table), Findings per question, Recommendation for Squeal, Open questions, Sources.
- Mark every finding as one of: `verified by experiment`, `read in official docs`, `read in source code`, `inferred`. Name the version you looked at. Codex CLI 0.160.1 is installed on this host and logged in.
- Prefer experiments over reading when an experiment is cheap. Throwaway probes go under `research/probes/<topic>/` and must say they are throwaway in a README. No product code anywhere else.
- Probes run against scratch repositories under `/tmp`, never against this repository's Squeal store, and never leave a daemon running.
- Credentials stay where they are: never read, copy, echo or persist `~/.codex/auth.json` or any token. Configure hooks through `-c` overrides on the command line or repo-level files in the scratch repository. If a user-level file under `~/.codex` must change, back it up first, restore it after, and record both steps in the probe README.
- Reference URLs and file paths. Do not paste large code; a few lines to prove a point is fine.
- Do not design Squeal. Answer the questions and recommend. The spec is written by the coordinator from these documents.
- Do not touch anything outside `docs/specifications/002-codex-adapter/research/`.

## Topic: codex-hooks

Squeal needs to deliver validation deltas to a Codex agent mid-turn, deny an edit once when an undelivered regression exists, speak at Stop only with news, and never block the agent when its daemon is dead. Spec 001 D9 is the shape to compare against.

1. Configuration surfaces: where hooks are declared (`hooks.json` at user and repository level, `[hooks]` in `config.toml`, plugin-bundled hooks, `-c` overrides), the exact JSON or TOML for one hook of each event, and the trust model for repository hooks: what persisted trust is, how it is granted, and what `--dangerously-bypass-hook-trust` changes. Which surface a tool could install into without editing a user-owned file.
2. Events and payloads: record the stdin JSON of every event Codex fires in one `codex exec` session and one interactive session (tmux if available): SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Stop, SubagentStart, SubagentStop, PreCompact, PostCompact, Interrupt, and any others. Name the fields: session, thread and turn ids, agent id, cwd, tool name, tool input and output. Is there a per-batch post-tool event like Claude Code's PostToolBatch, or only per tool?
3. Mid-turn injection: confirm by experiment that PostToolUse `additionalContext` reaches the model before its next step within the same turn, and measure the gap between the tool ending and the hook output being visible. Does SessionStart or UserPromptSubmit context injection work, and how large can it be?
4. Deny and block: confirm that PreToolUse `decision: "block"` and exit 2 with stderr stop the tool, that the model sees the reason, and that it continues in the same turn. Which tool names cover file edits (`apply_patch`, shell writes, others) and shell commands?
5. Stop: what `block` with a `reason` does (the prior finding says it continues the turn with the reason as a new prompt), what a silent Stop does, whether Stop fires in `exec` mode and at an interrupt, and whether a Stop hook can read state and speak only when it has news without starting an extra turn when it has none.
6. Timeouts and failure modes: per-hook timeout configuration and default; what the agent experiences when a hook hangs, exits non-zero, or prints invalid JSON; whether hooks run at all under `codex exec` and under `codex app-server` (Cezar drives Codex through app-server; see the installed cezarion at `/home/agent/.nvm/versions/node/v24.21.0/lib/node_modules/cezarion/node_modules/@wjarka/cezarion/dist/` for how). Measure the per-hook cost: wall time added to one tool call with one trivial hook on each event.
7. Sandbox: Codex runs tool commands under a sandbox. Can a hook process, and a `squeal status` run from the agent's shell tool, read a SQLite store under `<repo>/.git/squeal/`, connect to a unix socket under `$XDG_RUNTIME_DIR` or `/tmp/squeal-<uid>`, and spawn a detached daemon that outlives the tool call? Under which sandbox modes and settings?

Record exact hook JSON and observed transcript excerpts.

## Topic: codex-sessions-and-wake

Squeal keys a consumer by session and agent, credits a `squeal status` pull run from the agent's shell to that consumer, and wakes an idle Claude Code agent through `asyncRewake`. This topic settles what Codex gives for each, and how Squeal gets installed for Codex at all.

1. How Cezar drives Codex: read the installed cezarion dist named above and the Codex app-server protocol (official docs; openai/codex source at the installed version's tag). Which JSON-RPC requests and notifications exist for starting a turn, steering a running turn, injecting context without a reply, interrupting, and reading tool results? Could a Squeal daemon or a Cezar-side shim use any of them as a delivery channel beside hooks, and what would it cost in coupling?
2. Idle wake: `codex queue` ("Queue a message for an existing session" in `codex --help`): what it does, whether it starts a turn, whether it works for an interactive session, an `exec` session and an app-server session, and how a message is addressed. Also `async: true` hooks, the `notify` configuration, and anything else in docs or source that can put text in front of an idle agent. Verify by experiment the ones that look usable.
3. Identity: which environment variables a shell command sees (`CODEX_SESSION_ID`, `CODEX_THREAD_ID`, others), and which ids hooks see, in a plain session, under a subagent, and under app-server. Can a PostToolUse hook tell a subagent's tool call from the parent's? Does a thread id survive `codex resume` and `codex fork`?
4. Packaging: what a Codex plugin contains (`codex plugin --help`, official docs), how it is installed and enabled per user and per repository, whether it can bundle hooks, a skill or an `AGENTS.md` fragment, and a `bin` on the shell tool's path. Compare against writing hooks into a user or repository config. Recommend how `squeal init` should install for Codex without editing a user-owned file, or say why it cannot.
5. Where the primer lives: spec 001 D9 injects a short primer at SessionStart telling the agent not to run Vitest itself. Which Codex surface carries the same text reliably: SessionStart context, `AGENTS.md`, a skill, the plugin manifest? Verify that the model acts on it in one `codex exec` run.
6. Worktrees and lifecycle: where the Codex app and CLI place worktrees (`$CODEX_HOME/worktrees` per the prior finding), whether Codex removes a worktree while a child process has it as cwd, and whether a daemon spawned from a hook survives the end of the session, the end of a turn, and the sandbox. Compare with `../../001-core-loop/research/daemon-under-harnesses.md`.
7. Non-interactive sessions: under `codex exec` and app-server, which of SessionStart, UserPromptSubmit, Stop and SessionEnd fire, so the adapter knows when a consumer is gone (spec 001 D10's expiry rules were shaped by Claude Code skipping SessionEnd).

Recommendation: the Codex events Squeal should hook and what each does, the delivery channel for idle agents or the statement that there is none, the install path, and what a board row's done-when would be.
