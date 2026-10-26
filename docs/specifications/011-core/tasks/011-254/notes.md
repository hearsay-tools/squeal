# 011-254 notes: an opt-in mode keeps Squeal off in a worktree until `squeal start`

Row 011-254 (gh-104; `tasks/wave-54.md` W2; 011 C9, C8, C6; `research/issue-104.md`). The human approved "Approve, whole worktree" on 2026-10-26. Worker run `767601c0`, 2026-10-26, on top of row 011-251 (`9bda0f0b1`).

## What the mode is

`squeal stop --until-start [root]` stops the worktree's daemon as `squeal stop` does, and leaves the stopped mark with one more field:

```json
{ "at": 1792000000000, "tree": "<print>", "untilStart": true }
```

Same `meta` key as the plain stop (`daemon-stopped:<worktree id>`), so any `squeal start`, of any version, clears it. The mark is keyed by the worktree's id: the scope is the whole worktree, every session and harness in it, and no other worktree.

While the mark holds:

- `stopHolds` (`src/core/delivery/stopped.ts`) returns true before it prints the tree. No edit, checkout, merge, pull or any other Git operation clears it, and a boundary runs no git command for it.
- `heldStop` ignores a heartbeat after the mark. Only `squeal start` ends the mode.
- A plain `squeal stop` keeps the mode (`markStopped` keeps `untilStart` from the mark it replaces), and its line names the mode.
- Every hook boundary of every harness reads it before a spawn, as for the plain stop: `ensure` and `ensureIfStale` (`src/harness/shared/ensure.ts`, unchanged) call `stopHolds`. Tool boundaries, Stop, SubagentStop, SessionStart and a registering prompt spawn nothing. With no daemon, nothing records a revision and nothing queues.

## Texts (approved by the coordinator, requests `bab21f70` and `d789f743`)

Fixture at revision 3. The plain stop's status and header texts are unchanged.

```text
squeal stop --until-start, a daemon ran:
Squeal daemon stopped for /w; it stays stopped until `squeal start`: no edit or Git operation starts one
squeal stop --until-start, none ran (and a plain stop while the mode holds):
No daemon running for /w; it stays stopped until `squeal start`: no edit or Git operation starts one
plain squeal stop, a daemon ran:
Squeal daemon stopped for /w; `squeal stop --until-start` keeps it stopped through edits and Git operations
plain squeal stop, none ran:
No daemon running for /w; `squeal stop --until-start` keeps it stopped through edits and Git operations
usage:
usage: squeal stop [--until-start] [root]

status, Outstanding line:
  no daemon has validated since 1970-01-01T00:00:01.000Z; results are as of revision 3; stopped until `squeal start` (`squeal stop --until-start`): no edit or Git operation starts one; `squeal start` starts one
status --full, Daemon line:
Daemon: stopped until `squeal start` (`squeal stop --until-start`); no edit or Git operation starts one; run `squeal start` to validate again
hooks' header sentence (registration and delivery):
The daemon is stopped until `squeal start` (`squeal stop --until-start`); no edit or Git operation starts one; results are as of revision 3.
delivery title:
SQUEAL · the daemon is stopped until `squeal start` at revision 3
--json:
daemon.untilStart: true, beside daemon.stopped: true
```

The mode's lines leave out the hold sentence ("For a manual run across edits, ..."): no edit starts a daemon there. The command name in every line comes from the caller's command (`statusCommand` for the CLI, the hooks' `command`), so Codex, Pi and OpenCode sessions see their own. The exit-1 lines of `squeal stop` are unchanged. `squeal start`'s lines are unchanged: it already cleared the mark first.

`src/cli/main.ts` help (ownership extended to that entry by the coordinator):

```text
  squeal stop [--until-start] [root]
                                Stop this worktree's daemon; a hook starts one at the
                                next edit. --until-start: no edit or Git operation
                                starts one until squeal start
```

## Decisions of the coordinator, 2026-10-26

1. A plain `squeal stop` while the mode holds keeps the mode, and its line gets the mode's clause.
2. A daemon heartbeat after the mark does not end the mode; only `squeal start` does.
3. The `main.ts` help line as above.
4. The plain stop's two success lines end with "; `squeal stop --until-start` keeps it stopped through edits and Git operations".
5. With `--until-start`, a repository with no store gets one to hold the mark, so the mode holds from the first session (SessionStart's no-store path spawns a daemon). A plain stop still creates none.

My refinement of 5, inside its intent: the store is created only where the worktree has `squeal.config.json`. Without a policy file and a store, `usesSqueal` is false and no hook starts a daemon there anyway; a store would make the hooks read the repository as using Squeal. In that case the line still names the mode, since only `squeal start` starts a daemon there.

## Limits

- A hook older than this release reads `{ at, tree }` and ignores `untilStart`: at a tree change it clears the mark and spawns, as it does for a plain stop today. Mixed releases in one worktree defeat the mode until every session runs this release.
- The window of row 011-20: a hook that found no daemon and no mark, then spawned one while `squeal stop --until-start` wrote its mark, starts a daemon anyway. By decision 2 its heartbeat does not end the mode, so that daemon validates until it exits by itself (idle, unused, its last session's end); after that no hook starts one. A plain stop's mark is void at that daemon's first heartbeat instead.
- A hook whose store does not open (busy past its timeout, corrupt) takes the no-store path and spawns, as for the plain stop. Unchanged.

## Type changes (all additive)

- `DaemonLiveness` down: `untilStart?: true`, beside `stopped: true` (`src/core/types/status.ts`). `--json` adds `daemon.untilStart`; no field removed or renamed.
- `StoppedMark.untilStart?: true` (module-private, `stopped.ts`). `markStopped` takes `untilStart = false` and returns whether the mark it left is `untilStart`.
- `leaveStoppedMark(root, at, tree, untilStart = false)` returns `StopMarkResult` (`{ error, untilStart }`) in place of the error string (`src/cli/stopped-mark.ts`; its only callers are `stop.ts` and `test/harness/stopped.test.ts`).
- New export `untilStartText(command)` (`src/core/status/status-detail.ts`).
- `livenessTitle` and `titleOf` (`format.ts`, private) take `command`.

## Tests

- `test/harness/stopped-until-start.test.ts` (new): through the real `squeal stop --until-start`, with real git: `git merge --ff-only`, `git checkout HEAD~1` and an edit, then PostToolBatch, Stop, SubagentStop, UserPromptSubmit and a new session's SessionStart: no spawn, the title and header name the mode, the mark keeps `untilStart`, the registration stays at revision 1. Plain, `--full` and `--json` status. A heartbeat after the mark and a later plain stop: still no spawn. `squeal start`'s clear: the next boundary ensures. A second worktree: its boundary spawns while the first holds, and its own mode does not hold the first. The control: a plain stop ends at the same fast-forward.
- `test/cli/stop-mark.test.ts`: `--until-start` after a daemon (the mark, the line) and with none; the flag after an explicit root; the usage refusals; a repository with a policy file and no store: the new store holds one row, the mark, and SessionStart spawns no daemon; with neither, no store.
- `test/evals/stopped-until-start-evidence.test.ts` (new): each form the formatters give the mode (status, `--full`, a registration, a stop's delivery, a full header) names it, leaves out the plain stop's words, and reads, plain and in a Claude Code hook's JSON, as the plain stop's form does through `squealEvidence`.
- `test/harness/stopped-repo.ts` (new): the git fixture, `recording`, `text` and a `cli` runner, moved out of `stopped.test.ts` and shared with the new file.
- `test/cli/stop-lines.ts` (new): the two success lines, plain and in the mode. The stop tests that pinned the old lines use it: `daemon-commands`, `daemon-socket`, `stop-lock`, `stop-mark`, `stop-root`, `test/daemon/stop-cancel`, `test/e2e/stop-gap`, `test/e2e/stopped`. `daemon-commands` and `test/evals/squeal-refusals` pin the new usage line.

## For whoever continues

- The bundles are not rebuilt (not this row's). Until they are, the three bundle tests fail (`cli/ps.mjs differs from the build`, already so at the baseline), and `test/e2e/stop-gap.test.ts` and `test/e2e/stopped.test.ts` expect the new success line from the plugin's `dist` CLI, so they fail against the old bundle.
- The skill's `references/commands.md` (each plugin) and `README.md` name `squeal stop` and do not name `--until-start`. A sentence for the `squeal hold` paragraph, if the coordinator wants one: "For a session that wants no validation at all, `squeal stop --until-start` keeps the daemon stopped through edits and Git operations until `squeal start`."
- No end-to-end test runs the mode with real daemons; the harness tests use real git and the real CLI with a recording `ensureDaemon`.

### A sentence offered for C9

> Amended 2026-10-26 (the human, gh-104 "Approve, whole worktree", row 011-254): `squeal stop --until-start` leaves the stopped mark with `untilStart`. No tree print, edit, Git operation or daemon heartbeat clears it, and a boundary prints no tree for it; only `squeal start` does, and a plain stop keeps it. Its scope is the worktree, every session and harness in it. The header, status (`--full` too) and the delivery title say the daemon is stopped until `squeal start`, that no edit or Git operation starts one, and `--json` adds `daemon.untilStart`. `squeal stop`'s success lines name the mode while it holds, and `--until-start` otherwise. Where the worktree has a policy file and no store exists, `--until-start` creates the store to hold the mark. A hook older than the mode ignores it and clears the mark at a tree change; a daemon a hook spawned in the stop's window (row 011-20) validates until it exits by itself.

## Checks

- `npm run lint` (biome, 2290 files, no fixes) and `npm run typecheck` (`tsc --noEmit`, no errors) at `d7172ad38`.
- `squeal status --wait 400000 <the 22 changed code and test paths> test/keys/key-format.test.ts` at revision 25 (`d7172ad38` and these notes), then the 4 still running read again with `--wait 300000`: all 1186 test files of the worktree current; known failures 4, the bundle tests (`test/harness/plugin.test.ts`, `codex/plugin.test.ts`, `pi/package.test.ts`, `opencode/package.test.ts`: `cli/ps.mjs differs from the build`, the drift 011-251's notes record at its baseline; this row does not own the bundles). Every other selected file passes, `test/keys/key-format.test.ts` included. Host load 3.8 on 24 CPUs at the last read.
- Not run: `test/e2e/stop-gap.test.ts` and `test/e2e/stopped.test.ts` (outside Squeal's coverage). They run the plugin's committed `dist` CLI, which prints the old success line until the bundles are rebuilt, so they fail against the current bundle by design of this row's text change.
- Discrimination, reasoned and not run with the code removed: the plain-stop control in `stopped-until-start.test.ts` shows that the same fast-forward clears a plain mark and spawns, so the mode's test fails without `untilStart` in `stopHolds`. The store test fails without `create` (SessionStart's no-store path spawns).

## Commits

- `c7941bf47` feat(011-254): `squeal stop --until-start` keeps Squeal off in a worktree until `squeal start`
- `404c0f9be` test(011-254): the CLI's flag, its store and SessionStart; the evals read the mode as a plain stop
- `d7172ad38` test(011-254): the help lists `squeal stop [--until-start] [root]`
- the docs commit with these notes
