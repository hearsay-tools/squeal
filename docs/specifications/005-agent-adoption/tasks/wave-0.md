# 005 wave 0 brief

## 005-04 wave-0 checks

Use /researcher. Shape: research.

**Outcome:** `research/wave-0-checks.md` answers open questions 1, 2, 4, 5 and 7 well enough for 005-12, 005-14 and 005-19 to be briefed.

**Read:** spec 005 D3, D5 and "Open questions"; `research/cli-distribution.md`; `research/README.md` "Rules" (format, evidence tags, probes under your own `/tmp` directory, pinned harness versions).

**Questions:** the board row 005-04, one section each. Question 7 is static only: run D3's slow-input rules over this repository and a cezarion copy (`~/projects/wiktor`, read-only), with no test run, and compare them with the inputs declared by hand.

**Isolation (hard rule):** the real `~/.claude`, `~/.codex` and `~/.config` stay untouched. Run the harnesses' own CLIs only under a scratch `CLAUDE_CONFIG_DIR` and `CODEX_HOME` in your `/tmp` directory. Record checksums of `~/.claude/settings.json`, `~/.claude/plugins/installed_plugins.json` and `~/.codex/config.toml` before and after, and paste both. Never execute a third-party installer or a `curl | sh`: read it. Never run or import a repository script to check it. If a question needs anything else, answer it from docs and source and say so.

**Budget:** at most 20 subject sessions, Haiku 5.5 or Sonnet 5.5 and Codex gpt-6-luna. Load below 24, checked before each batch and recorded.

**Owns:** `research/wave-0-checks.md` and `research/probes/wave-0-checks/`. Nothing else.

**Done when:** the file is committed and each answer is tagged with its evidence.
