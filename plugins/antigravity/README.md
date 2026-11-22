# Squeal for Antigravity

Squeal is a continuous validation layer for coding agents. It runs your project's tests in the background while the agent edits, and tells the agent when a test changes from passing to failing, or back, in the same turn. The agent does not run the tests itself.

This directory is Squeal's native Antigravity plugin (spec 024). It supports the Antigravity CLI on Linux: the interactive TUI, `agy -p`, and `--input-format stream-json`.

## What it does

- **SessionStart** registers the conversation with Squeal and gives the agent a short primer.
- **PreInvocation** runs before every model call. At the start of a user turn it registers the conversation again if needed. After each tool batch it tells the agent about any test that changed from passing to failing, or from failing to passing.
- **PreToolUse** runs on the file-editing tools (`write_file`, `edit_file`, `write_to_file`, `replace_file_content`, `multi_replace_file_content`) and on `run_command`. With `interrupt.onRegression` on, the first edit after an undelivered regression is denied once, with the failing tests as the reason. With `testCommand.denyWhenCurrent` on, a test command whose result Squeal already has is denied once. On allow or on any error, the hook prints nothing, so Antigravity never blocks a tool because of Squeal.
- **Stop** speaks only when there is news or a policy block. A second entry, `stop-slow`, waits for slow check groups when the project asks for that.

Each subagent is its own Squeal consumer, with its own primer and its own view of the results.

Outside a Squeal project, `hooks/run --if-squeal` reads the hook payload in `sh`, finds no `squeal.config.json` and no store, and exits in a few milliseconds without starting Node.

## Install

Run Squeal's `install.sh`. With the Antigravity CLI (`agy` or `antigravity`) on the `PATH`, it unpacks this directory from the release and runs `agy plugin install <directory>`. Antigravity copies the plugin to `~/.gemini/config/plugins/squeal/`. Squeal writes no file under `~/.gemini/config/` itself.

To install from a checkout instead, run `agy plugin install plugins/antigravity` after `pnpm run build:plugin`.

`squeal update` installs a new release the same way. Because `plugin install` replaces the plugin directory in place, Squeal keeps a copy of each version under the plugin data directory, `~/.gemini/antigravity-cli/plugin_data/squeal/versions/<version>/`, so daemons started by an earlier session keep running.

## The `squeal` command

A plugin puts nothing on the `PATH`. Squeal's messages name the command to run: the launcher `<plugin data>/bin/squeal`, or before the first kept copy, `node --disable-warning=ExperimentalWarning "<plugin root>/dist/cli/squeal.mjs"`.

In an Antigravity shell where the hooks never registered the conversation, `squeal status` adds a line that says so and names the install command.

## Files

- `plugin.json`: the manifest, at the root version.
- `hooks.json`: the hooks, at the plugin root under the group `squeal`.
- `hooks/run`: the POSIX `sh` fast path every hook runs through.
- `dist/`, `skills/squeal/`, `bin/squeal-launcher`: written by `pnpm run build:plugin` (`src/harness/antigravity/build.ts`) and committed.

## License

UNLICENSED. Source: https://github.com/hearsay-tools/squeal
