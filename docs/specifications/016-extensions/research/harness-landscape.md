# Research: harnesses Squeal does not support yet, and the adapter contract

Brief 016-04. Read on 2026-10-24 from official docs and source at the revisions in Sources. No harness was run: the brief forbids it. Every finding is therefore `read in official docs`, `read in source code` or `inferred`; none is `verified by experiment`. The fetch list is in `probes/harness-landscape/README.md`. The C8 rules are compared against 011 C8 as it stands at HEAD. Squeal's own adapters are 016-01's subject; they appear here only for size and event names.

## Questions answered

| # | Question | Short answer | Tag |
|---|---|---|---|
| 1 | Extension points | Five more harnesses have hook scripts that add text after a tool, continue at end of turn, inject at session start and deny a tool: Cursor, Gemini CLI, Copilot CLI, Factory Droid and Kiro. Amp and Cline have in-process plugins that do the same, and both can also push into an idle session. Goose, Windsurf, OpenHands and Crush have a subset of these. Zed's own agent and Roo Code have MCP only. Aider has only a command it runs after each edit. Continue declares hooks that nothing calls. Only Copilot CLI, Amp, Cline and an ACP proxy have anything like an idle wake. | read in docs and source |
| 2 | Classes | (A) full hook scripts, (A′) partial hook scripts, (B) in-process plugin, (C) ACP proxy, (D) MCP only, (E) after-edit command. Class A and class B keep every C8 rule except the idle wake, which only class B and Copilot CLI approach. Class D keeps only pull and commands, which is two of the three operations in principle 6. | inferred from 1 |
| 3 | MCP push | No standard MCP path puts server text into the model's context. Resource updates go to the client, and the 2026-07-28 revision makes the protocol stateless. Claude Code channels are the only push path found; they are experimental, allowlisted and Claude only. Pull through an MCP tool plus push through a hook is enough; MCP alone is not. | read in docs and source |
| 4 | Convergence | Claude Code's hook format is the de facto standard. Cursor, Copilot CLI and Continue read `.claude/settings.json` directly, Factory Droid installs Claude Code plugins, Crush calls itself compatible, and Gemini CLI sets `CLAUDE_PROJECT_DIR`. No neutral standard covers hooks: Agent Plugins 1.x leaves them out on purpose. ACP's proxy chains are a draft. AGENTS.md carries instructions only. | read in docs |
| 5 | Third parties | An outside author needs three things: a published entry point that applies the C8 rules, a mapping table per harness, and a conformance kit. The ACP TCK and the MCP conformance suite are working kits of that kind. Agent Plugins has only a checklist. | read in docs; inferred |

## Findings

**1. Extension points per harness.** ✓ means present, ✗ means absent, ~ means partial or unproven. "Ctx" is text the model sees.

| Harness (revision) | After tool: ctx | End of turn: continue | Session start: ctx | Idle wake | Deny before a tool | MCP | Packaging |
|---|---|---|---|---|---|---|---|
| Cursor agent + CLI (docs) | ✓ `postToolUse` `additional_context` | ✓ `stop` `followup_message`; `loop_limit` 5 (null for Claude Code hooks) | ✓ `sessionStart` `additional_context` (not in cloud agents) | ✗ | ✓ `preToolUse` `permission: deny` + `agent_message` | tools, prompts, resources, roots, elicitation, apps | `hooks.json` at enterprise, team, project and user level; Cursor plugins carry hooks; reviewed Marketplace; loads `.claude/settings*.json` hooks by default |
| Gemini CLI 0.67.0-nightly | ✓ `AfterTool` `additionalContext` | ✓ `AfterAgent` `decision: deny`: `reason` becomes a new prompt | ✓ `SessionStart` `additionalContext` | ✗ (model steering is text the user types, experimental) | ✓ `BeforeTool` deny, reason sent to agent | tools, prompts, resources by @-mention; handles only `list_changed` and progress | `settings.json`; project hooks fingerprinted; `gemini extensions install <git>` with `hooks/hooks.json`; `--acp` |
| Copilot CLI (docs) | ✓ `postToolUse` `additionalContext` (10 KB cap) | ✓ `agentStop` `decision: block`; cap of 8 | ✓ `sessionStart` `additionalContext` | ~ `notification` hook: its `additionalContext` "can trigger further agent processing if the session is idle", but it fires only on harness notifications (`shell_completed`, `agent_idle` of a background agent) | ✓ `preToolUse` deny | tools (rest not read) | `.github/hooks/*.json`, `~/.copilot/hooks`, `.claude/settings*.json`, policy dir; `copilot plugin install`, `marketplace.json` (also under `.claude-plugin/`); Agent Plugins 1.0/1.1; sandboxed hooks; `--acp` |
| Copilot cloud agent (docs) | ✓ | ✓ (counts against the job timeout) | ✓ once per job | ✗ non-interactive | ✓ | not read | only `.github/hooks/*.json` in the clone; sandbox is ephemeral and firewalled |
| Factory Droid (docs) | ✓ `PostToolUse` `hookSpecificOutput.additionalContext`; exit 2 stderr goes to Droid | ✓ `Stop` `decision: block` | ✓ | ✗ | ✓ | tools (resources not stated) | `~/.factory/hooks.json`, `.factory/hooks.json`; `.factory-plugin/`; Claude Code plugin layouts translated at install |
| Kiro IDE + CLI V3 (docs 2026-10-21) | ✓ exit 0 stdout "is added to the agent's context" at every trigger | ~ Agent Stop stdout goes to context; whether a turn starts is not stated; an agent-prompt action always starts a loop | ✓ IDE, CLI V3 | ✗ | ✓ non-zero exit blocks PreToolUse; stderr goes to agent | tools, prompts, resources (# mention) | `.kiro/hooks/*.json`, `~/.kiro/hooks/` (CLI V3); Agent Plugins |
| Amp (docs) | ~ `tool.result` may replace `output` (no append field) | ✓ `agent.end` `{action:'continue', userMessage}`; cap 5 | ~ `session.start` has no result; per-turn `agent.start` appends a message | ~ `thread.append(user-message)` with `steer` (whether it starts a turn on an idle thread: inferred) | ✓ `tool.call` `reject-and-continue` | tools (rest not read) | in-process TS: `.amp/plugins/`, `~/.config/amp/plugins/`, personal and workspace plugin repositories, `amp plugins add <url>` |
| Cline CLI 3.0.73 / VS Code 4.1.25 | ✓ `afterTool` `appendContext` | ✗ `afterRun` returns nothing | ✓ `beforeRun` `appendContext` (first request) | ✓ `ctx.emitEvent('steer_message')` pushes into the session | ✓ `beforeTool` `skip` + reason | VS Code: tools, resources; MCP log messages stored, `setNotificationCallback` never called | SDK plugin in a worker thread, 3 s hook timeout; `cline plugin install` from npm, git, URL or path; `.cline/plugins` |
| Goose 1.56.0 | ✗ `PostToolUse` observation only | ✓ `Stop` block; cap `GOOSE_STOP_HOOK_BLOCK_CAP` | ✗ observation only | ✗ | ✓ `PreToolUse` block | MCP-native; per-turn context only from built-in extensions (`get_moim` returns `None` for MCP clients) | `~/.agents/plugins/<n>/hooks/hooks.json`, `<project>/.agents/plugins/` |
| Windsurf / Devin Desktop (docs) | ~ post-hooks: exit 2 "the Cascade agent will see the error message from stderr" | ✗ `post_cascade_response` is asynchronous | ✗ no event | ✗ | ✓ `pre_*` hooks, exit 2 | tools, resources, prompts | system, user and `.devin/hooks.json` (legacy `.windsurf/`); not in Restricted Mode |
| OpenHands SDK 1.58.1 | ✗ PostToolUse results not injected | ✓ `Stop` deny returns feedback | ✓ `SessionStart` and `UserPromptSubmit` `additional_context` | ✗ | ✓ | not read | `.openhands/hooks.json`, user dir; Agent Plugins |
| Crush @136d4a6 | ~ only `PreToolUse` exists; its `context` is "appended to what the model sees" | ✗ | ✗ | ✗ | ✓ exit 2 | not read | `crushrc` `hook add`; "Claude Code-compatible" |
| Zed agent (docs main) | ✗ | ✗ | ✗ | ✗ | ✗ | tools, prompts, `tools/list_changed` | ACP client; external agents (Claude, Codex, Gemini, OpenCode, Copilot, Cursor, Pi) keep their own hooks |
| Roo Code 3.53.0 (last commit 2026-05-15) | ✗ | ✗ | ✗ | ✗ | ✗ | tools, resources | experimental custom tools in `.roo/tools/` |
| Aider 0.86.3.dev (last commit 2026-05-22) | ~ `--lint-cmd`, `--test-cmd --auto-test` after each edit; output goes to the model only on a non-zero exit | ✗ | ✗ | ✗ | ✗ | none in source | CLI flags |
| Continue CLI @5522c6f (2026-07-20) | ✗ | ✗ | ✗ | ✗ | ✗ | not read | hook types and a loader that reads `.claude/settings*.json`; no `fire*` function is called outside `src/hooks/` |

The Cursor rows, the Copilot rows, Amp, Kiro, Windsurf and Factory Droid are read in official docs. Gemini CLI, Goose, Cline, OpenHands, Crush, Roo Code, Aider and Continue are read in source code, with their docs as well. Others found: Hermes Agent, OpenClaw, Grok Bot and NanoClaw are listed as Agent Plugins clients for skills and MCP; they were not studied. Claude Code channels appear under question 3.

**2. Classes, against C8's rules.** The C8 rules are R1–R12:

- R1: registration injects the header and the primer.
- R2: each tool boundary delivers the delta.
- R3: a seen regression denies one edit, once.
- R4: an end of turn speaks only with news.
- R5: the idle wake.
- R6: the consumer's turn state lives in `meta`.
- R7: liveness is told once per change.
- R8: one uncovered-edit line after an edit.
- R9: the harness process is recorded at registration.
- R10: a newer hook claims the handoff.
- R11: every hook of a session uses the root its session start resolved.
- R12: a failing hook is silent and stays within its budget.

| Class | Members | Holds | Cannot hold |
|---|---|---|---|
| A. Full hook scripts | Cursor, Gemini CLI, Copilot CLI, Factory Droid, Kiro (+ Claude Code, Codex) | R1–R4, R6–R8, R10, R12. R9 holds where hooks are child processes (inferred). R11 needs a session id and a cwd in every payload: Cursor's common schema has `conversation_id` and `workspace_roots` but no `cwd`. | R5, except partly in Copilot CLI. R12 needs care: Kiro puts all exit-0 stdout into context, and Goose reads stdout strictly. Copilot's session sandbox gives hooks only the agent's shell access, which may block the store and the daemon spawn (inferred). |
| A′. Partial hooks | Goose, OpenHands (no R2); Windsurf (R3 only, R2 unproven); Crush (R3, plus R2 one tool late); Copilot cloud agent (no R5, ephemeral) | R3 everywhere; R4 in Goose and OpenHands; R1 in OpenHands | R2 in Goose and OpenHands: news waits for the end of the turn, which breaks "feedback arrives without blocking work" in practice. |
| B. In-process plugin | Amp, Cline (+ Pi, OpenCode) | R1–R4, R6–R8, R10–R12. R5 through Cline `steer_message` and Amp `thread.append` (inferred for Amp). R9 is trivial: the process is the harness. | Cline has no R4 continue. Amp has no session-start text: the primer would go in the first `agent.start`. Cline gives each hook 3 s, then marks the plugin degraded. |
| C. ACP proxy | any ACP agent behind a proxy chain (RFD Draft) | R1 at `session/new` and the first prompt; R4 and R5 by sending the agent a prompt itself (the Sparkle example) | R2: a proxy sees `tool_call` updates but adds text only at prompt boundaries. R3 works only through `session/request_permission`, when the agent asks (inferred). |
| D. MCP only | Zed agent, Roo Code | pull (`status`) and commands as tools; the primer through the server `instructions` where the client delivers them | R1 (no reliable delivery), R2–R5 |
| E. After-edit command | Aider | R2 on failure only; R8 | recoveries (exit 0 output is not sent, inferred); R3–R5. The command blocks every edit. |

**3. MCP.** The 2025-11-25 spec calls resources "application-driven": `resources/subscribe` and `notifications/resources/updated` go to the client, and the host decides what reaches the model. The 2026-07-28 revision removes the handshake and the session. It replaces subscribe with `subscriptions/listen`. It sends `notifications/message` only for requests that asked for a log level (changelog items 2, 4, 5). Of the clients read:

- Gemini CLI handles `list_changed` and progress only.
- Zed handles `tools/list_changed` only.
- Cline stores log notifications but never wires the callback that would deliver them.
- Goose adds per-turn context only from built-in extensions.
- Cursor and Windsurf say they support resources but say nothing about subscriptions.

The one push path found is Claude Code channels. A server declares `experimental['claude/channel']` and emits `notifications/claude/channel`, and the text arrives as a `<channel>` tag in context. Channels are a research preview, opted in per session with `--channels`, limited to an allowlist and Claude only. Claude Code does not register a channel on protocol 2026-07-28. Verdict: MCP is a pull channel. Pull through an MCP tool plus push through a hook covers C8 where hooks exist. In a class D harness, Squeal could attach the delta to any Squeal tool result, but only when the agent chooses to call one (inferred).

**4. Convergence.** De facto: Claude Code's hooks.

- Cursor maps eight Claude Code events (`PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `Stop`, `SubagentStop`, `SessionStart`, `SessionEnd`, `PreCompact`). It accepts `hookSpecificOutput` and treats a `Stop` `decision: block` as a follow-up.
- Copilot CLI accepts PascalCase "VS Code compatible" names with snake_case fields. It reads `.claude/settings*.json` and loads `.claude-plugin/plugin.json` and `marketplace.json`.
- Factory Droid installs Claude Code plugins by renaming `.claude-plugin/` to `.factory-plugin/`.
- Continue loads `.claude/settings*.json`.
- Crush calls its hooks "broadly compatible".
- Gemini CLI sets `CLAUDE_PROJECT_DIR`.

The format diverges where Squeal depends on it. `PostToolBatch` (Squeal's primary push, `plugins/claude-code/hooks/hooks.json`) and `asyncRewake` appear in no other harness. The context field is `hookSpecificOutput.additionalContext`, `additional_context`, flat `additionalContext` or plain stdout, depending on the harness. The continue field is `decision: block`, `followup_message` or `decision: deny`. Continuation caps are 5, 8 or configurable.

Formal efforts:

- **Agent Plugins** 1.0/1.1 is backed by a technical steering committee from Amazon, Cursor, Microsoft, OpenAI and Vercel. Clients include VS Code, Cursor, Copilot, Codex, Kiro and OpenHands. It covers skills and MCP only. Hooks are "too client-specific … until their formats converge" and go in a reverse-domain directory. `open-plugins.com`, which Goose's hook docs cite, now redirects there.
- **ACP** is led by maintainers from Zed and JetBrains. It has an agent registry and a TCK. "Proxy chains", which claims to subsume hooks, is a Draft RFD.
- **AGENTS.md** is stewarded by the Agentic AI Foundation under the Linux Foundation, and carries instructions only.

**5. Third parties.** Today an adapter is Squeal-internal code. The Claude Code adapter is 555 lines, Codex 703, Pi 930 and OpenCode 1,971, on top of 3,505 lines in `src/harness/shared` (non-test `.ts`, `wc -l`, read in source code). An outside author would need three things (inferred):

1. For class A, one published entry point that applies R1–R12 given an event kind, a consumer and a root, and returns text or a decision. The adapter is then data: event names, the payload paths of the session id, agent id and cwd, the output envelope and the caps.
2. For class B, a published client library over the daemon and the store, in the form the Pi and OpenCode adapters use internally.
3. A conformance kit that drives the adapter through registration, a tool boundary, a deny-once, a quiet stop, a stop with news, a wake and a dead daemon in a scratch HOME. It checks the text that reaches the model, the way the 009 probes did with a fake provider.

Two existing kits have this shape. The **ACP TCK** launches the agent as a subprocess and reports each requirement as pass, fail, not applicable or never exercised, with its spec citation and a tier: mandatory, capability-dependent, recommended or informational. It is experimental. The **MCP conformance** framework runs `npx @modelcontextprotocol/conformance client|server` scenarios and suites. Agent Plugins offers a non-normative checklist only.

## Recommendation for Squeal

1. **Next harnesses, by cost.** Cursor, Copilot CLI, Gemini CLI and Factory Droid are class A, so they need only a mapping onto the existing hook code. Each needs `PostToolUse` as the push in place of `PostToolBatch`, and each lacks R5. Cursor and Copilot already read `.claude/settings.json`, so a trial costs one settings entry, but only the events they map will fire (questions 1 and 4). Kiro comes next; its stdout rule needs a silent hook.
2. **Amp and Cline** follow the Pi and OpenCode pattern (class B). They are the only new harnesses with an idle push. They need a published client library, not hook binaries.
3. **MCP as the fallback** for class D (Zed agent, Roo Code): status and run commands as tools, two of principle 6's three operations, with no claim of push. Do not build on channels or resource subscriptions (question 3).
4. **Do not wait for a hooks standard.** None exists for hooks, and the de facto one diverges exactly at batch push and wake. Make the harness contract "C8 behind one entry point plus per-harness data" (question 5). Agent Plugins can carry the skill and MCP parts to every client listed in question 4 at once, but not the hooks.
5. **Watch ACP proxy chains.** One proxy would reach every ACP agent in Zed and JetBrains, but it is a Draft and cannot push at tool boundaries.
6. **Model the kit on the ACP TCK:** requirement IDs that cite C8 rules, capability tiers and four verdicts. Then a partial harness (classes A′, C, D) can be reported honestly instead of being rejected.
7. **Skip Aider, Roo Code and Continue for now.** Aider's command blocks every edit and stays silent on recoveries, Roo Code has no lifecycle events, and Continue has no hooks wired. None of their repositories has a commit after 2026-07-20.

Limits: nothing here was run. Docs for Cursor, Copilot, Amp, Kiro and Windsurf change weekly and carry no version, so re-read them before a spec row.

## Open questions

- Does Cursor load hooks from Claude Code *plugins* (Squeal ships a plugin) or only from settings files? Does the Cursor CLI fire every agent hook? Not stated in its docs. A run under `squeal-e2e` decides it.
- Does Copilot CLI load Squeal's `.claude-plugin` layout and ignore `PostToolBatch` silently? Can the `notification` hook wake an idle main agent? Do sandboxed hooks reach `$XDG_RUNTIME_DIR` and the store?
- Does Windsurf's post-hook exit 2 put stderr in the model's context? Does a Kiro Stop command action start a turn? Does Amp `thread.append` start a turn on an idle thread? Docs only; each needs a run.
- Is each class A hook a child of the harness process (R9's walk)? Not determined: no harness was run.
- Installing and running these harnesses needs the human's approval under the isolation rules (a throwaway user, no credentials of the agent user).

## Sources

Fetched 2026-10-24. Clones were shallow, under `/tmp/hl016`, and removed afterwards.

- Cursor: https://cursor.com/docs/agent/hooks, https://cursor.com/docs/reference/third-party-hooks, https://cursor.com/docs/plugins, https://cursor.com/docs/mcp
- Gemini CLI `google-gemini/gemini-cli` @cd1b45c2 (0.67.0-nightly.20261020): `docs/hooks/reference.md`, `docs/hooks/index.md`, `docs/extensions/reference.md`, `docs/cli/model-steering.md`, `docs/cli/acp-mode.md`, `packages/core/src/tools/mcp-client.ts`
- GitHub Copilot: https://docs.github.com/en/copilot/reference/hooks-configuration, https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-hooks, https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference, https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference
- Amp: https://ampcode.com/docs/plugin-api, https://ampcode.com/docs/customize/plugins, https://ampcode.com/docs/customize/mcp
- Goose `block/goose` @2b17adc (1.56.0): `documentation/docs/guides/context-engineering/hooks.md`, `crates/goose/src/agents/moim.rs`, `crates/goose/src/agents/mcp_client.rs`
- Aider `Aider-AI/aider` @5dc9490 (0.86.3.dev): `aider/website/docs/usage/lint-test.md`, `aider/coders/base_coder.py`
- Cline `cline/cline` @40c5d99: `docs/sdk/plugins.mdx`, `docs/customization/plugins.mdx`, `docs/sdk/plugin-examples.mdx`, `apps/vscode/src/services/mcp/McpHub.ts`
- Roo Code `RooCodeInc/Roo-Code` @b867ec9 (3.53.0): `apps/docs/docs/features/experimental/custom-tools.md`
- Kiro: https://kiro.dev/docs/hooks, https://kiro.dev/docs/hooks/types, https://kiro.dev/docs/hooks/actions, https://kiro.dev/docs/mcp
- Windsurf / Devin Desktop: https://docs.windsurf.com/windsurf/cascade/hooks, https://docs.windsurf.com/windsurf/cascade/mcp
- Zed: https://raw.githubusercontent.com/zed-industries/zed/main/docs/src/ai/mcp.md, `.../docs/src/ai/external-agents.md`
- Factory Droid: https://docs.factory.ai/reference/hooks-reference, https://docs.factory.ai/cli/configuration/plugins, https://docs.factory.ai/cli/configuration/mcp
- Crush `charmbracelet/crush` @136d4a6: `docs/hooks/README.md`, `docs/hooks/FUTURE.md`
- OpenHands `OpenHands/software-agent-sdk` @acd96e6 (1.58.1): `openhands-sdk/openhands/sdk/hooks/{types,conversation_hooks,config}.py`
- Continue `continuedev/continue` @5522c6f: `extensions/cli/src/hooks/*.ts`
- ACP `agentclientprotocol/agent-client-protocol` @9944b85: `MAINTAINERS.md`, `docs/rfds/proxy-chains.mdx`, `docs/rfds/mcp-over-acp.mdx`, `docs/rfds/session-notices.mdx`, `docs/libraries/testing.mdx` (ACP TCK), `docs/docs.json` (RFD stages)
- Agent Plugins `agentplugins/agent-plugins-spec` @ff8ab5e (`spec/1.1.0.md` line 608, `MAINTAINERS.md`), `agentplugins/agent-plugins-site` @f399975 (`lib/compatible-clients.ts`), https://agent-plugins.org/client-implementers/conformance.md
- MCP: `modelcontextprotocol/modelcontextprotocol` main, `docs/specification/2025-11-25/server/resources.mdx` and `docs/specification/2026-07-28/changelog.mdx`; https://github.com/modelcontextprotocol/conformance README
- Claude Code channels: https://code.claude.com/docs/en/channels.md, https://code.claude.com/docs/en/channels-reference.md
- AGENTS.md: https://agents.md/
- Squeal at HEAD 0822a444: `docs/specifications/011-core/spec.md` C8 and C14, `src/core/types/delivery.ts`, `plugins/claude-code/hooks/hooks.json`, `src/harness/*`
