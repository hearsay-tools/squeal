# Squeal plugin for Codex

Spec 002 D1 and D7 to D9. This is the fixed plugin Codex installs: Squeal's hooks, a small adapter that runs them, skill entry points and a frozen seed runtime. Squeal's code and instructions ship separately, as a runtime that updates without changing this plugin, so the hooks stay trusted across Squeal releases. Released Squeal installs from the hub marketplace `hearsay` (the private repository `hearsay-tools/marketplace`), whose `.agents/plugins/marketplace.json` pins this directory at a release tag, so the plugin id is `squeal@hearsay`. This repository's root `.agents/plugins/marketplace.json` is named `squeal` and lists this plugin, also named `squeal`, with source `./plugins/codex`, for installs from a checkout.

## Install

`install.sh` installs this plugin and the current runtime (the root [README](../../README.md#install)). From Codex's own CLI instead, which makes the install writes itself:

```sh
codex plugin marketplace add hearsay-tools/marketplace
codex plugin add squeal@hearsay
```

Then trust the hooks once: `squeal init --harness codex --trust`, or `/hooks` in the TUI. Codex skips untrusted hooks without a word, so until then Squeal says nothing. Trusting the hooks lets the adapter run the Squeal runtime releases it selects; it does not prove that a usable runtime exists, which `squeal status` and `squeal setup` report. Without an installed runtime, the first session uses the seed.

## Launchers

A launcher that starts threads through `codex app-server`, as Cezar does, can declare and trust the hooks itself: `squeal init --harness codex --print-launcher-config` prints a JSON object for `thread/start` `config` with one `hooks.<Event>` key per event and a `hooks.state` table of their trust hashes. Codex gives hooks declared there neither `PLUGIN_ROOT` nor `PLUGIN_DATA`, so each command exports both: this directory by absolute path, and the plugin data directory Codex gives the installed plugin (`PLUGIN_DATA` when set, else `<Codex home>/plugins/data/squeal-hearsay`). Print the config from a stable install, never from a temporary worktree: the hashes change with the paths.

## Contents

| Path | What |
| --- | --- |
| `.codex-plugin/plugin.json` | The manifest. Its `version` is the adapter's own, independent of Squeal's runtime version. |
| `hooks/hooks.json` | Ten handlers: SessionStart, UserPromptSubmit, PreToolUse (`*`), PostToolUse (`*`), Stop with its slow-tier wait, SubagentStart, SubagentStop, Interrupt and SessionEnd. Each command is one string, since Codex drops `args`. PreToolUse and PostToolUse run behind a `sh` test of `$PWD` that exits before Node starts in a repository with neither `squeal.config.json` nor a store. |
| `dist/<hook>.mjs` | The adapter, one bundle per hook, built from `src/harness/codex/adapter/`. It selects the session's runtime, keeps a complete copy of it and runs that runtime's hook in the same process. |
| `seed/` | A complete runtime, frozen when this plugin was built: the offline fallback before any runtime is installed. |
| `skills/` | Entry points that send the agent to the skills of the runtime the session uses. |
| `bin/squeal-launcher` | A frozen copy of the launcher, for updaters released before this layout. |

Every file here is part of the adapter. Ordinary builds and releases never change it: `pnpm run build` writes the current runtime to `plugins/codex-runtime/`. `pnpm run build:codex-adapter` rebuilds this plugin with that runtime as its seed. Any change here is an adapter release: it raises the version in `.codex-plugin/plugin.json` (`pnpm run check:version`), and users trust the changed plugin again.

Requires Node 22.19 or later on the `PATH` Codex hooks see. Linux; hooks run with `bash -c` in the thread's working directory.
