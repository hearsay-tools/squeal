# Research: claude-code-integration

Researcher task, 2026-10-03. Claude Code 2.1.286 and 2.1.288 (the CLI auto-updated mid-session; each probe log records its version). Model under test: `claude-sonnet-5-5`. Probes, exact hook configs and sanitized logs: `probes/claude-code-integration/` (throwaway, see its README).

## Questions answered

1. Packaging: plugin vs hooks written into `.claude/settings.json`.
2. PreToolUse deny via JSON and via exit 2, and the matcher for edit tools and Bash.
3. PostToolUse / PostToolBatch `additionalContext`: same turn? Latency?
4. `asyncRewake` while idle, mid-turn, during a long Bash call. Re-arming.
5. Session and subagent identifiers. Per-agent context injection.
6. Timeouts, a hanging hook, a dead daemon.
7. Equivalent injection points in Codex, Pi, OpenCode.

## Findings

### 1. Packaging

- A plugin is a directory with optional `.claude-plugin/plugin.json`, plus `skills/`, `commands/`, `agents/`, `hooks/hooks.json` (same shape as the `hooks` key in settings), `.mcp.json`, `bin/` (added to the Bash tool's `PATH`), `monitors/monitors.json`, and a few more. Plugin hooks register when the session loads the plugin and fire on every matching event from then on, not only when a plugin skill is used. *read in official docs (plugins/components, 2.1.288)*
- Install: add a marketplace (GitHub repo, git URL, local dir, or `npm` source), then `claude plugin install squeal@<marketplace> --scope user|project|local`. Project scope writes `enabledPlugins` into the committed `.claude/settings.json`, but each collaborator still has to install it once. `--plugin-dir <path>` loads a plugin for one session without installing it. *read in official docs (plugins/install, marketplace-reference)*
- Scripts are referenced with `${CLAUDE_PLUGIN_ROOT}`. It changes on every plugin update, so state belongs in `${CLAUDE_PLUGIN_DATA}` (`~/.claude/plugins/data/<id>/`, kept across updates) or, for Squeal, in the shared repo store. *read in official docs (manifest-reference)*
- Probe `plugin`: `hooks/hooks.json` with `"command": "${CLAUDE_PLUGIN_ROOT}/scripts/ctx.sh", "args": []` loaded via `--plugin-dir`. The hook received `CLAUDE_PLUGIN_ROOT=<probe>/plugin-probe` and `CLAUDE_PROJECT_DIR=<session project>`, and its `additionalContext` reached the model (it reported nonce `plugin-5150`). *verified by experiment (2.1.288)*
- Writing hooks into `.claude/settings.json` from an init command also works (every other probe used project settings). Its costs: the command path must resolve on every collaborator's machine (absolute path, global install, or `npx`, whose cold start is far above a 100 ms budget). The hook config is merged with the user's own hand edits, so upgrades must rewrite JSON the user owns. Each repo also needs its own init. *inferred*
- Plugins can also ship `monitors`: background commands whose output lines reach Claude as notifications, interactive sessions only. *read in official docs*. Not tested.

### 2. PreToolUse deny

Hook config (`scenarios/pretooluse`):

```json
"PreToolUse": [
  { "matcher": "Edit|Write|NotebookEdit", "hooks": [{ "type": "command", "command": "\"$PROBE_HOOKS/deny-json.sh\"" }] },
  { "matcher": "Bash", "hooks": [{ "type": "command", "command": "\"$PROBE_HOOKS/deny-exit2.sh\"" }] }
]
```

- JSON deny (`permissionDecision: "deny"`, exit 0): the tool did not run. The model got an error tool result in the same turn and continued to its next step. *verified by experiment (2.1.286)*
  `{"tool_result":"PreToolUse:Write hook error: SQUEAL-PROBE: tests/auth.test.ts is FAIL at revision 7; writing forbidden.txt is blocked. Write the same content to allowed.txt instead.","is_error":true}`
- Exit 2 + stderr: same routing. The result also includes the hook command string. *verified by experiment*
  `{"tool_result":"PreToolUse:Bash hook error: [\"$PROBE_HOOKS/deny-exit2.sh\"]: SQUEAL-PROBE-EXIT2: the date command is blocked ...","is_error":true}`
- The model read both reasons and moved on in the same turn. It did **not** follow the instruction inside the reason ("write allowed.txt instead"). It said "I didn't write `allowed.txt` ... because you asked for neither." Text that comes from a hook is labelled `hook error` and does not carry user authority. The docs also warn that imperative, system-style text can trigger prompt-injection defences. *verified by experiment; read in official docs*
- Matcher: 2.1.288 has no `MultiEdit` tool. The init tool list is `Bash, Edit, NotebookEdit, Write, ...`, and Glob/Grep are absent on Linux by default. `Edit|Write|NotebookEdit` catches every file-editing tool; add `|Bash` (or use a second group) for shell. A regex like `Edit` would also match `NotebookEdit`. `Bash` edits never fire `Edit|Write` hooks, so Squeal's own watcher must stay the source of truth for changes. *verified by experiment (tool list); read in official docs (matchers)*

### 3. PostToolUse and PostToolBatch `additionalContext`

Config: `PostToolUse` (matcher `*`) and `PostToolBatch` (no matcher). Each returns `{"hookSpecificOutput":{"hookEventName":"<event>","additionalContext":"Squeal status note: nonce <event>-<random> ..."}}`.

- Both nonces from every tool call appeared in the model's very next text, before its next tool call, within one turn. Example: `"Newest Squeal notes: PostToolUse-cc5e7401 and PostToolBatch-ff8e4c70."` *verified by experiment (2.1.286, `-p`)*
- The hooks run in sequence: tool end, then PostToolUse, then PostToolBatch, then the API request. Timeline from `logs/posttool.timeline.txt`, three Bash calls:

| | tool end to PostToolUse ctx | to PostToolBatch ctx | to next API request |
|---|---|---|---|
| call 1 (cold) | 94 ms | 197 ms | 820 ms |
| call 2 | 82 ms | 168 ms | 260 ms |
| call 3 | 87 ms | 168 ms | 247 ms |

  Each probe hook (bash + `jq`) cost about 80 to 100 ms, and that time is added directly to the agent's loop. *verified by experiment*
- PostToolBatch fires once per batch of parallel calls. PostToolUse fires per tool, concurrently. *read in official docs*
- Injected context is persisted in the transcript and replayed on `--resume`. It is not recomputed. *read in official docs*

### 4. `asyncRewake`

Waiter script: sleep N seconds, print a note to stderr, exit 2 (`hooks/rewake.sh`). Config fragment:

```json
{ "type": "command", "if": "Bash(echo arm-mid*)", "command": "\"$PROBE_HOOKS/rewake.sh\" mid 3", "asyncRewake": true }
```

- **(a) Idle, interactive:** a SessionStart waiter (25 s) exited 2 while no prompt had ever been sent. Claude started a turn on its own 38 ms later (exit 08:29:39.277, user message 08:29:39.315). Delivered as a user message: *verified by experiment (2.1.286 and 2.1.288)*
  `<task-notification><summary>Stop hook feedback</summary></task-notification><system-reminder>Stop hook blocking error from command "SessionStart:startup": Squeal status note: check tests/auth.test.ts went PASS -> FAIL ...</system-reminder>`
  The label says "Stop hook" whatever the source event. The woken agent acted on its own: it ran `npx vitest run` and `git status` before replying.
- **(b) Mid-turn, interactive:** the waiter exited at 19.598 while the model was generating. The message was queued at 19.600 (`queued_command` attachment). The model saw it after the next tool result (20.850), so 1.25 s later, still in the same turn. *verified by experiment (2.1.288)*
- **(c) During a long Bash call, interactive:** the waiter exited at 30.604 during `sleep 20; echo slept` (29.637 to 49.984). The tool was not interrupted. The model saw the note only after the command finished, 19.4 s later. *verified by experiment (2.1.288)*
- **In `-p` mode, `asyncRewake` is not asynchronous.** The hook blocked the loop until it exited ("Slow PostToolUse hooks: 3085ms") and its stderr was attached to that tool result. Plain `async: true` in `-p` did run in the background. Its output was polled at each tool boundary and attached at the first boundary after it exited (exit 15.166, delivered 15.575). *verified by experiment (2.1.286 and 2.1.288)*. Not documented.
- **Re-arming:** nothing re-arms automatically. Each firing of the configured event spawns a new process, with no deduplication. A `Stop` waiter re-armed itself at the end of every woken turn and fired twice more (`logs/rewake-idle.*`). A waiter that blocks until a real transition therefore gives a loop of wake, turn, Stop, re-arm. *verified by experiment; read in official docs*
- **Timeout:** `timeout` is enforced on `asyncRewake` (default 600 s). A waiter with `timeout: 5` and a 15 s sleep was killed silently, with no wake and no log line. *verified by experiment (2.1.288)*
- The hook environment tells the modes apart: `-p` has `CLAUDE_CODE_ENTRYPOINT=sdk-cli` and `CLAUDE_CODE_SESSION_ATTENDED=0`; interactive has `cli` and `1` (`logs/entrypoint.env.log`). *verified by experiment; undocumented, may change*

### 5. Identifiers and subagents

- Every hook gets `session_id`, `transcript_path`, `cwd`, `hook_event_name`, and on turn events also `prompt_id`. Inside a subagent, `agent_id` (e.g. `a54374d4ee2bc54fb`) and `agent_type` are added. The subagent keeps the parent's `session_id`. *verified by experiment (`logs/subagent.hooks.trim.jsonl`)*
- SubagentStart and SubagentStop fire. PostToolUse and PostToolBatch also fire inside the subagent, carrying its `agent_id`.
- Context is isolated in both directions. The subagent reported only its own nonces (SubagentStart, PostToolUse, PostToolBatch). The parent reported only its own nonces and none of the subagent's. *verified by experiment*
- `cwd` follows `cd` and worktree entry, while `CLAUDE_PROJECT_DIR` stays at the session root. Hooks get no git or worktree identity, so Squeal must derive the worktree from `cwd`. *read in official docs; inferred*

### 6. Timeouts and failure modes (`scenarios/failures`, `-p`, 2.1.288)

| Case | Agent impact | Model sees |
|---|---|---|
| PreToolUse hook hangs, `timeout: 3` | blocked 3031 ms, then the tool ran normally | nothing |
| Script path missing (exit 127) | none | nothing (user sees `hook error`) |
| Exit 1 + stderr "daemon socket refused" | none | nothing |
| Hook leaves a child holding stdout | about 517 ms extra per call | nothing |
| Child fully detached (`setsid nohup ... </dev/null >/dev/null 2>&1 &`) | none measurable | nothing |

- The default timeout is 600 s for command hooks. A hook stuck on a dead daemon stalls the agent for up to 10 minutes per event unless `timeout` is set. On PreToolUse a timeout fails open. *verified by experiment; read in official docs*
- Plain-text stdout is not shown to the model except on SessionStart, UserPromptSubmit and a few others. Output must be one JSON object; a shell profile that prints text breaks parsing. `additionalContext` is capped at 10,000 characters, and the overflow goes to a file the model is not told to read. *read in official docs*

### 7. Other harnesses (docs only)

**Codex** (developers.openai.com/codex/hooks, read 2026-10-03). Codex has a near-copy of Claude Code's hook model in `hooks.json` or `[hooks]` in `config.toml`, user or repo level, and plugins can bundle hooks. Events: SessionStart, PreToolUse, PermissionRequest, PostToolUse, UserPromptSubmit, SubagentStart/Stop, Stop, Pre/PostCompact, Interrupt. PostToolUse `additionalContext` becomes developer context. `decision: "block"` or exit 2 replaces the tool result with feedback. Stop with `block` continues the turn with `reason` as a new prompt. `async: true` hooks deliver their output "at the next safe point": after the current model request and tool calls if a turn is active, otherwise at the next user turn. A finished background hook never starts a turn, so there is no `asyncRewake` equivalent. Subagent hooks reuse the parent `session_id`; there is a `turn_id`. Project hooks need a trust review.

**Pi** (earendil-works/pi `main` @ a276dab, `docs/extensions.md`, `extensions/types.ts`). Pi has in-process TypeScript extensions instead of shell hooks. `pi.on()` events include `tool_call` (mutate or block), `tool_result` (compose or replace results), `turn_end` and `agent_before_settle` (append entries, request one continuation), `session_start` and `session_shutdown`. Push: `pi.sendMessage(msg, { deliverAs: "steer" | "followUp" | "nextTurn", triggerTurn })`. "steer" enters after the current assistant turn and its tool calls; "followUp" after the run finishes. A long-lived extension can hold a socket to the Squeal daemon and steer on transition, which is the cleanest mid-turn push of the four. Long-lived resources must start in `session_start`, not in the factory.

**OpenCode** (sst/opencode `dev` @ 907b3bc, opencode.ai/docs/plugins, `packages/plugin/src/index.ts`). OpenCode also has in-process JS/TS plugins (`.opencode/plugins/`, `~/.config/opencode/plugins/`, or npm via `opencode.json`). Hooks: `tool.execute.before` (mutate args, throw to block) and `tool.execute.after` (can rewrite `output.output`, so a Squeal delta can be appended to a tool result), `experimental.chat.system.transform`, `experimental.chat.messages.transform`. The `event` hook also exposes `session.idle`, `file.edited` and others. Idle push goes through the SDK client: `client.session.prompt({ body: { noReply: true, ... } })` adds context without a reply. Omitting `noReply` starts a turn.

## Recommendation for Squeal

1. **Ship a Claude Code plugin**: `hooks/hooks.json`, scripts in the plugin, a `squeal-status` skill or `bin/squeal` for pull. Keep a `squeal init` that only adds the marketplace and the `enabledPlugins` entry to project settings, never raw hook commands. Every Squeal hook script must exit 0 within a few ms in repos without Squeal, because enabled plugins fire everywhere.
2. **Primary push: synchronous `PostToolBatch`.** It reads the shared store, computes the delta against the cursor last told to `(session_id, agent_id ?? "main")`, prints `additionalContext` or nothing, and advances the cursor. It is verified same-turn and costs about 80 to 100 ms with bash+jq, so the real script must stay under about 50 ms (one Node start plus one read). PostToolBatch also fires inside subagents and delivers there in isolation, so per-agent cursors work. Phrase the text as facts ("Squeal: tests/auth.test.ts PASS -> FAIL at revision 184"), never as instructions.
3. **Idle push: one `asyncRewake` waiter per session**, interactive only. Arm it on `SessionStart` and re-arm on `Stop`. It blocks on the daemon until there is an undelivered transition, then exits 2 with the delta. Use a per-session lock so only one waiter runs. Set an explicit long `timeout` and accept silent expiry plus re-arm. Skip arming when `CLAUDE_CODE_ENTRYPOINT=sdk-cli` / `CLAUDE_CODE_SESSION_ATTENDED=0`, because in `-p` the waiter would block the agent. Undocumented, so treat it as a guard and test it on every upgrade.
4. **Do not deny tool calls by default.** PreToolUse deny works but does not steer the model (it ignored the suggested alternative). Reserve it for an explicit policy such as "no commit while known failures exist".
5. **Never block:** set `timeout` of 1 to 2 s on every synchronous Squeal hook. Exit 0 with no output on any internal error (exit 1 is a silent non-blocking error anyway). Start the daemon fully detached with `setsid` and closed stdio, or each call pays about 0.5 s.
6. Adapter interface implied by all four harnesses: `onToolBoundary(sessionKey) -> delta | none` (sync, fast), `waitForTransition(sessionKey) -> delta` (async wake where supported), and `status()` for pull. Codex lacks a wake, while Pi and OpenCode can push from a long-lived in-process client.

## Open questions

- A long Bash or test command delays every delivery until it ends (19.4 s observed). Should Squeal also ship a plugin `monitor` (not tested) or rely on the agent not running long commands?
- How do Stop-armed waiters behave across `/clear`, compaction and `--resume`? Not tested.
- Do the undocumented `CLAUDE_CODE_ENTRYPOINT` and `CLAUDE_CODE_SESSION_ATTENDED` stay stable? Is there a documented way to tell `-p` apart?
- `asyncRewake` messages are framed as "Stop hook blocking error". Does that framing make models over-react, as in the idle probe where it ran tests unasked, or under-react? It needs a wording test with real failures.
- Background subagents (the interactive default) were not probed. Their PostToolBatch timing relative to the parent is unverified.
- Agent SDK callback hooks (in-process, PreToolUse timeout fails closed) were not covered.

## Sources

- https://code.claude.com/docs/en/hooks, https://code.claude.com/docs/en/hooks-guide, https://code.claude.com/docs/en/plugins, https://code.claude.com/docs/en/plugins/components, https://code.claude.com/docs/en/plugins/manifest-reference, https://code.claude.com/docs/en/plugins/install, https://code.claude.com/docs/en/tools-reference (fetched 2026-10-03)
- https://developers.openai.com/codex/hooks (fetched 2026-10-03)
- https://github.com/earendil-works/pi `packages/coding-agent/docs/extensions.md`, `docs/sdk.md`, `src/core/extensions/types.ts` @ a276dab
- https://opencode.ai/docs/plugins, https://opencode.ai/docs/sdk, https://github.com/sst/opencode `packages/plugin/src/index.ts` @ 907b3bc
- Probes: `probes/claude-code-integration/` (scenario configs in `scenarios/*/.claude/settings.json`, evidence in `logs/`)
