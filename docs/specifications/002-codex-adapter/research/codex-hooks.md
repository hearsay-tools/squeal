# Research: Codex hooks for the Squeal adapter

Board row 002-01. Codex CLI 0.160.1 (source tag `rust-v0.160.1`, `d27764b`), run 2026-10-07 on this host. Probes and trimmed logs: `probes/codex-hooks/`. Spec 001 D9 is the shape compared against.

## Questions answered

| # | Question | Short answer | Tag |
|---|---|---|---|
| 1 | Configuration surfaces and trust | `hooks.json` or `[hooks]` at user, repo (`.codex/`), plugin, `-c`/`thread/start config`, managed. Every non-managed hook needs persisted trust (`[hooks.state."<key>"] trusted_hash`), read only from the user config and `-c` layers. A repo cannot trust itself. `-c` can declare and trust a hook without touching any file. Linked worktrees use the main checkout's `.codex/` hooks. | verified by experiment; read in source code |
| 2 | Events and payloads | 11 of 12 events fired; PermissionRequest needs an approval prompt, which `approval_policy = "never"` never raises. Main-thread payloads carry `session_id` (= thread id), `turn_id`, `cwd`, `transcript_path`, `model`, `permission_mode`. Subagent tool events add `agent_id` and `agent_type`. No batch event: PostToolUse fires once per tool call. | verified by experiment |
| 3 | Mid-turn injection | PostToolUse `additionalContext` reached the model before its next step, 3 of 3. Tool output to next model request: 99 to 118 ms with a bash hook. SessionStart and UserPromptSubmit injection work; about 2,500 tokens before spill, unlimited with `additionalContextLimit: 0`. | verified by experiment |
| 4 | Deny and block | JSON `deny`, legacy `decision: block` and exit 2 all stop the tool; the model sees the reason and continues in the same turn. Edits are `apply_patch` (matcher `apply_patch\|Edit\|Write`); shell is `Bash`. | verified by experiment |
| 5 | Stop | `block` continues the same turn with `reason` as a user-role `<hook_prompt>`. Silent Stop ends it, no extra request. Stop fires under `exec` and app-server; not at an interrupt. Stop cannot add context without a continuation. | verified by experiment; read in official docs |
| 6 | Timeouts, failures, cost | Default 600 s (SessionEnd and Interrupt 1 s, max 3). Hang, exit 1 and invalid JSON are invisible to the model; the turn waits out the timeout. Hooks run under `exec`, TUI and app-server. A trivial hook costs about 3 to 14 ms. | verified by experiment; read in source code |
| 7 | Sandbox | Hooks run unsandboxed. Under `danger-full-access` (Cezar's default here) hooks and the shell tool read `.git/squeal/*.sqlite`, connect to unix sockets and spawn detached children that outlive the session. `workspace-write`/`read-only` could not run at all on this host; source says they deny `connect` on every socket when network is off. | verified by experiment (full access); read in source code (sandboxed) |

## Findings

### 1. Configuration surfaces and trust

- Sources: `~/.codex/hooks.json`, `~/.codex/config.toml` `[hooks]`, `<repo>/.codex/hooks.json` or `config.toml`, plugin `hooks/hooks.json` (or manifest `hooks`), managed `requirements.toml`. All matching hooks from all layers run, concurrently. *read in official docs (developers.openai.com/codex/hooks)*
- One hook, JSON (`.codex/hooks.json`): `{"hooks":{"PostToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"<cmd>","timeout":2}]}]}}`. TOML: `[[hooks.PostToolUse]]` `matcher = "Bash"` then `[[hooks.PostToolUse.hooks]]` `type = "command"`, `command = "<cmd>"`. On the command line: `-c 'hooks.PostToolUse=[{matcher="Bash",hooks=[{type="command",command="<cmd>",timeout=2}]}]'`; the same arrays go in app-server `thread/start` `config` as `"hooks.PostToolUse": [...]`. *verified by experiment*
- Trust is a per-hook hash. `hooks/list` reports a `key` (`<source path>:<event>:<group>:<handler>`, e.g. `/<session-flags>/config.toml:session_start:0:0`; plugins use `<plugin_id>:hooks/hooks.json:...`, path-independent) and a `currentHash`. Trust is `[hooks.state."<key>"] trusted_hash = "<hash>"`, read only from the User and SessionFlags layers (`hooks/src/config_rules.rs:26`). The TUI `/hooks` and app-server write it to the user `config.toml`. A changed hook becomes `modified` and is skipped. *read in source code; verified by experiment*
- An untrusted hook under `codex exec` is skipped with no warning in `--json` or stderr. `-c 'hooks.state={"<key>"={trusted_hash="sha256:..."}}'` (not the dotted form: the key contains dots) trusted a `-c` hook and a repo hook, which then ran with no bypass flag. `hooks.state` in a repo `.codex/config.toml` is ignored. Repo hooks also need the project trusted (`[projects."<path>"] trust_level`) in user or managed config; `-c projects...` did not do it. *verified by experiment (`logs/q1-trust.txt`)*
- In a linked worktree Codex replaces the worktree's hook declarations with the main checkout's `.codex/` hooks (`config/src/loader/mod.rs:1775`). A worktree's edited `hooks.json` was ignored; the listed key was the main checkout path. One trust grant at the main checkout covers every worktree, and the main checkout's working copy is what runs. *verified by experiment; read in source code*
- `--dangerously-bypass-hook-trust` (or `config: {"bypass_hook_trust": true}` on app-server `thread/start`, `app-server/src/config_manager.rs:438`) runs every enabled hook for that invocation, including untrusted plugin hooks, and emits a warning item. *verified by experiment*
- Without editing a user-owned file: only a `-c` / `thread/start` `config` declaration with its own `trusted_hash` (or the bypass flag) runs a hook. Every file surface needs a user-config trust entry once per hash. *inferred from the above*

### 2. Events and payloads

- `codex exec` with shell, `apply_patch`, a subagent: SessionStart (`source: startup`), UserPromptSubmit, Pre/PostToolUse per call, SubagentStart, the subagent's Pre/PostToolUse, SubagentStop, Stop, SessionEnd. TUI in tmux: SessionStart runs at the first prompt, not at launch; Esc gave Interrupt with no Stop and no PostToolUse; `/compact` gave PreCompact and PostCompact (`trigger: manual`), then SessionStart `source: compact` at the next prompt; `/exit` gave SessionEnd. PermissionRequest never fired (approval policy `never`). *verified by experiment (`logs/q2-*`)*
- Fields: every event has `session_id`, `transcript_path`, `cwd`, `hook_event_name`; all but SessionEnd add `model`, `permission_mode`; turn events add `turn_id`. Tool events: `tool_name`, `tool_use_id`, `tool_input` (`{"command": ...}` for `Bash` and `apply_patch`), PostToolUse `tool_response` (a string for shell). Stop: `stop_hook_active`, `last_assistant_message`. Subagent events: `agent_id`, `agent_type`, SubagentStop `agent_transcript_path`. *verified by experiment*
- Ids: `session_id` equals the main thread id and the shell's `CODEX_SESSION_ID`/`CODEX_THREAD_ID`. A subagent's tool calls carry `agent_id` (its thread id, its shell's `CODEX_THREAD_ID`), `agent_type` and its own `turn_id`, with the parent `session_id`; main-thread tool events have no `agent_id` key. So a PostToolUse hook can tell a subagent's call from the parent's, which the docs leave open. Hook processes get no `CODEX_*` id variables; identity comes from stdin. *verified by experiment*
- No PostToolBatch equivalent. Two parallel shell calls gave Pre, Pre, Post, Post. The model's top-level tool is code-mode `exec`, whose JavaScript calls `tools.exec_command` and `tools.apply_patch`; hooks fire per nested call, never for `exec`. Spawning a subagent shows as `collaborationspawn_agent`. *verified by experiment*

### 3. Mid-turn injection

- PostToolUse `additionalContext` on three sequential `date` calls: the model quoted each nonce before its next call (`logs/q3-*`). The rollout stores it as a `developer` message just before the tool output item. *verified by experiment*
- Timing (`logs/q3b-timeline.txt`, `RUST_LOG=debug`): command printed its time, hook started 54 to 68 ms later, the bash hook took about 28 ms, and the model request carrying the context left 118 ms and 99 ms after the command output. *verified by experiment*
- SessionStart JSON `additionalContext`, SessionStart and UserPromptSubmit plain stdout all reached the model, under `exec` and app-server. *verified by experiment*
- Size: a 40,000-character SessionStart context (about 5,000 tokens) at the default limit was spilled to `$TMPDIR/hook_outputs/<session>/<uuid>.txt`; the model saw HEAD, TAIL and the path, not MID. With `additionalContextLimit: 0` it saw all three. *verified by experiment*; default threshold about 2,500 tokens *read in official docs*

### 4. Deny and block

- PreToolUse on `Edit|Write` returning `permissionDecision: "deny"`, and on `^Bash$` exiting 2 with stderr: `a.js` unchanged, `side-effect.txt` absent, no PostToolUse for either. The model quoted both reasons and finished in one turn. The tool result reads `Command blocked by PreToolUse hook: <reason>. Command: <patch>`. *verified by experiment (`logs/q4-*`)*
- Legacy `{"decision":"block","reason":...}` on `apply_patch`, once: the model re-issued the same patch unprompted and it applied. *verified by experiment (`logs/q4b-*`)*
- Edits: `apply_patch` (aliases `Edit`, `Write`; `tool_name` is always `apply_patch`). Shell, including shell writes, is `Bash` (unified `exec_command`); `write_stdin` runs no PreToolUse. Hosted tools fire nothing. *verified by experiment; read in official docs*

### 5. Stop

- `blockonce` Stop: the model answered again in the same turn (`turn_id` unchanged, one `turn.completed`); the second Stop had `stop_hook_active: true`; the reason entered as a user-role message `<hook_prompt hook_run_id="stop:...">...`. UserPromptSubmit did not fire for it. *verified by experiment (`logs/q5-*`)*
- Silent Stop (exit 0, no output) ended the turn with no extra request in every run. Stop output accepts only `continue`, `decision`, `reason`, `stopReason`, `systemMessage`, `suppressOutput`; there is no `additionalContext`, so news at Stop always costs a continuation. *verified by experiment; read in source code (`hooks/schema/generated/stop.command.output.schema.json`)*
- Stop fires under `exec` and app-server. At an interrupt (TUI Esc, app-server `turn/interrupt`) only Interrupt fires, never Stop. *verified by experiment*

### 6. Timeouts, failure modes, cost

- `timeout` in seconds, default 600; SessionEnd and Interrupt default 1, clamped to 1..3 (`hooks/src/engine/discovery.rs:742`). *read in source code*
- App-server run (`logs/q6b-*`): PreToolUse exit 1 reported `failed`, "hook exited with code 1", tool ran; PostToolUse sleeping with `timeout: 2` reported "hook timed out after 2s", `durationMs: 2004`, holding the tool result for 2 s; Stop printing `{not json` reported "hook returned invalid stop hook JSON output" and the turn ended. The model saw none of it. `exec --json` shows none of it either; app-server sends `hook/started` and `hook/completed`. *verified by experiment*
- A hook runs in its own session. On completion its children may keep running (`command_runner.rs:281`); on timeout or error its process group is killed (`:339`). A `cmd &` child of a timed-out hook died; a `setsid` child survived. *verified by experiment; read in source code*. Codex waits for the hook's stdout to close (`wait_with_output`), so a child that keeps it open holds the hook until its timeout. *inferred from source*
- Hooks run under `codex exec`, the TUI and `codex app-server` (Cezar spawns `codex app-server` and passes `sandbox` and dotted `config` on `thread/start`). *verified by experiment; read in cezarion dist `core/codex-app-server-runner.js:574`*
- Cost (`logs/q6c-*`, `q6d-*`): `true` hooks took 3 to 14 ms per event in `hook/completed`. Tool output to next request: median 46 ms without hooks, 59 ms with trivial Pre and PostToolUse. PreToolUse added nothing measurable over a ~100 ms dispatch. `node -e 0` as a hook took 155 to 200 ms, which is this host's Node start (140 to 200 ms bare), not Codex. *verified by experiment*

### 7. Sandbox

- On this host `workspace-write` and `read-only` run no command at all: bubblewrap cannot create its namespaces, and the landlock fallback panics. *verified by experiment*. Cezar selects `danger-full-access` on unmanaged installs, and `workspace-write` with network off when `CEZ_CODEX_NETWORK=0` (cezarion `core/codex-permissions.js:12`). *read in source code*
- Under `danger-full-access`, `bin/reach.mjs` as a SessionStart hook, as a PostToolUse hook and as the agent's shell command each read a row from `<repo>/.git/squeal/store.sqlite`, got answers from sockets under `$XDG_RUNTIME_DIR` and a `/tmp/<dir>` stand-in, and spawned a detached `sleep` that outlived `codex exec`. After the run the shell tool's same-group child was gone; the hooks' same-group children were alive. *verified by experiment (`logs/q7-*`)*
- Hook processes get no sandbox wrapper (`command_runner.rs` spawns directly). *read in source code*
- Sandboxed shell, from source only: `.git`, `.codex`, `.agents` stay read-only inside writable roots (`linux-sandbox/src/bwrap.rs:6`). With network off (the default for `workspace-write` and `read-only`), seccomp denies `connect`, `bind` and `sendto` for every socket family; it allows only creating AF_UNIX sockets (`linux-sandbox/src/landlock.rs:203-231`). Commands get `--unshare-pid` and `--die-with-parent`, so a detached child dies with the sandbox. *read in source code*. Inferred: `squeal status` from a sandboxed shell cannot reach the daemon socket, may fail to read a WAL store whose `-shm` it cannot write, and cannot start a daemon that lasts.

## Recommendation for Squeal

Build the Codex adapter on synchronous command hooks and mirror D9, with these differences:

1. **Push on PostToolUse, matcher `*`.** It is the only post-tool boundary (no batch event), it fires per nested call, and it reaches the model before its next step in about 100 ms. Several calls in one code-mode cell each fire it, so the delta must be idempotent per consumer: the second call of a batch normally says nothing.
2. **Consumers: `(session_id, agent_id ?? "main")` from stdin.** Subagent tool calls carry `agent_id`; hooks get no `CODEX_*` environment.
3. **Deny on `apply_patch`** (`matcher: "apply_patch"`) once per undelivered regression, as D9 does for Edit/Write. The model re-issues the edit unprompted. Shell writes (`Bash`) are not denied; the watcher stays the source of truth.
4. **Stop speaks only with news, via `decision: "block"`.** Silent Stop costs nothing. Skip speaking when `stop_hook_active` is true, to avoid loops. An interrupt runs Interrupt, not Stop, so the consumer stays in a turn; treat Interrupt as D9 treats a missing Stop.
5. **SessionStart** injects header plus primer, under 2,500 tokens. SessionStart runs at the first prompt in the TUI and again with `source: compact`. **SessionEnd** fires on `/exit`, `exec` end and app-server shutdown; it can unregister.
6. **Every hook `timeout: 2`, exit 0 silent on internal error.** A hang costs the full timeout per call, invisibly. Spawn the daemon with `setsid` (Node `detached: true`) and closed stdio, so a hook timeout cannot kill it.
7. **Install:** commit `.codex/hooks.json` in the repository. The user trusts the project and each hook once (`/hooks`), at the main checkout, and every Cezar worktree inherits it. Cezar, or any launcher Squeal controls, can skip all files: declare the hooks in `thread/start` `config` with matching `hooks.state` trust hashes. `squeal init` must say the trust step is manual; Codex skips untrusted hooks silently.
8. **Pull under a sandbox is not guaranteed.** Keep `squeal status` working from a store read without the socket, and say "no daemon reachable" honestly.

## Open questions

- Sandboxed behaviour is source-only: whether `squeal status` in a `workspace-write` shell can open the WAL store read-only, and whether `connect` to a socket fails as the seccomp source says. Needs a host where bubblewrap works.
- `async: true` hooks, `codex queue` and idle wake belong to topic `codex-sessions-and-wake`; not probed here.
- A long-running command that yields to `write_stdin` delivers its PostToolUse late (docs). Delivery timing for Squeal in that case was not measured.
- Whether plugin hook trust survives a plugin update: the key is path-independent, but the hash covers the command text. Not run.
- PermissionRequest never fired with `approval_policy = "never"`; not needed by D9.

## Sources

- Official docs: https://developers.openai.com/codex/hooks (fetched 2026-10-07 as `hooks.md`).
- Source: https://github.com/openai/codex tag `rust-v0.160.1` (`d27764b`): `codex-rs/hooks/src/engine/{discovery,command_runner}.rs`, `codex-rs/hooks/src/config_rules.rs`, `codex-rs/hooks/schema/generated/*.json`, `codex-rs/config/src/loader/mod.rs`, `codex-rs/config/src/hook_config.rs`, `codex-rs/app-server/src/{config_manager,effective_plugin_change}.rs`, `codex-rs/app-server-protocol/src/protocol/v2/plugin.rs`, `codex-rs/exec/src/lib.rs`, `codex-rs/linux-sandbox/src/{bwrap,landlock}.rs`.
- Cezarion dist: `/home/agent/.nvm/versions/node/v24.21.0/lib/node_modules/cezarion/node_modules/@wjarka/cezarion/dist/core/{codex-app-server-transport,codex-app-server-runner,codex-permissions}.js`.
- Prior findings: `../../001-core-loop/research/claude-code-integration.md` section 7, `../../001-core-loop/research/pull-advances-push.md` question 4.
- Probes and logs: `probes/codex-hooks/`.
