# Probe: issue 21 (throwaway)

Throwaway evidence for `../../issue-21.md`. Not product code, not a test.

`probe.sh` builds a scratch Git repository under `mktemp -d` (outside this worktree), writes one `squeal.config.json` variant, and runs the installed 0.1.199 CLI from the Codex plugin cache with `node <cache>/dist/cli/squeal.mjs`. `HOME`, `XDG_*`, `CODEX_HOME` and `CLAUDE_CONFIG_DIR` point into the scratch directory, so nothing reaches the real home. It runs only `status`, `status --json`, `setup --check` and `setup --plan --json`: none of them starts a daemon or creates a store (`status` opens the store with `create: false`, 011 C6; `--plan` is read-only, 005 D3).

Usage: `sh probe.sh <negated|valid|brace>`. `output-*.txt` are the captured runs of 2026-10-17.
