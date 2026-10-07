# Probes: wave-0-checks (throwaway)

Throwaway probes for `../../wave-0-checks.md` (board row 002-11). Not product code. Nothing here is built, tested or shipped; delete freely.

Run on 2026-10-07 with Codex CLI 0.160.1 (`codex-cli 0.160.1`, source tag `rust-v0.160.1` = `d27764b`), Claude Code 2.1.293 (for one read-only `claude plugin validate`), Node 24.21.0, Linux. Model `gpt-6.1-sol` through the host's configured provider.

## Rules followed

- Every scratch repository is under `/tmp/w0c/r-<name>`, made by `bin/mkrepo.sh`. None touched this repository or its Squeal store. `/tmp/w0c` (scratch homes, repositories, the `openai/codex` clone) was deleted after the run.
- Every `codex` run used a scratch `CODEX_HOME=/tmp/w0c/home-<name>` made by `bin/home.sh`: the provider and model lines of `~/.codex/config.toml` only (the provider reads its key from an environment variable, so the copy holds no credential). `~/.codex/config.toml` was never edited; its mtime (18:48) predates the probes, and it contains no `/tmp/w0c` entry afterwards. `~/.codex/auth.json` was never read, copied or listed.
- Marketplace adds, plugin installs, project trust and `hooks.state` writes all landed in the scratch homes' `config.toml`, never in `~/.codex`.
- The TUI probe started a managed app-server daemon under the scratch home (`$CODEX_HOME/packages/app-server-daemon`). It was stopped with `codex app-server daemon stop` and its leftover `pid-update-loop` process was killed; `pgrep -f /tmp/w0c` was empty afterwards. No Squeal daemon was involved. tmux session `w0c-tui` exited through `/exit`.
- Hook logs record environment variable names only for the logger's own use; the committed `logs/` keep only `PLUGIN_*`, `CODEX_HOME` and presence flags (`bin/trim.mjs`).

## Files

- `bin/home.sh <name>`: scratch `CODEX_HOME`.
- `bin/mkrepo.sh <name> one|dup|split [codex-name] [version]`: a repository shaped like Squeal's plugin layout. `one`: `.claude-plugin/marketplace.json` with `squeal` (Claude Code) and `squeal-codex` (Codex) entries. `dup`: the same file with both entries named `squeal`. `split`: the Claude entry in `.claude-plugin/marketplace.json`, the Codex entry `squeal` in `.agents/plugins/marketplace.json`. The Codex plugin's `hooks/hooks.json` covers matchers, `statusMessage`, `additionalContextLimit`, clamped timeouts and `${PLUGIN_ROOT}`; every hook runs `hooks/log.sh` (a copy of `bin/hook.sh`).
- `bin/hook.sh <label>`: logs label, `pwd -P`, `$PWD`, the parent argv, env names and `CODEX_*`/`PLUGIN_*`/`CLAUDE_*` values (credential-looking names dropped), and stdin `cwd`/ids to `$W0C_LOG`. Prints nothing, exits 0.
- `bin/hash.mjs <hooks.json> <keySource>`: recomputes Codex's hook trust keys and `currentHash` outside Codex.
- `bin/as.mjs` (copied from `../codex-hooks/bin/`): `hooks/list` client. `bin/as-cwd.mjs`: Cezar-shaped app-server client, two turns, the second with a `turn/start` `cwd` override. `bin/as-trust.mjs`: trusts one plugin's hooks through `hooks/list` then `config/batchWrite`.
- `bin/q1-marketplace.sh`: Q1, three layouts. `bin/q2-setup.sh`, `bin/q2-exec.sh`, `bin/q2-appserver.sh`, `bin/q2-tui.sh`: Q2 under exec, app-server and the TUI. `bin/q3-trust.sh`: Q3 hash match, trust from computed hashes, version bump, command change. `bin/q3-trust-api.sh`: Q3 trust through the app-server API, then an `exec` run without bypass.
- `bin/show.mjs`, `bin/trim.mjs`: log summaries.
- `logs/`: trimmed evidence, named by question. In `q1-marketplace.txt` the `exit 0` after an `Error:` line is the exit of the `sed` in the pipe, not of `codex`.

## Reproduce one

```sh
bash bin/q1-marketplace.sh           # no model call
bash bin/q3-trust.sh                 # no model call
bash bin/q2-appserver.sh             # two model turns
```
