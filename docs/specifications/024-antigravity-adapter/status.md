# 024 Antigravity adapter: status

Stage: Wave 1 running (2026-11-22; Wave 0 checks complete)
Started: 2026-11-22

## Decisions so far

- 2026-11-22, research (`research/antigravity-hooks-and-plugins.md`, `antigravity` CLI `1.5.14`, Linux):
  - `PostToolUse` cannot inject context; `PreInvocation` fires before every model call (`invocationNum: 0` at each user prompt, `> 0` after each tool batch) and injects `systemMessage` into the same turn.
  - `PreToolUse` fails closed on `{}` and on hook timeout, and fails open on empty stdout `""` (exit 0). CLI uses `write_file`/`edit_file`/`run_command`; docs also name `write_to_file`/`replace_file_content`/`multi_replace_file_content`.
  - Multiple `Stop` hooks run sequentially and short-circuit on `"continue"`. `continuationActive` stayed `false` after a continuation while `executionNum` incremented (`0 -> 1`) and reset to `0` on the next user turn.
  - Subagents (`invoke_subagent`) run as independent conversations with their own `conversationId` and all hook events. `findHarnessProcess` lands on the `antigravity` CLI process (`node -> sh -> antigravity`), and detached daemons survive CLI exit.
  - Hook `process.cwd()` is `<plugin-root>`, not the workspace; a pure-POSIX `sh` fast path extracting `"cwd"` from stdin runs in 3.6 ms p50 / 5.1 ms p95 on non-Squeal repos (vs 68.9 ms p50 / 108.0 ms p95 for bare Node).
  - `plugin install <local-dir>` copies the tree into `~/.gemini/config/plugins/squeal/` (preserving subdirectories and `0755` modes) and replaces prior installs in place.
- 2026-11-22, the human on the scope card:
  - Target surfaces for v1: **CLI on Linux only** (defers Antigravity App, IDE, and IDE extension shared-process liveness and UI rendering checks).
  - Install and update model: **`agy plugin install` + `$PLUGIN_DATA` copies** (lets Antigravity own `~/.gemini/config/plugins/`; retains versioned runtime copies in `$PLUGIN_DATA` for running daemons).
  - Active terminal sandbox: **Defer as v1 non-goal** (matches Codex spec 002).
  - Next step: run remaining local probes and draft spec `024-antigravity-adapter`.
- 2026-11-22, the human on approval:
  - Open question 1 (`fullyIdle: false` on `Stop`): **Stay silent** (skip both news continuations and slow holds while `fullyIdle === false`; news arrives at `PreInvocation` once the background task wakes the agent, and slow holds run at `fullyIdle: true`). Folded into D3 and Open questions.
  - Spec `024-antigravity-adapter` **approved** (docs landed on `main`; no implementation waves dispatched yet).

- 2026-11-22, Wave 0 checks (`research/wave-0-checks.md`, row `024-01`, researcher `cb7911ff`):
  - **OQ2 resolved**: detect `SQUEAL_ANTIGRAVITY_BIN`, then `agy`, then `antigravity`, requiring bare semver `--version` and `help plugin` listing `uninstall` and `validate` (rejects IDE launcher). Check `~/.gemini/config/plugins/squeal/plugin.json` for presence (`plugin uninstall` exits 0 when missing).
  - **OQ3 resolved**: installed `PLUGIN_ROOT` is `~/.gemini/config/plugins/squeal` and `PLUGIN_DATA` is `~/.gemini/antigravity-cli/plugin_data/squeal` (created before first hook; persists across reinstall and uninstall, so `install.sh --uninstall` removes it when unused). Disabled state is `plugins.squeal.enabled === false` in `~/.gemini/config/config.json`. D6 keys on `ANTIGRAVITY_CONVERSATION_ID` (`ANTIGRAVITY_AGENT` was absent in `-p` hook env).
  - **OQ4 resolved**: `hooks/run --if-squeal` uses sentinel buffering (`payload=$(cat; printf x); payload=${payload%x}`), 4 KB-bounded `%%` head search, and `LC_ALL=C` during parsing (restoring caller's `LC_ALL`). 32/32 cases passed byte-exact; `dash` p95 3.3 ms (0.4 KB) and 6.7 ms (100 KB).

## Open questions

None blocking Wave 1. Remaining non-blocking notes (`research/wave-0-checks.md` "Open questions"): hook env under `stream-json` runner (verified in Wave 4 live proof), App/IDE `PLUGIN_DATA` path (out of v1 scope), and whether interactive TUI sends `continuationActive: true` or non-`NO_TOOL_CALL` `terminationReason`.
