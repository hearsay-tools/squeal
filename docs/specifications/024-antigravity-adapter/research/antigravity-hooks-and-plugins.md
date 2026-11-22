# Antigravity hooks, plugins and packaging

Research for spec `024-antigravity-adapter`. Examined on Linux against `antigravity` CLI `1.5.14` (2026-11-22) and official documentation fetched from `https://antigravity.google/docs/*.md` on 2026-11-22, plus the built-in customization reference bundled with Antigravity CLI `1.5.14`.

## Questions answered

| # | Question | Verdict | Tag |
| --- | --- | --- | --- |
| 1 | Which hook events inject context before the model's next step? | `SessionStart` and `PreInvocation` via `injectSteps` (`systemMessage`). `PostToolUse` returns `{}` and cannot inject context. | `verified by experiment` (`1.5.14`), `read in official docs` |
| 2 | Does `PreInvocation` fire mid-turn after tool calls, or once per user prompt? | Before every model call. `invocationNum` is `0` on each user prompt (resetting on `--conversation` resume and turn 2 of `stream-json`) and `1, 2, ...` after each tool batch. | `verified by experiment` (`1.5.14`) |
| 3 | Can `PreToolUse` deny an edit once and let the model retry in the same turn? | Yes, with `{"decision": "deny", "reason": "..."}`. Empty stdout allows; `{}` denies; a timeout kills the hook and blocks the tool call. | `verified by experiment` (`1.5.14`) |
| 4 | What tool names and argument keys arrive in `PreToolUse`? | CLI `1.5.14` sends `write_file`, `edit_file`, `read_file`, and `run_command` (`args.CommandLine`, no `Cwd`). Docs also list `write_to_file`, `replace_file_content`, `multi_replace_file_content`, `view_file`. | `verified by experiment` (`1.5.14`), `read in official docs` |
| 5 | How does `Stop` continue a turn, and how do multiple `Stop` hooks run? | `{"decision": "continue", "reason": "..."}` continues. Multiple `Stop` entries run sequentially and short-circuit on `"continue"`. `continuationActive` stayed `false` on the second `Stop`; `executionNum` incremented (`0 -> 1`) and reset to `0` on the next user turn. | `verified by experiment` (`1.5.14`) |
| 6 | How do subagents and session cleanup work without `Subagent*` or `SessionEnd` hooks? | `invoke_subagent` runs a full conversation with its own `conversationId` and all hook events, with no parent field. `findHarnessProcess` lands on the `antigravity` CLI PID (`node -> sh -> antigravity`), so `dropGoneHarnesses` cleans up on exit. | `verified by experiment` (`1.5.14`) |
| 7 | Does a detached daemon spawned from `SessionStart` outlive the hook and CLI? | Yes. A child spawned with `detached: true, stdio: "ignore"` and `unref()` stayed alive after both hook exit and `antigravity -p` exit. | `verified by experiment` (`1.5.14`) |
| 8 | What working directory and env vars do hooks and agent shells see? | Hook `process.cwd()` is `<plugin-root>`, not the workspace; workspace arrives in stdin `cwd` and `workspacePaths`. Both hooks and agent shells receive `ANTIGRAVITY_AGENT`, `ANTIGRAVITY_CONVERSATION_ID`, `ANTIGRAVITY_APP_DATA_DIR`, `ANTIGRAVITY_LS_ADDRESS`, `ANTIGRAVITY_AGENTAPI_EXE`. Hooks also get `PLUGIN_ROOT` (and `PLUGIN_DATA` for installed plugins). | `verified by experiment` (`1.5.14`), `read in official docs` |
| 9 | Can a POSIX `sh` fast path stay under 10 ms p95 when `cwd` is on stdin? | Yes. Pure-POSIX `sh` buffering stdin and extracting top-level `"cwd"` ran in 2.7 ms min / 3.6 ms p50 / 5.1 ms p95 (30 runs), vs 54.4 / 68.9 / 108.0 ms for bare Node. | `verified by experiment` (`1.5.14`) |
| 10 | How do `plugin validate`, `plugin install`, updates and `plugin uninstall` behave? | Native plugins need `plugin.json` and `hooks.json` at the plugin root. `plugin install <dir>` copies the tree (preserving subdirectories and `0755` modes) into `~/.gemini/config/plugins/<name>/` and replaces an existing install in place. `plugin uninstall` removes it and cleans `config.json` and `import_manifest.json`. | `verified by experiment` (`1.5.14`) |
| 11 | Does `plugin import claude` make Squeal's Claude Code plugin work? | No. `plugin validate` rejects it as a Claude Code layout, and the Claude Code hook scripts speak an incompatible protocol (`PostToolBatch`, `args` array, `CLAUDE_PLUGIN_ROOT`, `hookSpecificOutput`, `asyncRewake`, `decision: "block"`). | `verified by experiment` (`1.5.14`), `read in source code` |
| 12 | Is idle wake possible? | Not through hooks (synchronous only). `agentapi send-message` works in CLI and App sidecars, but posts a user-authority message. | `read in official docs`, `verified by experiment` (`1.5.14`, `get-conversation-metadata`) |

## Findings

### 1. Hook lifecycle and mid-turn delivery

A throwaway workspace plugin under `/tmp/<probe>/.agents/plugins/squeal-probe/` was exercised with `antigravity -p --model gemini-3.8-flash-low --dangerously-skip-permissions --output-format json` (`verified by experiment`, `1.5.14`).

Observed event sequence in one multi-tool turn (file create denied once, retry, parallel edit + shell, final reply, Stop continue once, second reply):

1. `SessionStart` (once on a new conversation; not fired on `--conversation <id>` resume or on turn 2 of `--input-format stream-json`).
2. `PreInvocation` (`invocationNum: 0`, `initialNumSteps: 1`).
3. `PreToolUse` (`write_file`) -> returned `{"decision": "deny", "reason": "..."}`. No `PostToolUse` fired for the denied call.
4. `PostInvocation` (`invocationNum: 0`).
5. `PreInvocation` (`invocationNum: 1`, `initialNumSteps: 4`) -> injected `{"injectSteps": [{"systemMessage": {"systemMessage": "..."}}]}`. The model read the injected marker before its next step and quoted it in its reply.
6. `PreToolUse` (`write_file`) -> `PostToolUse` (`write_file`) -> `PostInvocation` (`invocationNum: 1`).
7. `PreInvocation` (`invocationNum: 2`, `initialNumSteps: 7`).
8. Parallel tool calls in one batch: `PreToolUse` (`edit_file`) -> `PostToolUse` (`edit_file`) -> `PreToolUse` (`run_command`) -> `PostToolUse` (`run_command`) -> single `PostInvocation` (`invocationNum: 2`).
9. `PreInvocation` (`invocationNum: 3`, `initialNumSteps: 11`) -> `PostInvocation` (`invocationNum: 3`).
10. `Stop` handler 1 (`executionNum: 0`, `continuationActive: false`, `terminationReason: "NO_TOOL_CALL"`, `fullyIdle: true`) -> returned `{"decision": "continue", "reason": "..."}`. Handler 2 did not run.
11. `PreInvocation` (`invocationNum: 4`, `initialNumSteps: 13`) -> `PostInvocation` (`invocationNum: 4`).
12. `Stop` handler 1 (`executionNum: 1`, `continuationActive: false`, `terminationReason: "NO_TOOL_CALL"`, `fullyIdle: true`) -> returned `{}`.
13. `Stop` handler 2 started 98 ms after handler 1 exited (`executionNum: 1`) -> returned `{}`.

Every hook payload uses camelCase JSON (protojson) with keys serialized in alphabetical order: `artifactDirectoryPath`, `conversationId`, `cwd`, `hookEventName`, `lastUserInput`, `modelName`, `transcriptPath`, `workspacePaths` (`verified by experiment`, `1.5.14`).

### 2. `PreToolUse` fail-closed cases

Three `PreToolUse` failure and allow shapes were tested on `antigravity` `1.5.14` (`verified by experiment`):

- `{"decision": "allow"}` (exit 0): allows the tool call.
- Empty stdout `""` (exit 0): allows the tool call silently.
- Empty JSON object `{}` (exit 0): **denies** the tool call (`The command execution was denied by a pre-tool hook`).
- Hook timeout (`timeout: 1`, process sleeping 5 s): Antigravity kills the hook and **blocks** the tool call with an execution error (`Encountered error in tool execution: JSON hook "..." failed: command failed: signal: killed`), contradicting the general fail-open note in `docs/build-plugins.md`.

Implication: Squeal's `PreToolUse` hook must emit empty stdout (never `{}`) when allowing or failing internally, and must enforce an internal Node deadline below the `hooks.json` timeout so Antigravity does not kill it under load.

### 3. Tool names across surfaces

In `antigravity` CLI `1.5.14` (`verified by experiment`):

- File creation: `write_file` with `toolCall.args: { Content, Path }`.
- File editing: `edit_file` with `toolCall.args: { Path, Replacement, Target }`.
- File reading: `read_file`.
- Shell execution: `run_command` with `toolCall.args: { CommandLine, WaitMsBeforeAsync, toolSummary }` (no `Cwd` argument).

In `https://antigravity.google/docs/hooks.md` (`read in official docs`, 2026-11-22), Antigravity App and IDE also name `write_to_file`, `replace_file_content`, `multi_replace_file_content`, `view_file`, and `run_command` (with optional `Cwd`). Matching both sets covers CLI and any shared plugin install.

### 4. `Stop` loop guard, sequential execution and `fullyIdle`

- On the second `Stop` after a continuation in the same turn, `antigravity` `1.5.14` sent `executionNum: 1` and `continuationActive: false`, contradicting its own built-in `hooks.md` (`verified by experiment`). On a resumed turn (`--conversation`) and on turn 2 of `stream-json`, `executionNum` reset to `0` (`verified by experiment`). Using `continuationActive === true || (executionNum ?? 0) > 0` prevents loops.
- Multiple `Stop` entries run sequentially and short-circuit on `"continue"` (`verified by experiment`). Squeal's Claude Code and Codex `stop` + `stop-slow` entries assume parallel execution (`src/harness/shared/stop.ts`, `src/harness/shared/stop-slow.ts`; `read in source code`). Under sequential execution, `stop` runs before `stop-slow` starts and cannot wait for `stop-slow` to write `recordStopWait()`.
- When a parent conversation invokes a subagent and pauses while the subagent is still running, the parent's `Stop` receives `fullyIdle: false` (`verified by experiment`). Once the subagent finishes, `fullyIdle` becomes `true`.
- `terminationReason` values documented in built-in `hooks.md` (`read in official docs`): `NO_TOOL_CALL`, `MAX_INVOCATIONS`, `MAX_FORCED_INVOCATIONS`, `MAX_TOKEN_BUDGET_EXCEEDED`, `ERROR`, `USER_CANCELED`, `TERMINAL_STEP_TYPE`, `TERMINAL_CUSTOM_HOOK`, `INJECTED_RESPONSE`.

### 5. Subagents, process tree and daemon lifetime

- Invoking `invoke_subagent` (`TypeName: "research"`) launched a second conversation with its own `conversationId` that fired `SessionStart`, `PreInvocation`, `PreToolUse`, `PostToolUse`, and `Stop` with no parent-linking fields (`verified by experiment`, `1.5.14`).
- Hook parent process chain in CLI `1.5.14` was `node-MainThread -> sh -> antigravity` (`verified by experiment`). `src/harness/shared/harness-process.ts` skips `sh` and records the `antigravity` PID (`read in source code`).
- A detached Node process (`detached: true, stdio: "ignore", child.unref()`) spawned during `SessionStart` remained alive after the hook exited and after `antigravity -p` exited (`verified by experiment`, `1.5.14`).
- Antigravity App and IDE may run a shared Language Server process across conversations (`inferred`), which is outside CLI-only v1 scope.

### 6. Fast path benchmark

Plugin hooks execute with `process.cwd()` equal to `<plugin-root>`, not the user's project directory (`verified by experiment`, `1.5.14`; `read in official docs`). Because protojson emits `"cwd"` alphabetically before `"lastUserInput"`, a pure-POSIX `sh` script can buffer stdin, extract the first `"cwd":"..."` value with parameter expansion (no `sed` or `head` subprocess), test for `squeal.config.json` or `<git-common-dir>/squeal`, exit `0` silently if absent, and otherwise pipe stdin to `exec "$@"`.

30-run benchmark on this host against a non-Squeal git repository (payload containing a fake `"cwd"` inside `lastUserInput` to verify prefix matching):

- Pure-POSIX `sh` fast path: **2.7 ms min, 3.6 ms p50, 5.1 ms p95** (`verified by experiment`).
- `sh` + `sed` fast path: **5.3 ms min, 6.1 ms p50, 8.9 ms p95** (`verified by experiment`).
- Bare Node (`node --disable-warning=ExperimentalWarning -e ...`): **54.4 ms min, 68.9 ms p50, 108.0 ms p95** (`verified by experiment`).

When `"cwd"` contains a backslash escape (`\`) or is missing, the `sh` script falls through to Node so JSON unescaping stays exact.

### 7. Plugin packaging, install, update and `PLUGIN_DATA`

Tested offline in an isolated `HOME` with `antigravity` `1.5.14` (`verified by experiment`):

- `plugin validate --json` requires `plugin.json` (or `.antigravity-plugin/plugin.json`) and loads `hooks.json` directly at the plugin root (`read in official docs`, `verified by experiment`).
- `plugin install <local-dir>` copies the entire directory tree into `~/.gemini/config/plugins/<name>/`, preserving subdirectories (`dist/cli/`, `skills/squeal/references/`) and `0755` modes (`bin/squeal-launcher`, `hooks/run`), and writes `~/.gemini/config/import_manifest.json`.
- Re-running `plugin install <local-dir>` on a newer version replaces `~/.gemini/config/plugins/<name>/` in place and exits `0` (`(replaced existing installation)`).
- `plugin list --json` prints `name`, `enabled`, `version`, `source`, `path`, `skills`, and `hooks`.
- `plugin disable` / `enable` toggle `plugins.<name>.enabled` in `~/.gemini/config/config.json`.
- `plugin uninstall squeal` deletes `~/.gemini/config/plugins/squeal` and cleans `import_manifest.json` and `config.json`.
- Workspace plugins receive `PLUGIN_ROOT` and no `PLUGIN_DATA` (`verified by experiment`). Installed plugins receive both `PLUGIN_ROOT` and `PLUGIN_DATA` (`read in official docs`; live installed value to verify in wave 0). Because in-place replacement deletes old files in `~/.gemini/config/plugins/squeal/`, copying each version into `$PLUGIN_DATA/versions/<version>/` (as `src/harness/shared/version-copies.ts` already does for Codex) protects running daemons and open sessions across updates.

### 8. Terminal sandbox

On this host, `antigravity -p --sandbox` ran unsandboxed (`GIT=true`, `SOCKET_OK`; `verified by experiment`) because Linux unprivileged user namespaces are unavailable here (`read in official docs`, `docs/sandbox.md`: `--sandbox` has no effect when OS containment is unavailable). On hosts where Linux namespaces or macOS Seatbelt are active, `run_command` sees only mounted workspace folders, `/tmp`, and system paths (`read in official docs`), so pulls from linked worktrees or `$XDG_RUNTIME_DIR` sockets are unverified (`not determined, because` this host blocks unprivileged user namespaces). Deferred as a v1 non-goal per human decision (2026-11-22).

## Sources

- `antigravity` CLI `1.5.14` (live probes on Linux, 2026-11-22).
- Official Antigravity documentation (fetched 2026-11-22):
  - `https://antigravity.google/docs/hooks.md`
  - `https://antigravity.google/docs/plugins.md`
  - `https://antigravity.google/docs/build-plugins.md`
  - `https://antigravity.google/docs/customization-discovery.md`
  - `https://antigravity.google/docs/cli/headless.md`
  - `https://antigravity.google/docs/cli/reference.md`
  - `https://antigravity.google/docs/subagents.md`
  - `https://antigravity.google/docs/sidecars.md`
  - `https://antigravity.google/docs/sandbox.md`
  - `https://antigravity.google/docs/changelog.md`
- Built-in Antigravity CLI `1.5.14` customization docs: `~/.gemini/antigravity-cli/builtin/skills/agy-customizations/docs/{hooks,plugins,json_configs,rules}.md`.
- Squeal source code: `src/harness/shared/`, `src/harness/codex/`, `src/harness/pi/`, `src/core/slow/stop-wait.ts`, `src/core/ps/discover.ts`, `src/cli/{init,update,status-command,main}.ts`, `install.sh`, `plugins/claude-code/bin/squeal-launcher`.
