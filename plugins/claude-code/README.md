# Squeal plugin for Claude Code

Spec 001 D9, ADR 0003. This directory is both the plugin and its marketplace root (`.claude-plugin/marketplace.json` lists the plugin with source `.`).

## Install in a project

```sh
squeal init
claude plugin install squeal@squeal --scope project
```

`squeal init` writes `squeal.config.json` with every default policy key if the file is absent, and adds two keys to `.claude/settings.json`: the `squeal` marketplace (`github` `hearsay-tools/squeal`, path `plugins/claude-code`) under `extraKnownMarketplaces`, and `squeal@squeal: true` under `enabledPlugins`. It keeps every other key and never writes hook commands. Each collaborator installs the plugin once.

For development, load this directory for one session: `claude --plugin-dir plugins/claude-code`.

## Contents

| Path | What |
| --- | --- |
| `hooks/hooks.json` | SessionStart, SubagentStart, PostToolBatch, PreToolUse (`Edit\|Write\|NotebookEdit`), Stop, SubagentStop, SessionEnd: each `timeout: 2`. The idle waiter on SessionStart and Stop: `asyncRewake`, `timeout: 3600`. |
| `dist/*.mjs` | One bundle per hook, Node built-ins only. Sources: `src/harness/claude-code/`. |
| `dist/cli/squeal.mjs`, `bin/squeal` | The CLI on the Bash tool's PATH. |
| `skills/squeal/SKILL.md` | When and how to pull `squeal status`, `squeal why`, `squeal run --all`; policy keys. |
| `package.json` | Version for `squeal --version` from the bundle; marks the bundles as ES modules. |

`dist/` is committed: a marketplace install copies this directory as it is in git. `npm run build` regenerates it; `test/harness/plugin.test.ts` fails when the committed bundles differ from a fresh build.

## Behaviour

- Every hook exits 0 with no output on any internal error, a missing or newer-schema store, or outside a git worktree. In a repository with neither a store nor `squeal.config.json`, SessionStart starts no daemon.
- Stop speaks only with news: a delta, a first registration that lists known failures, or a policy block. Claude Code continues the turn on Stop context, so an unconditional status header would loop.
- `stop.waitMs` is capped at 1500 ms by the 2 s hook timeout.
- The waiter runs only for the main agent of an attended interactive session (`CLAUDE_CODE_SESSION_ATTENDED=1`, `CLAUDE_CODE_ENTRYPOINT` not `sdk-cli`), one per consumer through a lock in `<store>/locks/waiter-*.sqlite`.
- `SQUEAL_HOOK_DEBUG=1` prints a swallowed hook error on stderr; `SQUEAL_WAITER_TIMEOUT_MS` shortens the waiter; `SQUEAL_CLI` overrides the CLI that `ensureDaemon` spawns. All three are for tests and debugging.

Requires Node 22.13 or later on the PATH that Claude Code hooks see.
