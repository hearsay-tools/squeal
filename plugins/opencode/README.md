# Squeal package for OpenCode

Spec 008 D1, D2, D4 and D6. This directory is an OpenCode plugin package: `package.json` names `./dist/plugin.mjs` as its `exports["./server"]`, the module shape `opencode plugin` loads, and `engines.opencode`. `dist/` is committed and built by `npm run build:plugin` (`src/harness/opencode/build.ts`): the plugin `plugin.mjs`, the bridge, one entry per request kind under `hooks/` (`register.mjs`, `prompt.mjs`, `before.mjs`, `after.mjs`, `stop.mjs`, `end-turn.mjs`, `wait.mjs`, `end.mjs`, `ping.mjs`), the CLI and daemon under `cli/`, and the runtime files. `bin/squeal` runs this package's CLI; `bin/squeal-launcher` is the launcher every plugin ships.

## Install

`opencode plugin file:<this directory> -g`, which installs the package into OpenCode's cache and writes OpenCode's global config itself. `install.sh` does this once for a release's `.../squeal/opencode/current` link, and an update repoints the link.

## How it runs

OpenCode loads `dist/plugin.mjs` into its own process, which is Bun: it has no `node:sqlite`, and it awaits every plugin hook in series with no timeout. So the plugin imports only `node:fs`, `node:path` and `node:child_process`, and does no store work itself. At init it checks, in-process, whether the worktree uses Squeal (a `squeal.config.json` or a store) and returns no hooks where it does not; it finds a Node of at least 22.19 on the `PATH`, never OpenCode's own executable, and returns no hooks without one, logging one line through OpenCode's log.

Each hook that needs the store spawns the bridge entry of its request kind, `node dist/hooks/<kind>.mjs`, which loads only that kind's handler, in its own process group with the session's directory as cwd, writes one JSON request to its stdin and reads one JSON answer from its stdout (`src/harness/opencode/bridge-client.ts`). The plugin awaits it against one deadline per hook, every wait in the hook within it: 2 s for `chat.message`, the tool hooks and events, `stop.waitMs` (at most 1.5 s) plus 500 ms at a root's `session.idle`, `promptAsync` of a continuation included, and 3 s at `dispose`. A missed deadline kills the group and is silence; a non-zero exit, invalid JSON or a spawn error is silence too. The bridge runs the shared hook code (`src/harness/opencode/bridge.ts`, `src/harness/shared/`) with OpenCode's process as the consumer's harness process, and spawns the daemon detached, so it outlives OpenCode.

A root session's consumer is `(session id, "main")`; a child session made by the `task` tool is `(root id, child id)`. The plugin learns parents from `session.created`, or from one `client.session.get` for a session it never saw created. Its `shell.env` hook sets `OPENCODE_SESSION_ID` and `OPENCODE_AGENT_ID` in the agent's shell and puts `bin/` first on its `PATH`.
