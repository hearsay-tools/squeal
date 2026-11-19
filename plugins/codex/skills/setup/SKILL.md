---
name: setup
description: Use when the user asks to set Squeal up in this repository, or to upgrade or change its setup (/squeal:setup in Claude Code, $squeal:setup in Codex). Runs squeal setup's plan, asks its questions, applies the answers and shows the diff.
---

# Squeal setup

This plugin holds Squeal's hooks and a frozen seed; Squeal's instructions ship with its runtime, which updates without this plugin (spec 002 D7). Read `skills/setup/SKILL.md` in the runtime this session uses, and follow it:

1. The SessionStart message of this session names it: "Squeal's skill for this session, kept across plugin updates: `<path>`". The setup skill is `skills/setup/SKILL.md` beside that `skills/squeal/`.
2. Without that line, read `<plugin data>/runtime/current.json`; its `version` names the runtime new sessions use, at `<plugin data>/versions/<version>/`.
3. Without that file, use the seed this plugin carries, `<plugin root>/seed/`, the plugin root being the directory that holds `seed/` and `skills/`.

The plugin data directory is `<Codex home>/plugins/data/squeal-hearsay/`, where the Codex home is `$CODEX_HOME`, by default `~/.codex`. Under Codex `squeal` is not on the PATH: run the command the SQUEAL primer names, or `node --disable-warning=ExperimentalWarning "<runtime>/dist/cli/squeal.mjs"` with the runtime found above.
