# Squeal plugin for Claude Code

Spec 001 D9, ADR 0003. The marketplace is the repository root: `.claude-plugin/marketplace.json` there lists this plugin with source `./plugins/claude-code`. Claude Code (verified with 2.1.288) resolves plugin sources of a `github` or `git` marketplace against the clone root, so the manifest cannot live in this directory.

## Install in a project

Nothing needs to be installed globally. The marketplace repository is private, so `claude plugin marketplace add` clones it with your git credentials: run `gh auth login` first (it sets up git's credential helper), or configure another git credential helper or SSH keys for GitHub. Claude Code does not pass `GH_TOKEN` to git and has no token option; without credentials the clone fails with `HTTPS authentication failed` and then `Permission denied (publickey)` (lessons, surprise 9). From the project's root:

```sh
claude plugin marketplace add hearsay-tools/squeal
claude plugin install squeal@squeal --scope project
```

Then run `squeal init` once through Claude Code's Bash tool, for example by asking the agent to run it: the plugin puts its `bin/squeal` on that tool's `PATH`. From a clone of this repository, `<clone>/plugins/claude-code/bin/squeal init` does the same with no `npm install`: the CLI is bundled and loads Vitest from the project only when the daemon runs.

`squeal init` writes `squeal.config.json` with every default policy key if the file is absent, and adds two keys to `.claude/settings.json`: the `squeal` marketplace (`github` `hearsay-tools/squeal`) under `extraKnownMarketplaces`, and `squeal@squeal: true` under `enabledPlugins`. It keeps every other key and never writes hook commands. Settings are written first and restored if the config cannot be written. Each collaborator installs the plugin once: `claude plugin install squeal@squeal --scope project`.

The project needs its own Vitest (`npm install -D vitest`): the daemon resolves `vitest/node` from the project root. A project without it gets a runner failure note in `squeal status`, not a crash.

For development, load this directory for one session: `claude --plugin-dir plugins/claude-code`. Claude Code ignores a `--plugin-dir` that does not exist without any message, and a relative path resolves against the current directory, so pass an absolute path when in doubt. The `init` event of `--output-format stream-json` lists the loaded plugins under `plugins`; Squeal is loaded when `squeal` is there (lessons, surprise 10).

## Contents

| Path | What |
| --- | --- |
| `hooks/hooks.json` | SessionStart, SubagentStart, PostToolBatch, PreToolUse (`Edit\|Write\|NotebookEdit`), Stop, SubagentStop, SessionEnd: each `timeout: 2`. The idle waiter on SessionStart and Stop: `asyncRewake`, `timeout: 3600`. |
| `dist/*.mjs` | One bundle per hook, Node built-ins only. Sources: `src/harness/claude-code/`. |
| `dist/cli/squeal.mjs`, `bin/squeal` | The CLI on the Bash tool's PATH, and the daemon the hooks spawn. |
| `dist/cli/front-desk.mjs` | The daemon's socket worker thread, loaded beside the CLI. |
| `skills/squeal/SKILL.md` | When and how to pull `squeal status`, wait with `squeal status --wait`, `squeal why`, `squeal run --all`; policy keys. |
| `package.json` | Marks the bundles as ES modules; its version follows the root package. The bundles carry the version from the build. |

`dist/` is committed: a marketplace install copies this directory as it is in git. `npm run build` regenerates it; `test/harness/plugin.test.ts` fails when the committed bundles differ from a fresh build, and CI runs `git diff --exit-code -- plugins/claude-code/dist` after its build. `test/e2e/shipped-plugin.test.ts` runs a `git archive` copy of this directory with no `node_modules` above it against a project with its own Vitest.

## Behaviour

- Every hook exits 0 with no output on any internal error, a missing or newer-schema store, or outside a git worktree. In a repository with neither a store nor `squeal.config.json`, SessionStart starts no daemon.
- SessionStart and SubagentStart start a daemon when none answers, passing the CLI bundled beside the hooks; after spawning one, registration waits up to 750 ms for its heartbeat. PostToolBatch and Stop start one when the recorded heartbeat is older than two intervals.
- Every header says when no daemon is validating (`No daemon has validated since <time>; results are as of revision N.`), and a tool-boundary delivery says so once per consumer when that changes.
- Stop speaks only with news: a delta, a first registration that lists known failures, or a policy block. Claude Code continues the turn on Stop context, so an unconditional status header would loop. `stop.blockOnKnownFailures` blocks only on failures current at the revision; pending ones are named as pending.
- SubagentStop delivers, then unregisters the subagent's consumer unless a block keeps it going.
- SessionEnd unregisters every consumer of the session, for any `reason`, in every worktree of the store, without the daemon; when its cwd is outside any worktree it uses `CLAUDE_PROJECT_DIR`. A SessionStart for a session id first unregisters what is left of that session (subagents, other worktrees), so a missed SessionEnd cannot keep a daemon alive past the next start of the session. The daemon still expires consumers silent for 12 hours.
- `stop.waitMs` is capped at 1500 ms by the 2 s hook timeout; Stop's store lock wait after it is what is left of the 2 s minus 250 ms.
- The waiter runs only for the main agent of an attended interactive session (`CLAUDE_CODE_SESSION_ATTENDED=1`, `CLAUDE_CODE_ENTRYPOINT` not `sdk-cli`), one per consumer through a lock in `<store>/locks/waiter-*.sqlite`.
- `SQUEAL_HOOK_DEBUG=1` prints a swallowed hook error on stderr; `SQUEAL_WAITER_TIMEOUT_MS` shortens the waiter; `SQUEAL_CLI` overrides the CLI that the hooks and `squeal start` spawn as the daemon. All three are for tests and debugging.

Requires Node 22.13 or later on the PATH that Claude Code hooks see.
