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

## Subagents (wave 14 W2b, commit 95ffe6a0)

- W2's open item is repaired: a subagent keeps the root its own SubagentStart `cwd` resolves. Its hooks keep that root, even after a `cd`, and its SubagentStop forgets it. See `tasks/001-415/notes.md` for what the hook inputs carry.
- Keys: `rootKey(input)` is the session id for a main agent and `<session id>\0<agent id>` for a subagent. Files are `<sha(session)>` and `<sha(session)>-<sha(agent)>`, so deleting a session's key, at SessionEnd, also removes its subagents' files. That covers a SubagentStop that never ran.
- A subagent with nothing kept falls back to the session's root, which is W2's rule.
- The Claude Code `runHandler` forgets the subagent's root only when SubagentStop does not block, because a block keeps the subagent going. Codex forgets it at `subagent-stop`, and `subagent-start` resolves it.

## Open

- A session that never ends (a missed SessionEnd, or a Codex thread with none) leaves its small file in the runtime dir until logout or reboot.
- Not isolated: a non-isolated subagent started after the main agent `cd`'d into a sibling worktree has that sibling as its SubagentStart `cwd`, so it validates there. The brief's rule ("from the subagent's own `cwd`") accepts this. Isolated worktrees are named `agent-<agent id>` (Claude Code 2.1.x bundle), which could tell the two apart if the case matters.
