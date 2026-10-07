# Squeal plugin for Codex

Spec 002 D1, D4 and D6. The marketplace is the repository root: `.agents/plugins/marketplace.json` there is named `squeal` and lists this plugin, also named `squeal`, with source `./plugins/codex`. Codex reads that file before `.claude-plugin/marketplace.json`, so it never sees the Claude Code plugin, and Claude Code never sees this one (`research/wave-0-checks.md` 1).

## Install

Codex loads plugins only from its own cache and config, so Codex makes the install writes itself:

```sh
codex plugin marketplace add hearsay-tools/squeal
codex plugin add squeal@squeal
```

Then trust the hooks once: open the TUI, run `/hooks`, and trust the hooks of `squeal@squeal`. Codex skips untrusted hooks without a word, so until then Squeal says nothing; `squeal status` run in a Codex shell says so when it finds no consumer for `CODEX_SESSION_ID`.

In the project, `squeal init --harness codex` writes `squeal.config.json` with every default policy key if it is absent, and prints the commands above. It writes nothing under `~/.codex`. The agent's `squeal` comes from the npm package: Codex does not put a plugin's `bin/` on the shell's `PATH`.

## Trust and updates

Codex trusts a hook by a SHA-256 over its declaration, with the command text before `${PLUGIN_ROOT}` is expanded, keyed by `squeal@squeal:hooks/hooks.json` and the hook's position. A version raise keeps the trust; a changed declaration loses it for that hook only, and the user trusts it again with `/hooks`. `test/plugins/codex/hooks-json.test.ts` pins the hashes, so a change that needs a new trust fails until the table is updated on purpose.

## Launchers

A launcher that starts threads through `codex app-server`, as Cezar does, can declare and trust the hooks itself: `squeal init --harness codex --print-launcher-config` prints a JSON object for `thread/start` `config` with one `hooks.<Event>` key per event, commands pointing at this directory by absolute path (launcher hooks get no `PLUGIN_ROOT`), and a `hooks.state` table whose keys are `/<session-flags>/config.toml:<event>:<group>:<handler>`. Its hashes come from a port of Codex 0.160.1's; a Codex upgrade may change the format, and `test/cli/codex-hash.test.ts` names the version it was checked against. The group indexes assume the launcher declares no other hook for the same event before Squeal's.

## Contents

| Path | What |
| --- | --- |
| `hooks/hooks.json` | SessionStart, UserPromptSubmit, PreToolUse (`*`), PostToolUse (`*`), Stop, SubagentStart, SubagentStop: `timeout: 2`. Interrupt and SessionEnd: `timeout: 3`, their clamp. Each command is one string, since Codex drops `args`. PreToolUse and PostToolUse run behind a `sh` test of `$PWD` that exits before Node starts in a repository with neither `squeal.config.json` nor a store. |
| `dist/*.mjs` | One bundle per hook, built from `src/harness/codex/`. |
| `dist/cli/squeal.mjs` | The CLI the hooks spawn as the daemon, with `dist/cli/front-desk.mjs` beside it. |
| `skills/squeal/` | The skill, copied by the build from `plugins/claude-code/skills/squeal/`. |
| `.codex-plugin/plugin.json` | The manifest. The build writes its `version` from the root `package.json`. |

`dist/` and `skills/` are committed and built by `npm run build:plugin`; a change to `dist/` raises the root version (`npm run check:version`).

Requires Node 22.13 or later on the `PATH` Codex hooks see. Linux; hooks run with `bash -c` in the thread's working directory.
