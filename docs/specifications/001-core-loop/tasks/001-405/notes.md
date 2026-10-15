# 001-405 notes: hooks stay on the session's root

Wave 14 W2. Commit `d0484d2c`.

## Seam map

- `src/harness/shared/session-root.ts` (new) has three parts:
  - `sessionLocation(input, start, roots)` decides each hook's root.
  - `SessionRoots` is the store interface.
  - `sessionRootFiles(env)` stores one file per session under `<runtimeDir>/squeal-sessions/<sha256(session id)[:32]>`, holding JSON `{ root, commonDir }`. The directory comes from `preparePrivateDir` (mode 0700, owner checked). A file another user owns, or one whose root is gone, counts as nothing kept. Every operation is best effort: a failure falls back to locating the hook's `cwd`.
- `HookDeps.sessionRoots` is optional and additive. Only the bundle entry points set it: `claude-code/main.ts` and `codex/main.ts` pass `sessionRootFiles(process.env)`. In-process tests that do not pass it keep the old cwd behaviour. This matters because nearly every harness test shares one `SESSION` id; a default store under `/tmp/squeal-<uid>` would leak a root from one test into the next.
- `runHandler` (Claude Code) and `runCodexHandler` call `sessionLocation`, then forget the root at `session-end`. Claude Code's `CLAUDE_PROJECT_DIR` fallback for SessionEnd still applies when nothing resolves.

## Rules

- A main agent's SessionStart with source `startup` or `resume`, or with no source, resolves its `cwd` again. `compact` and `clear` continue the same run, whose `cwd` may have moved, so they keep the stored root. SubagentStart keeps it too.
- A session that has no stored root keeps the first root any of its hooks resolves. That covers a session started outside every worktree, a stored root that has since gone, and a hook installed mid-session.

## Adapters

- Pi: every request carries `ctx.cwd`, Pi's own session cwd. A `cd` inside the bash tool does not change it, so nothing changed.
- OpenCode: the bridge locates from the plugin's `worktree` input. A bash `workdir` only shapes the test-command check. Pinned by a test in `test/harness/session-root.test.ts`.

## Open

- A worktree-isolated Claude Code subagent now reports the session's root, not its own worktree. The rule is per session, as the human decided. A per-agent root would need SubagentStart's `cwd`, which was not checked here.
- A session that never ends (a missed SessionEnd, or a Codex thread with none) leaves its small file in the runtime dir until logout or reboot.
