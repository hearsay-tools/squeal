# Probes: wave-0 checks (throwaway)

Throwaway probes for `../../wave-0-checks.md`, board row 005-04. Not product code. Nothing here is imported, built or tested by Squeal; delete freely.

Run 2026-10-12 23:56 to 2026-10-13 00:15 local, Claude Code 2.1.296, Codex CLI 0.160.1, Node 24.21.0, dash, curl 8.5.0, Linux 6.8, one-minute load 3.1 to 8.0 at every batch start on 24 CPUs (`logs/sessions-load.txt`).

## Rules followed

- Everything ran under `/tmp/wave0-checks`. `env.sh` gives every script a scratch `HOME`, `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `TMPDIR` and `XDG_RUNTIME_DIR`. It removes the parent session's `CLAUDE*`, `CEZ_*` and unrelated credential variables, and drops PATH entries under a real `~/.claude` or `~/.codex` (cc1 ran before that last rule; see below). The real `~/.claude/settings.json`, `~/.claude/plugins/installed_plugins.json` and `~/.codex/config.toml` were only read. Their sha256 before and after are in `logs/checksums-{before,after}.txt` and match.
- The harnesses' own CLIs (`claude plugin …`, `codex plugin …`) ran only under the scratch homes. The plugins came from a tool repository that `setup.sh` builds from `git archive` of `squeal--v0.1.131` and HEAD, through a scratch hub `hearsay`.
- No installer, `curl | sh` or repository script was run to check it. beads' `install.sh` was downloaded to `/tmp` and read. `q4/` pipes only its own scripts into `sh`, served on 127.0.0.1. Question 7 reads both repositories as text (`q7-slow-inputs.mjs` imports nothing from them). Cezarion (`~/projects/wiktor`) was read only.
- The Codex provider's non-secret fields were copied from the real config into the scratch config. The keys stay environment variables, and none is written to any file here (scanned before commit: 0 hits for 17 key, token and provider-URL values).
- Subject sessions: 12 (8 Claude Code `claude-haiku-5-5` effort low, 3 Codex `gpt-6-luna` effort low, 1 interactive run that stopped at the trust dialog before any model turn).

## Files

- `env.sh`, `setup.sh`: the scratch homes, the tool repository (`v131`, `v132`), the hub (`setup.sh hub <tag>` moves its pin), the fixtures (`fx/plain`: no Squeal; `fx/enabled`: `.claude/settings.json` enables `squeal@hearsay`), and the scratch Codex config. `setup.sh` was edited after the run, and the edits are not in the logs. Its first version let a loop's `set --` clobber the `hub` argument. The first `q5-project.sh` run therefore rebuilt the fixtures and reinstalled v131, and the second run, after the fix, is the one logged. The provider name is now read from the config instead of written in.
- `run-claude.sh`, `run-codex.sh`: one subject session each, `stream-json` or `--json` to `/tmp/wave0-checks/logs/`, with the load at start and end.
- `batch1.sh` to `batch4.sh`: the sessions (cc1, cc2, cx1 to cx3; cc1b, cc4; cc1c, cc5; cc6). cc1 is void for PATH: its PATH still held the real install's `bin/`, so `command -v squeal` found the real copy, and `squeal --version` ran there and wrote nothing. cc1b ran with the user `enabledPlugins` entry removed, so the plugin did not load (a finding of its own). cc1c is the clean run.
- `q1-ask-tui.sh`: interactive Claude Code in a private tmux server (`-L wave0`) running `/ask-probe` (`logs/cc7b-ask-tui.txt`; the aborted first run is in `logs/cc7-ask-tui-aborted.txt`).
- `q4/`: `serve.mjs` (`/cut/<file>` drops the connection halfway), `naive.sh`, `guarded.sh`, and `run.sh`, which writes an 80 KB script on the fly for A2/A3 and removes it. Output: `logs/q4-curl-sh.log`.
- `q5-install.sh`, `q5-list.sh`, `q5-project.sh`: user-scope installs in both harnesses, `claude plugin list` per user-settings state, and a project-scope install of v132 beside the user's v131.
- `q7-slow-inputs.mjs` with `q7-squeal.vitest.json` and `q7-cezarion.vitest.json`: D3's static slow and artifact rules. Output: `logs/q7-squeal.json`, `logs/q7-cezarion.json`.
- `extract.py`: trims the session records to `logs/sessions-extract.txt` (Claude Code init plugins, skills and tools, Bash calls, results; Codex tool calls from the rollouts, with the model-visible skill text). Full transcripts stayed in `/tmp`.
