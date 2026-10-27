---
name: squeal
description: Use when about to run tests (vitest, npm test) or to check whether a change broke something, in a repository that uses Squeal (it has squeal.config.json, or SQUEAL messages appear). Squeal already runs the suites its primer lists as covered; this says when to wait for their results and how to read its reports.
---

# Squeal

This plugin holds Squeal's hooks and a frozen seed; Squeal's instructions ship with its runtime, which updates without this plugin (spec 002 D7). Read `skills/squeal/SKILL.md` and its `references/` in the runtime this session uses, and follow them:

1. The SessionStart message of this session names it: "Squeal's skill for this session, kept across plugin updates: `<path>`". Read that file.
2. Without that line, read `<plugin data>/runtime/current.json`; its `version` names the runtime new sessions use, at `<plugin data>/versions/<version>/`.
3. Without that file, use the seed this plugin carries, `<plugin root>/seed/`, the plugin root being the directory that holds `seed/` and `skills/`.

The plugin data directory is `<Codex home>/plugins/data/squeal-hearsay/`, where the Codex home is `$CODEX_HOME`, by default `~/.codex`. Under Codex `squeal` is not on the PATH: run the command the SQUEAL primer names, or `node --disable-warning=ExperimentalWarning "<runtime>/dist/cli/squeal.mjs"` with the runtime found above.
