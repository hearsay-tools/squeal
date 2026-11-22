# 024 Antigravity adapter

Stage: approved (the human, 2026-11-22). Amendments: `status.md`. Research: `research/antigravity-hooks-and-plugins.md` (`antigravity` CLI `1.5.14`, Linux, official docs fetched 2026-11-22). Spec 011 (core: C5, C8, C9, C10), spec 005 (D3, D4, D6, D8) and spec 019 (D4) hold, and specs 002 (Codex), 008 (OpenCode) and 009 (Pi) are the precedents, unless a section here says otherwise.

## Problem

Squeal delivers to Claude Code, Codex, Pi and OpenCode. An Antigravity CLI session (interactive TUI, `agy -p`, or Squawk's `--input-format stream-json` runner) editing a project under validation hears about no `PASS -> FAIL`, is not stopped before editing over an undelivered regression, and is not told to leave the tests to Squeal. Antigravity ships a native plugin and synchronous hook system, and `src/harness/shared/` already holds the harness-neutral delivery logic. What is missing is the Antigravity adapter, its native plugin, and install, update and status wiring.

## Goals

Each goal is testable, and each holds under `agy -p`, under `--input-format stream-json --output-format stream-json`, and in the interactive TUI on Linux.

1. An agent editing a project under validation learns about a `PASS -> FAIL` before its next model call after the tool batch in which the result became known, in the same turn, through `PreInvocation`, without running tests itself.
2. The matching `FAIL -> PASS` arrives the same way. Nothing arrives for `PASS -> PASS` or an unchanged failure. Parallel tool calls in one batch trigger one `PreInvocation` and deliver at most once.
3. With `interrupt.onRegression` on, the next file-editing tool call (`write_file`, `edit_file`, `write_to_file`, `replace_file_content`, `multi_replace_file_content`) after an undelivered regression is denied once with the regression entries as the reason; the model reads the reason and re-issues the edit in the same turn. `run_command` is never denied by default; the one shell call ever denied is a test command Squeal has already answered, once per consumer, with spec 005 D8's opt-in `testCommand.denyWhenCurrent` (default off).
4. `Stop` speaks only with news or a policy block, as `{"decision": "continue", "reason": <report>}`; a silent `Stop` costs no model call; a `Stop` after a continuation (`executionNum > 0 || continuationActive === true`) never blocks again for news or non-required policies. Slow and `stop`-required check groups wait and hold through the sequential waiting `Stop` entry (`stop-slow`), up to `stop.maxHolds`.
5. A subagent (`invoke_subagent`) is its own consumer `(conversationId, "main")`, receives the primer and registration header at its own `SessionStart`, and its tool calls deliver and deny for it without affecting the parent's view.
6. When the Antigravity CLI process exits or is killed, its recorded `HarnessProcess` dies and `dropGoneHarnesses` unregisters its main and subagent consumers without needing a `SessionEnd` hook. Detached daemons spawned by hooks outlive both hook exit and CLI exit.
7. No hook ever causes Antigravity to block a tool call due to a Squeal error or timeout: `PreToolUse` enforces an internal deadline below its `hooks.json` timeout and emits empty stdout on allow or error (never `{}`). Per-invocation and per-tool hooks stay within 80 ms p95 for the Node path at calm load, and within 10 ms p95 for the POSIX `sh` fast path outside Squeal repositories.
8. `install.sh` installs and updates Squeal through Antigravity's own `plugin install` command at user scope, preserves running daemons across in-place updates through `$PLUGIN_DATA` version copies, and writes no file under `~/.gemini/config/` itself. `squeal status` run in an Antigravity shell where hooks never ran says so.

## Non-goals

- **Antigravity App, Antigravity IDE and IDE extensions** in v1 (the human, 2026-11-22). The plugin uses Antigravity's cross-surface native format (`~/.gemini/config/plugins/squeal/`), so it loads there too, but shared Language Server process liveness and App/IDE UI rendering (`metadata.user_markdown`) are deferred until verified on an App/IDE host.
- **Active terminal sandbox** (`--sandbox`, Linux user namespaces, macOS Seatbelt) in v1 (the human, 2026-11-22). Pull from a sandboxed `run_command` is best-effort and honest, matching Codex spec 002.
- **Idle wake** in v1. Antigravity hooks are synchronous only (no `asyncRewake`). `agentapi send-message` posts a user-authority prompt and is left for a later, policy-gated row at most.
- **Antigravity Marketplace submission** (`antigravity-plugins-official`) in v1. The plugin manifest stays Marketplace-ready (`plugin.json`, `README.md`), while distribution runs through `install.sh` and `squeal update`.
- **Importing the Claude Code plugin** (`agy plugin import claude`): incompatible hook events, I/O shapes and fast path (`research/antigravity-hooks-and-plugins.md` finding 11).
- **Writing `AGENTS.md` or `GEMINI.md` automatically** outside `squeal setup`, and **Windows or macOS** in v1.

## Design

### D1. Plugin, install and updates

The adapter ships as a native Antigravity plugin in this repository at `plugins/antigravity/`:

- `plugin.json` at the plugin root (`$schema: "https://antigravity.google/schemas/v1/plugin.json"`, `name: "squeal"`, `displayName: "Squeal"`, `version` synced from root `package.json`, `description`, `author`, `repository`, `license`, `keywords`).
- `hooks.json` directly at the plugin root (Antigravity's native plugin loader reads `<plugin-root>/hooks.json`, never `hooks/hooks.json`; `research/antigravity-hooks-and-plugins.md` finding 7).
- `hooks/run` (`0755`): the POSIX `sh` fast-path wrapper (D4).
- `skills/squeal/`: copied from `plugins/claude-code/skills/squeal/` by `pnpm run build:plugin`, with a note after the `# Squeal` heading naming the CLI command (as `src/harness/pi/build.ts` adds `PI_SKILL_NOTE`).
- `bin/squeal-launcher`: copied from `plugins/claude-code/bin/squeal-launcher` (`LAUNCHER_COPY`).
- `dist/`: committed bundles for the hook entries, `dist/cli/squeal.mjs`, `dist/cli/ps.mjs`, daemon workers, and runner/coverage/CI runtimes built by `src/harness/build.ts`.
- `README.md`.

`antigravity plugin validate --json plugins/antigravity` must pass with 0 errors and 0 warnings (notes such as missing logo are allowed until a logo asset is added).

**Install and update (`install.sh` and `squeal update`).** Because `agy plugin install <local-dir>` copies the directory into `~/.gemini/config/plugins/squeal/` and replaces any prior copy in place (`research/antigravity-hooks-and-plugins.md` finding 7):

- `install.sh` detects the Antigravity CLI in order `SQUEAL_ANTIGRAVITY_BIN`, `agy`, `antigravity`, accepting a candidate only when `<cli> --version` prints a bare semver and `<cli> help plugin` lists `uninstall` and `validate` (rejecting an `antigravity` IDE launcher on `PATH`, `research/wave-0-checks.md` 1). It unpacks `plugins/antigravity/` from the release tag's source archive into a temporary directory, checks `plugin.json`'s `version`, and runs `<cli> plugin install <tmp-dir>`. It records `antigravity` in `${XDG_STATE_HOME:-~/.local/state}/squeal/installed` and removes the plugin via `<cli> plugin uninstall squeal` on `--uninstall` only when it recorded ownership (checking `~/.gemini/config/plugins/squeal/plugin.json` for presence, since `plugin uninstall` exits 0 when missing). Because `plugin uninstall` keeps `~/.gemini/antigravity-cli/plugin_data/squeal/`, `--uninstall` deletes that data directory when no Antigravity plugin remains and no running process uses it (printing the `rm -rf` command when a daemon still uses it). It never edits `~/.gemini/config/config.json` or `import_manifest.json` directly.
- `install.sh --antigravity` installs or updates Antigravity only, as `--pi` and `--opencode` do; `squeal update` invokes it when the Antigravity CLI passes detection and `~/.gemini/config/plugins/squeal/plugin.json` is installed (and reports disabled when `plugins.squeal.enabled === false` in `~/.gemini/config/config.json`, or reports missing CLI with `SQUEAL_ANTIGRAVITY_BIN` when the plugin directory exists without a CLI on `PATH`).
- **Protecting running daemons across in-place updates.** Replacing `~/.gemini/config/plugins/squeal/` in place deletes old `dist/` files while earlier sessions' daemons may still run. Antigravity passes `PLUGIN_ROOT=~/.gemini/config/plugins/squeal` and `PLUGIN_DATA=~/.gemini/antigravity-cli/plugin_data/squeal` to every installed plugin hook (`research/wave-0-checks.md` 2). On `SessionStart` (and on daemon spawn or first registration in any other hook, matching `src/harness/codex/kept.ts`, plus `keptCacheCli` when invoked directly from `~/.gemini/config/plugins/squeal/dist/cli/squeal.mjs`), when `PLUGIN_ROOT` and `PLUGIN_DATA` are set and `PLUGIN_ROOT/plugin.json` matches the running `squealVersion()`, Squeal copies `dist/`, `skills/`, and `plugin.json` atomically into `$PLUGIN_DATA/versions/<version>/`, writes `$PLUGIN_DATA/bin/squeal` from `bin/squeal-launcher`, and prunes old copies using `src/harness/shared/version-copies.ts` (keeping the newest prior version, any version named by a running process, and copies newer than 24 h). Daemons spawn from the retained copy's CLI, and the primer and FAIL `squeal why` lines name `$PLUGIN_DATA/bin/squeal` (falling back to `node --disable-warning=ExperimentalWarning "<PLUGIN_ROOT>/dist/cli/squeal.mjs"` when `PLUGIN_DATA` is absent, such as workspace plugins).
- `plugins/claude-code/bin/squeal-launcher` (format 9) discovers `~/.gemini/config/plugins/squeal` (reading `plugin.json`'s `version` and checking `dist/cli/squeal.mjs`), and when run as `<PLUGIN_DATA>/bin/squeal` (outside Codex's data dir) runs the newest copy under `<PLUGIN_DATA>/versions/`, even when Codex's fixed plugin is also installed.

### D2. Consumers and identity

A consumer is `(conversationId, "main")`, read from stdin `conversationId` (a UUID).

- Main sessions and subagents (`invoke_subagent`, `/swarm` workers, `/run-workflow` agents) each have their own `conversationId` and run all hook events independently (`research/antigravity-hooks-and-plugins.md` finding 5). Each gets its own consumer, delivery view, primer, and turn state.
- Antigravity sets `ANTIGRAVITY_CONVERSATION_ID` to `conversationId` and `ANTIGRAVITY_AGENT` in every `run_command` shell (`research/antigravity-hooks-and-plugins.md` Q8), enabling pull attribution and `squeal status` diagnostics without adding a `consumers` column.
- `HarnessProcess`: `findHarnessProcess()` walks from the hook process past `sh` (at most 2 `sh` hops under `hooks/run`, within `MAX_HOPS = 4`) to the `antigravity` CLI process (`research/antigravity-hooks-and-plugins.md` finding 5). When the CLI exits or is killed, `dropGoneHarnesses()` unregisters all consumers of that process (main and subagents).
- Worktree location: resolved from stdin `cwd` (falling back to `workspacePaths[0]` when `cwd` is empty) via `sessionLocation` (`src/harness/shared/session-root.ts`), keyed by `conversationId`.

### D3. Hooks

Four event types are registered in `plugins/antigravity/hooks.json` under top-level hook group `"squeal"`:

- **`SessionStart`** (flat array, `timeout: 2`):
  - Keeps this version's copy in `$PLUGIN_DATA` when available (D1).
  - Calls `startSession({ session_id: conversationId, source: "startup" }, location, deps)`.
  - If text is returned, outputs `{"injectSteps": [{"systemMessage": {"systemMessage": <capped text>}}]}` (capped at `MESSAGE_CAP_CHARS`, 10,000 chars, keeping the trailing primer and kept-skill line whole). Otherwise emits empty stdout.
  - Because Antigravity fires `SessionStart` only on new conversations (not on `--conversation` resume or compaction), a resumed conversation re-registers through `PreInvocation` if its consumer expired.

- **`PreInvocation`** (flat array, `timeout: 2`, through `hooks/run --if-squeal`):
  - **When `invocationNum === 0`** (start of every user turn, including `--conversation` resume and subsequent turns in `stream-json`): calls `submitPrompt(input, location, deps, { register: true })`. This puts the consumer in a turn, delivers any undelivered delta accumulated while idle, or registers it (with header and primer, and keeps `$PLUGIN_DATA` copy) if the store appeared after `SessionStart` or the consumer expired.
  - **When `invocationNum > 0`** (after a tool batch completes, before the model's next call): calls `deliver(context, deps, true)` (primary push channel, equivalent to Claude Code's `PostToolBatch` and Codex's `PostToolUse`). Parallel tool calls in one batch trigger one `PreInvocation`.
  - If text is returned, outputs `{"injectSteps": [{"systemMessage": {"systemMessage": <capped text>}}]}`. Otherwise emits empty stdout.
  - Neither `PostToolUse` nor `PostInvocation` is registered, avoiding per-tool hook overhead on tools that cannot inject context.

- **`PreToolUse`** (grouped with matcher `write_file|edit_file|write_to_file|replace_file_content|multi_replace_file_content|run_command`, `timeout: 5`, through `hooks/run --if-squeal`):
  - Enforces an internal 1,500 ms deadline inside Node (D4) so Antigravity never kills the hook at timeout (which fails closed; `research/antigravity-hooks-and-plugins.md` finding 2).
  - On any tool in `EDIT_TOOLS` (`write_file`, `edit_file`, `write_to_file`, `replace_file_content`, `multi_replace_file_content`), with `interrupt.onRegression` on: runs `denyOnRegression`.
  - On `run_command`, with `testCommand.denyWhenCurrent` on: extracts `command = toolCall.args.CommandLine` and `cwd = toolCall.args.Cwd ?? input.cwd`, and passes `toolName: "Bash"` to `testCommandOf` and `denyCurrentTestCommand` (same normalization as `src/harness/pi/run.ts`).
  - If denied, outputs `{"decision": "deny", "reason": <reason>}`.
  - If allowed or on any error/timeout, emits **empty stdout** and exits `0` (never `{}`; `research/antigravity-hooks-and-plugins.md` finding 2).

- **`Stop`** (flat array, two sequential entries: `stop` with `timeout: 2`, then `stop-slow` with `timeout: 3600`):
  - **Abort/error guard**: if `terminationReason` is neither `""` nor `"NO_TOOL_CALL"` (for example `USER_CANCELED`, `ERROR`, `MAX_INVOCATIONS`, `MAX_FORCED_INVOCATIONS`, `MAX_TOKEN_BUDGET_EXCEEDED`, `TERMINAL_CUSTOM_HOOK`), `stop` calls `endTurn` and returns empty stdout (no continuation, no slow wait).
  - **`fullyIdle: false` guard**: if `fullyIdle === false` (the agent paused to wait on a running background subagent, command or timer), `stop` calls `endTurn` without handoff and returns empty stdout, and `stop-slow` stays silent without holding. Fast test news arrives at `PreInvocation` when the background task wakes the agent, and slow holds run at `fullyIdle: true` (the human, 2026-11-22).
  - **Loop guard**: `stopHookActive = input.continuationActive === true || (input.executionNum ?? 0) > 0` (`research/antigravity-hooks-and-plugins.md` finding 4).
  - **Entry 1 (`stop`, `timeout: 2`)**: calls `stopTurn({ ...input, stopHookActive, harness: "antigravity", ...(stopHookActive ? { quiet: true } : {}) }, location, deps)`. Because Antigravity runs `Stop` entries sequentially and ships both together with no per-hook trust split, `stopRules` treats `"antigravity"` as always handing open required checks to `stop-slow` without waiting `STOP_RECORD_WAIT_MS` for `recordStopWait()`. If `stopTurn` returns news or a block, `stop` outputs `{"decision": "continue", "reason": <report>}` (Antigravity then short-circuits `stop-slow`). Otherwise `stop` ends the turn with `handoff: true` and exits silently.
  - **Entry 2 (`stop-slow`, `timeout: 3600`, runs only when entry 1 exited silently)**: calls `stopSlow({ ...input, harness: "antigravity" }, location, deps)` (skipping when `terminationReason !== "NO_TOOL_CALL"` or `fullyIdle === false`). Since entry 1 already wrote the handoff before exiting, `handedOver()` succeeds immediately on its first read. If `stopSlow` returns a block reason, outputs `{"decision": "continue", "reason": <reason>}`; otherwise empty stdout.

Every output commits prepared delivery reports only after stdout write succeeds (`writeThenCommit` in `src/harness/shared/hand-off.ts`, row 011-288).

### D4. Hook processes, budgets and the fast path

Antigravity runs plugin hook commands with `process.cwd()` set to `<plugin-root>`, not the workspace directory (`research/antigravity-hooks-and-plugins.md` finding 6).

`plugins/antigravity/hooks/run` (`0755`, POSIX `sh`) implements the fast path for `PreInvocation` and `PreToolUse`:

1. Without arguments, exits `0` silently.
2. With `--if-squeal`: parses under `LC_ALL=C` (restoring the caller's `LC_ALL` before running the command so `bash` avoids UTF-8 wide-char overhead), buffers stdin byte-exact with a sentinel (`payload=$(cat; printf x); payload=${payload%x}`), takes `head=${payload%%\"cwd\":\"*}`, and only when `${#head} < 4096` (guarding against quadratic `${payload#*...}` cost if `cwd` ever follows a large prompt) extracts the first `"cwd":"..."` value and tests for `squeal.config.json` or `<git-common-dir>/squeal` up to the nearest `.git` entry (handling linked worktrees via `gitdir:` and `commondir`).
3. If `cwd` was parsed cleanly (non-empty, no backslash escapes) and has no Squeal config or store, exits `0` with empty stdout (measured 2.7 ms p50 / 3.3 ms p95 at 0.4 KB and 5.2 / 6.7 ms at 100 KB on `dash`; `research/wave-0-checks.md` 3).
4. Otherwise pipes `payload` byte-exact (`printf '%s' "$payload" | "$@"`) to `node --disable-warning=ExperimentalWarning ./dist/<event>.mjs`.

**Fail-open deadline on `PreToolUse`.** Because an Antigravity `PreToolUse` hook killed at its timeout blocks the tool call (`research/antigravity-hooks-and-plugins.md` finding 2), `hooks.json` sets `PreToolUse` `timeout: 5` while the `pre-tool-use` entry arms an unref'd `setTimeout(1500)` that abandons any prepared hand-off and calls `process.exit(0)` with empty stdout. Under normal operation the entry finishes under 80 ms p95; under severe host load it degrades to silence at 1.5 s instead of blocking the tool at 5 s.

### D5. Shared code and bundles

- `src/harness/antigravity/` holds:
  - `input.ts`: camelCase stdin parser (`conversationId`, `cwd`, `workspacePaths`, `hookEventName`, `invocationNum`, `initialNumSteps`, `toolCall`, `executionNum`, `terminationReason`, `fullyIdle`, `continuationActive`).
  - `output.ts`: `injectSystemMessage`, `deny`, `continueTurn`, `capContext`.
  - `command.ts` and `kept.ts`: CLI command resolution and `$PLUGIN_DATA` version-copy helpers.
  - `handlers.ts`, `hooks.ts`, `run.ts`, `entries/*.ts`, `build.ts`.
- Minimal shared/core changes:
  - `src/harness/shared/version-copies.ts`: parameterize the manifest path (`manifest` option defaulting to `.codex-plugin/plugin.json`, passing `plugin.json` for Antigravity) and copied entries (`COPIED`) so Antigravity reuses the exact atomic copy and pruning logic without duplicating it.
  - `src/core/slow/stop-wait.ts`: add `"antigravity"` to `StopWaitHarness`.
  - `src/harness/shared/stop-decide.ts`: for `harness === "antigravity"`, `stopRules` treats the sequential waiting entry as always present for `main` (so `stop` hands open required checks directly to `stop-slow` without waiting `STOP_RECORD_WAIT_MS` for `recordStopWait`).
  - `src/core/ps/discover.ts` and `src/core/ps/flags.ts`: recognize daemons running from `~/.gemini/config/plugins/squeal/dist/cli/squeal.mjs` and `$PLUGIN_DATA/versions/<version>/dist/cli/squeal.mjs`.
  - `package.json` (`build:plugin`), `scripts/check-version-bump.ts` (`plugins/antigravity/dist`), and `.github/workflows/ci.yml` (bundle drift check).

Claude Code, Codex, Pi, and OpenCode bundles and recorded-JSON test suites stay unchanged and green.

### D6. Status, setup and CLI naming under Antigravity

- `src/cli/antigravity/status.ts`: when `ANTIGRAVITY_CONVERSATION_ID` is set and no consumer of that `conversationId` is registered in this worktree (or no store exists), `squeal status` appends one `Antigravity:` diagnostic line stating that no Squeal consumer is registered for this conversation yet and naming the install command (`install.sh` / `agy plugin install`), matching `src/cli/codex/status.ts` and `src/cli/pi/status.ts`. Wired into `src/cli/main.ts` (`ANTIGRAVITY_AGENT` was not observed in `-p` hook env, so D6 keys on `ANTIGRAVITY_CONVERSATION_ID`; `research/wave-0-checks.md` 2).
- `src/cli/status-command.ts`: when `ANTIGRAVITY_CONVERSATION_ID` is set, names the Antigravity CLI command (`$PLUGIN_DATA/bin/squeal` when running from a retained copy, else `node --disable-warning=ExperimentalWarning "<cli>"`).
- `src/cli/setup/harnesses.ts` and `src/cli/init.ts`: detect Antigravity on `PATH` and `~/.gemini/config/plugins/squeal/plugin.json` (plus `config.json` disabled state); `squeal init --harness antigravity` writes `squeal.config.json` if absent and prints the install command without editing `~/.gemini/config/`.
- `src/cli/setup/block.ts`: Antigravity reads `AGENTS.md` and `GEMINI.md` (`read in official docs`). `AGENTS.md` is already supported by `block.ts`; no new default file is needed when `AGENTS.md` is used.

### D7. Daemon and worktrees

Spec 011 C9 holds. Detached daemons spawned by hooks outlive the hook and CLI (`research/antigravity-hooks-and-plugins.md` finding 5). Antigravity subagents using `workspace: "branch"` or `"share"` create git worktrees whose `.git` file points back to the repository's common dir, so they share the store by spec 011 C1 and `hooks/run`'s `gitdir:`/`commondir` check resolves them.

### D8. Policy

No new policy keys. `interrupt.onRegression` governs edit-tool denies, `testCommand.denyWhenCurrent` governs `run_command` test-command denies, and `stop.*` governs `Stop` and `stop-slow`.

## Testing

- **Fixtures**: recorded `antigravity` `1.5.14` hook JSON payloads under `test/fixtures/antigravity-hooks/` (all four events, `invocationNum` 0 vs >0, CLI and App/IDE edit tool names, `run_command`, `Stop` with `executionNum` 0 vs 1, `continuationActive: false`, `fullyIdle: false`, `terminationReason: "USER_CANCELED"`, subagent conversation).
- **Unit tests** (`test/harness/antigravity/`): input parsing; `SessionStart` injection; `PreInvocation` `invocationNum === 0` (`submitPrompt`) vs `invocationNum > 0` (`deliver`); `PreToolUse` regression deny once on all 5 edit tool names, `run_command` test-command deny, empty stdout (never `{}`) on allow and error, internal 1,500 ms fail-open deadline; `Stop` `executionNum > 0` loop guard, `terminationReason` abort guard, `fullyIdle: false` guard, sequential `stop` -> `stop-slow` handoff; `$PLUGIN_DATA` version copies and pruning.
- **Fast path and latency tests**: `hooks/run --if-squeal` under 10 ms p95 on non-Squeal repos (including a prompt containing `"cwd"`), exact stdin passthrough on Squeal repos and linked worktrees, and bundled Node hooks under 80 ms p95 at calm load (skipped above load threshold, matching `002`).
- **Packaging and install tests**: `plugins/antigravity/plugin.json` and `hooks.json` schema checks; `install.sh --antigravity` and `--uninstall` in an isolated `HOME` with a fake `agy` CLI (and with real `antigravity plugin validate --strict` when available); `squeal-launcher` and `squeal update` Antigravity discovery.
- **End-to-end tests** (`test/e2e/`): `plugins/antigravity` archived from `HEAD`, driven by recorded hook JSON against a real Squeal daemon, parametrized beside Claude Code and Codex.
- **Proof and dogfooding**: in a scratch repository with `plugins/antigravity` installed in an isolated `HOME` (or workspace plugin), one live `antigravity -p` run and one `--input-format stream-json` multi-turn run proving `SessionStart` primer delivery, mid-turn `PreInvocation` `PASS -> FAIL` and `FAIL -> PASS` delivery, `PreToolUse` edit deny and retry, sequential `Stop` + `stop-slow`, and subagent consumer isolation; followed by a dogfooding session on this repository recorded in `lessons.md`.

## Open questions

1. Decided 2026-11-22 by the human: stay silent on `fullyIdle: false` (D3). `stop` ends the turn without handoff and `stop-slow` does not hold; fast news arrives at `PreInvocation` when the background task wakes the agent, and slow holds run at `fullyIdle: true`.
2. Resolved 2026-11-22 in Wave 0 (`research/wave-0-checks.md` 1): detect `SQUEAL_ANTIGRAVITY_BIN`, then `agy`, then `antigravity`, accepting only a binary whose `--version` prints a bare semver and whose `help plugin` lists `uninstall` and `validate` (D1).
3. Resolved 2026-11-22 in Wave 0 (`research/wave-0-checks.md` 2): installed `PLUGIN_DATA` is `~/.gemini/antigravity-cli/plugin_data/squeal`, created before the first hook and kept across reinstall and uninstall; disabled state is `plugins.squeal.enabled === false` in `~/.gemini/config/config.json` (D1, D6).
4. Resolved 2026-11-22 in Wave 0 (`research/wave-0-checks.md` 3): POSIX `sh` handles 100 KB UTF-8 payloads byte-exact with sentinel buffering, a 4 KB `%%` head bound, and `LC_ALL=C` during parsing; no size-based Node fallback needed (D4).

## References

- Research: `research/antigravity-hooks-and-plugins.md`.
- Core and harness precedents: `../011-core/spec.md` (C5, C8, C9, C10), `../002-codex-adapter/spec.md`, `../005-agent-adoption/spec.md` (D3, D4, D6, D8), `../008-opencode-adapter/spec.md`, `../009-pi-adapter/spec.md`, `../019-run-triggers/spec.md` (D4).
- Official Antigravity docs: `https://antigravity.google/docs/{hooks,plugins,build-plugins,customization-discovery,subagents,sandbox}.md` and `https://antigravity.google/docs/cli/{headless,reference}.md`.
