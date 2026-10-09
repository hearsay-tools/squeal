# Squeal plugin for Codex

Spec 002 D1, D4 and D6. Released Squeal installs from the hub marketplace `hearsay` (the private repository `hearsay-tools/marketplace`), whose `.agents/plugins/marketplace.json` pins this directory at a release tag, so the plugin id is `squeal@hearsay` (row 001-164, `research/release-hub.md`). This repository's root `.agents/plugins/marketplace.json` is named `squeal` and lists this plugin, also named `squeal`, with source `./plugins/codex`, for installs from a checkout. Codex reads that file before `.claude-plugin/marketplace.json`, so it never sees the Claude Code plugin, and Claude Code never sees this one (`research/wave-0-checks.md` 1).

## Install

Codex loads plugins only from its own cache and config, so Codex makes the install writes itself:

```sh
codex plugin marketplace add hearsay-tools/marketplace
codex plugin add squeal@hearsay
```

`hearsay-tools/marketplace` is a private repository, and whether `codex plugin marketplace add` fetches it with the user's git credentials is unverified; a user without access adds this repository from a local clone instead, `codex plugin marketplace add /path/to/squeal`, which installs `squeal@squeal` while this repository's manifest keeps the name `squeal`; trust its hooks with `/hooks`, since `--trust` trusts only `squeal@hearsay`, and install only one of the two.

A machine that installed Squeal before the hub has `squeal@squeal` from the `squeal` marketplace. With no Codex session running (Codex deletes the old plugin directory at once), remove it, `codex plugin remove squeal@squeal` and `codex plugin marketplace remove squeal`, then install as above and trust the hooks again: Codex keys trust by the plugin id, so every hook of `squeal@hearsay` starts untrusted.

Then trust the hooks once, with `squeal init --harness codex --trust` (below) or in the TUI: run `/hooks` and trust the hooks of `squeal@hearsay`. Codex skips untrusted hooks without a word, so until then Squeal says nothing. `squeal status` run in a Codex shell adds a line when it finds no consumer for `CODEX_SESSION_ID` in this worktree, and names the trust step; in the session that created the store the hooks may have run and not registered yet, so the line names no cause it cannot know.

In the project, `squeal init --harness codex` writes `squeal.config.json` with every default policy key if it is absent, and prints the commands above. It writes nothing under `~/.codex`. The agent's `squeal` comes from the npm package: Codex does not put a plugin's `bin/` on the shell's `PATH`.

## Trust from the command line

`squeal init --harness codex --trust`, run in the project after the install, does what `/hooks` does without the TUI. It starts `codex app-server` in the worktree root with the user's `PATH` and `CODEX_HOME`, asks it for the hooks (`hooks/list`), and prints each hook of `squeal@hearsay` that Codex lists as `untrusted` or `modified`, with its event, its hash and its command. On a terminal it asks once, default no; `--yes` answers yes without asking, for a script the user runs on purpose. With no terminal and no `--yes` it prints the hooks and exits 1, changing nothing. On yes it sends one `config/batchWrite` setting `hooks.state."<key>".trusted_hash` to the hash Codex reported, for exactly those hooks, lists the hooks again and prints each one's status. Exit 0 when every Squeal hook is trusted. When Codex still lists hooks of the previous `squeal@squeal`, it says so first, with how many of them are trusted and the two commands that remove it; it never trusts them.

Codex writes its own `config.toml`; Squeal opens no file under `CODEX_HOME` and computes no hash for this, so a Codex release that changes the hash format does not break it. The command never passes `--dangerously-bypass-hook-trust`. When Codex lists no hook of `squeal@hearsay` the command names the two install commands; when `codex` is not on `PATH`, or the app-server exits or stays silent for 10 seconds, it says so in one line. Either way it exits 1 and the app-server is stopped.

## Trust and updates

Codex trusts a hook by a SHA-256 over its declaration, with the command text before `${PLUGIN_ROOT}` is expanded, keyed by `squeal@hearsay:hooks/hooks.json` and the hook's position (`PLUGIN_KEY_SOURCE`, pinned in `test/cli/codex-hash.test.ts`). A version raise keeps the trust; a changed declaration loses it for that hook only, and the user trusts it again with `--trust` or `/hooks`. `test/plugins/codex/hooks-json.test.ts` pins the hashes, so a change that needs a new trust fails until the table is updated on purpose.

## Launchers

A launcher that starts threads through `codex app-server`, as Cezar does, can declare and trust the hooks itself: `squeal init --harness codex --print-launcher-config` prints a JSON object for `thread/start` `config` with one `hooks.<Event>` key per event, commands pointing at this directory by absolute path (launcher hooks get no `PLUGIN_ROOT`), and a `hooks.state` table whose keys are `/<session-flags>/config.toml:<event>:<group>:<handler>`. Its hashes come from a port of Codex 0.160.1's; a Codex upgrade may change the format, and `test/cli/codex-hash.test.ts` names the version it was checked against. The group indexes assume the launcher declares no other hook for the same event before Squeal's. The commands name the checkout that ran the command, so print the config from a stable checkout or install, never from a temporary worktree: once that directory is removed, every hook fails to start, and the hashes change with the path.

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
