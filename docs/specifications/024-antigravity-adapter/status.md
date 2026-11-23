# 024 Antigravity adapter: status

Stage: shipped (2026-11-23; Wave 1 in 0.1.601, Wave 2 in 0.1.603, Wave 3 in 0.1.605, exact-main CI 45089580768 green, Wave 4 live proof in `lessons.md`)
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

- 2026-11-23, Wave 3 (`024-07`, `0.1.605`, review `reviews/0.1.605.md` PASS, exact-main CI `45089580768` green):
  - Real archived-plugin e2e caught a Linux process-ancestry bug: `plugins/antigravity/hooks/run` is a shebang script whose `/proc/<pid>/comm` is `"run"`, causing `findHarnessProcess` to stop at the short-lived wrapper under `--if-squeal` and `dropGoneHarnesses` to unregister consumers. Fixed by adding `"run"` to `SKIPPED` in `src/harness/shared/harness-process.ts`.
  - Calm-load bundled Node hook latency passed `< 80 ms` p95 across all 8 cases on boat.dev (60–79 ms at load 1.11).
- 2026-11-23, Wave 4 live proof and dogfooding (`024-08`, `lessons.md`, worker `fb7b5f9e`):
  - All 8 goals proven live on `antigravity` CLI `1.5.14` across 13 Gemini-only sessions (`-p`, 2-turn `stream-json`, interactive TUI, and `antigravity acp`), with zero blockers, 0 test-runner calls across 30 `run_command` invocations, installed fast path 3.7 ms p95, allowed `PreToolUse` 64.9 ms p95, and verified in-place `0.1.605 -> 0.1.606` update retention.
  - Closed the `stream-json` env note: hooks receive 3 variables (`ANTIGRAVITY_CONVERSATION_ID`, `PLUGIN_DATA`, `PLUGIN_ROOT`) in all modes (`-p`, `stream-json`, ACP, TUI); `run_command` shells receive 10 `ANTIGRAVITY_*` variables and no `PLUGIN_*` variables.
  - Non-blocking follow-ups proposed on the board: `024-09` (non-blocking wording/test polish from `lessons.md` and `reviews/0.1.605.md` S1) and `024-10` (verify Squawk non-default Antigravity account profile plugin loading under `antigravity acp`).

## Open questions

None blocking v1 (shipped). Deferred v1 non-goals stay in `spec.md` (App/IDE `PLUGIN_DATA` and UI rendering, active terminal sandbox, idle wake, Marketplace submission, macOS/Windows). Non-blocking follow-ups `024-09` and `024-10` are proposed on `docs/board.md`.
