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
- The window of row 011-20: a hook that found no daemon and no mark, then spawned one while `squeal stop --until-start` wrote its mark, starts a daemon anyway. By decision 2 its heartbeat does not end the mode, so that daemon validates until it exits by itself (idle, unused, its last session's end); after that no hook starts one. A plain stop's mark is void at that daemon's first heartbeat instead. Every reader says that daemon is starting while its start is current, and alive once it heartbeats (R1 below).
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

## R1: review 0.1.357 B1 (wave 54.5)

Worker run `767601c0` resumed, 2026-10-26, on cand/0.1.357 `2b6727237`. Brief: `tasks/wave-54.5.md` R1; review `reviews/0.1.357.md` B1.

### The defect

A stop `--until-start` that lands while a SessionStart spawns a daemon (the window of row 011-20) left `untilStart` beside a start. `asTold` dropped `stopped` and kept `untilStart`, and the header, the Outstanding line and the `Daemon:` line read `untilStart` alone, so the registration said "stopped until `squeal start`" for a daemon that was starting. In status, `asStopped` set the stop before `withDaemonFacts` read the marks, and `started` skips a start when `stopped` is set. So a cleared record with a spawn mark or a start mark read as stopped, and a stale record with a start mark carried both `stopped` and `startingSince`.

### One rule

A current start wins over a stop, for both stops. `asStopped` (`stopped.ts`) sets neither `stopped` nor `untilStart` while a start is current:

- a start a consumer was told (`startingSince` set, `asTold`);
- a start mark that names a live process, with any record;
- a hook's spawn mark within its grace after the last heartbeat, with the record cleared only (`startCurrent`, read through `marksOf`, as `withDaemonFacts` reads them; with a stale record a busy daemon may hold the lock, 011-251).

Then `withDaemonFacts` adds the start as before. `asTold` drops both fields (`withoutStop`). The header, the delivery title, the Outstanding line and the `Daemon:` line name a stop only through `stopOf`, which reads `untilStart` only with `stopped` and no stop while `startingSince` is set. The stored mark is not changed (`markStopped`, `heldStop`, `stopHolds`): it still blocks every spawn, and once the start ends it reads as stopped again. No new text.

`asStopped` takes the reader's clock (`now`), for the spawn mark's grace. Its three callers pass it: `readLiveHeader` and `livenessChange` (`liveness.ts`), and status's snapshot (`snapshot.ts`, one argument, by agreement).

### Decisions of the coordinator (request `90086442`, 2026-10-26)

1. The one call edit in `src/core/status/snapshot.ts`: `asStopped(..., now)`; `now` stays required.
2. The plain stop follows the same rule. While a start is current beside a plain mark, status, `--full`, `--json` and the headers say a daemon is starting, not "stopped by request", as the hooks already said after a told start (row 011-20; C9: a starting daemon is not stopped). Before, `started` skipped a start while `stopped` was set. The coordinator puts it in `status.md` and C9 at integration.
3. `marksOf` (`died.ts`) is imported read-only; one helper, `stopOf`, serves the renderers.

### What every reader says now (fixture at revision 4, a stop's mark after the last heartbeat)

| Record | Other mark | Status, `--full`, `--json`, header | Wait's first judgment |
| --- | --- | --- | --- |
| Cleared | None | stopped (until start, or by request) | down, stopped |
| Cleared | Recent spawn | starting, `startMark: "spawn"` | lapsed, locked |
| Cleared | Live locked start | starting, `startMark: "start"` | lapsed, locked |
| Stale | None | stopped | lapsed, socket check |
| Stale | Recent spawn only | stopped | lapsed, socket check |
| Stale | Live locked start | starting, `startMark: "start"` | lapsed, locked |

`wait-liveness.ts` needed no change: its judgment already read the marks as 011-251's readers do; status now agrees with it.

### Tests

- `test/harness/until-start-spawn.test.ts` (new): the review's sequence through the real `runHook("session-start")`, its `ensureDaemon` writing the `untilStart` mark before it answers `spawned`. While the start is current: the registration says a daemon is starting; status's JSON has `startMark: "spawn"` and no `stopped` or `untilStart`; plain, `--full` and the header say starting; the wait reads `lapsed, locked`; the next PostToolBatch says nothing. After the registration (marks removed) and a heartbeat: alive in every reader, no news. After the daemon cleared its record: the next PostToolBatch titles "the daemon is stopped until `squeal start`", status, `--full`, `--json`, the header and the wait read stopped, and a boundary past the grace says nothing. Exactly one spawn over the whole sequence.
- `test/cli/until-start-readers.test.ts` (new): the table above for both stops (12 cases), through `squeal status`, `--full`, `--json`, `readLiveHeader` with `headerLines`, and `watchDaemon(...).judge`. Also `stopOf`: `untilStart` without `stopped` names no stop; `stopped` with `startingSince` says starting.
- `test/harness/stopped-repo.ts`: `recording("alive")`. The setup SessionStart of `stopped.test.ts` and `stopped-until-start.test.ts` now finds the recorded daemon alive, as a real ensure does. Before, its fake `spawned` made the real hook write a spawn mark after the recorded heartbeat that no registration removed, which the rule rightly read as a current start.
- Discrimination, run: the two new files against `2b6727237`'s code (a scratch copy of `src`, `test`, `evals/lib` and the configs, with node_modules linked, `npx vitest run <the two files> --maxWorkers=1`): 9 failed, 6 passed. The SessionStart sequence, the three start rows of each stop and both `stopOf` cases fail; the three stopped rows of each stop pass.

### R1 checks

- `npm run lint` (biome, 2299 files, no fixes) and `npm run typecheck` (no errors) at `769807655`.
- `squeal status --wait <the 12 changed paths> test/keys/key-format.test.ts`, read three times up to revision 36 (`769807655`): all 1194 test files of the worktree current; 5 known failures. Four are the bundle tests (`cli/squeal.mjs differs from the build`: this row changed `src`, and the coordinator rebuilds). One is `test/cli/codex-trust.test.ts`: the host's real Codex CLI now writes `trusted_content_hash = "sha256:…"` lines where the test expects `trusted_hash`. It failed at revision 28, the bare candidate, before the first R1 edit: the host's Codex, not this row. `test/keys/key-format.test.ts` passes.
- `env -u PLUGIN_ROOT -u PLUGIN_DATA npx vitest run test/e2e/stopped.test.ts test/e2e/stop-gap.test.ts --maxWorkers=1`: 2 files, 6 tests passed, 35.2 s, load 3 on 24 CPUs. They run the committed candidate bundle, which does not hold R1.
- Controls held in Squeal's run: the plain-stop tests (`stopped.test.ts`, `starting-daemon.test.ts`), the Git and worktree tests (`stopped-until-start.test.ts`), the no-store tests (`stop-mark.test.ts`), the evals parser (`stopped-until-start-evidence.test.ts`, `stopped-hold-evidence.test.ts`) and 011-251's readers (`start-readers.test.ts`).

### R1 commits

- `79cf399ee` fix(011-254): review 0.1.357 B1: a current start wins over a stop in every reader
- `769807655` test(011-254): review 0.1.357 B1: the review's table, through every reader, beside either stop
- the docs commit with this section

### A sentence offered for C9

> Amended 2026-10-26 (review 0.1.357 B1, row 011-254): a current start wins over a stop, for both stops. While a consumer was told a daemon is starting, a start mark names a live process, or, with the record cleared, a hook's spawn mark is within its grace after the last heartbeat, status, `--full`, `--json`, the headers and the delivery title say a daemon is starting, as a wait reads it, and name no stop. The stopped mark is unchanged and still blocks every spawn; once the start ends it reads as stopped again.
