# 011-252 notes: a slow daemon start draws no extra daemons

Row 011-252 (gh-1 follow-up; `tasks/wave-55.md` W1; `tasks/011-250/notes.md` F3; the marks of `tasks/011-251/notes.md`; 011 C9 as amended 2026-10-26). Worker run `d4c38b34`, 2026-10-26.

## Measurement

Fixture: a scratch Vitest file under `/tmp/sq252-measure`, outside the worktree, so the worktree's daemon did not run it, with `TMPDIR` under `/tmp`. It used a real git repository (`initRepo`) as the harness fixture's repository (`squealRepo`), because the bundled daemon exits at once in a directory that is not a git worktree. A Claude Code session registered while told alive. The record was then cleared after a heartbeat 60 s old. The test process took the worktree's daemon lock and wrote its start mark (`acquireDaemonLock`, `markStart`), so a start was held with no record and no socket. Then, through the real hook entry points, one boundary each: Codex PostToolUse (`runCodexHook`), Claude Code PostToolBatch and Claude Code Stop (`runHook`). The hooks used the real `ensureDaemon` with `cli` set to the committed bundle `plugins/claude-code/dist/cli/squeal.mjs`, wrapped to count each `spawned` answer. After the boundaries, the test read `/proc` once a second for processes with `daemon <root>` in their arguments, and read the store's daemon notes at the end.

Before (`4cca0c0db`, 22:48 UTC, load 6.3 falling to 5.1 on 24 CPUs):

```text
+9 ms codex PostToolUse: spawns so far 1 (codex PostToolUse)
+14 ms claude PostToolBatch: spawns so far 2 (codex PostToolUse, claude PostToolBatch)
+20 ms claude Stop: spawns so far 3 (codex PostToolUse, claude PostToolBatch, claude Stop)
+30196 ms daemon pid 568438: seen from +20 to +29188 ms
+30196 ms daemon pid 568444: seen from +20 to +29188 ms
+30196 ms daemon pid 568450: seen from +20 to +29188 ms
+30196 ms spawns: 3; daemon processes seen: 3
+30196 ms note: {"at":1793051362357,"revision":null,"text":"a daemon gave up: the lock was still held after 30000 ms with no daemon serving; the next hook boundary starts one"}
(two more notes with the same text, at +9 ms and +13 ms after the first)
```

F3 holds as read: one daemon for each boundary, each a lock waiter for the full 30 s (`VACANT_LOCK_WAIT_MS`), each ending with a "gave up" note that says the next hook boundary starts one. In the incident's 85 s start, that is one waiter for each tool call in that time.

After (`2367dfa4b`'s code, 22:53 UTC, load 3.3 falling to 3.2 on 24 CPUs), the same fixture:

```text
+4 ms codex PostToolUse: spawns so far 0 ()
+7 ms claude PostToolBatch: spawns so far 0 ()
+11 ms claude Stop: spawns so far 0 ()
+3030 ms spawns: 0; daemon processes seen: 0
```

No notes.

## The change

`ensure` (`src/harness/shared/ensure.ts`) reads the marks before the plain spawn (`startCurrent`), as status and the headers read them (`marksOf`, `src/core/status/died.ts`):

- A start mark that names a live process: a start, whatever the record says. This matches `withDeath`, `replaced` and `lockOf`: with a cleared record, with a stale record whose daemon never began its shutdown, and with a stepping daemon's record.
- A hook's spawn mark within `DAEMON_START_GRACE_MS` and after the last heartbeat: a start only with the record cleared. With a stale record, a spawn mark alone is no start, because a busy daemon may hold the lock (review 0.1.355 B1, as `replaced` reads it). The boundary spawns as before.

With a start current, `ensure` returns `spawned` and spawns nothing: no `ensureDaemon` call, no spawn mark written, no `spawnedAfterRest`. No lock is taken. The check comes after `stopHolds` and the handoff (`handOver`), so a held `squeal stop` and a claimed successor (row 011-32) behave as before.

## Decisions the spec did not settle

- The result: `spawned`, an existing `HookEnsureResult`, with its comment amended. Before the change these boundaries got `spawned` from the extra spawn, so every caller acts as before: `deliver` adds no "Not validated" line, a registration says a daemon is starting (`startingAfter`), and `ensureToRegister` waits `SPAWN_SETTLE_MS` for a heartbeat. The texts do not change. `alive` would drop the registration's start; `unavailable` would add a "Not validated" line at each edited boundary.
- No `spawnedAfterRest` on the early return: the hook spawned nothing. A rest's first spawn was already recorded by the spawn that started the current start, or the start came from `squeal start`, and the rest stays quiet until that start ends.
- No store row (`ensure` without a context: a SessionStart that could not open the store, or no row yet): no mark is read, and the hook spawns as before. Status reads no start without a row either.

## Decisions of the coordinator, 2026-10-26

- Request `08d14db3`, option A: a killed daemon left its record, a replacement marked its start, and that start failed. The first boundary after the failure says "no daemon is validating" with no death sentence. No boundary spawned during the start, so this boundary spawns and writes a fresh spawn mark. While a spawn is marked, the header and status take no lock and name no death (row 011-251, F4; review 0.1.350 B1 forbids the lock during a start). Before, the death sentence came only because an extra spawn earlier had left an expired spawn mark. Once the new spawn's grace passes with no start, the next news and status name the death. The coordinator records this in `status.md` and C9 at integration; `died.ts` and `start-mark.ts` are unchanged.
- Request `32367a09`: `test/harness/stopped.test.ts` and `test/harness/stale-replacement.test.ts` are tests of `ensure`, so this row owns them. Their edits are in a separate commit.

Texts of the `stale-replacement.test.ts` fixture (a scratch run of the same steps, 2026-10-26). The notice, before the change:

```text
SQUEAL · no daemon is validating at revision 1
Revision 1: no check pending, stale or unknown. No daemon has validated since 2026-01-02T14:02:00.000Z; results are as of revision 1. The last daemon died without shutting down, between runs. A SIGKILL, or a test that signals its own process group (`kill(0, ...)`), ends a daemon this way.
```

The notice, after it:

```text
SQUEAL · no daemon is validating at revision 1
Revision 1: no check pending, stale or unknown. No daemon has validated since 2026-01-02T14:02:00.000Z; results are as of revision 1.
```

Status at that notice (plain; `--full` adds the same line, then `Daemon: no daemon running since 2026-01-02T14:02:00.000Z`):

```text
  no daemon has validated since 2026-01-02T14:02:00.000Z; results are as of revision 1; `squeal start` starts one
```

After the new spawn's grace, the next news (a failure here) has in its header `... results are as of revision 2. The last daemon died without shutting down, between runs. A SIGKILL, or a test that signals its own process group (`kill(0, ...)`), ends a daemon this way.`, and status says:

```text
  no daemon has validated since 2026-01-02T14:02:00.000Z; results are as of revision 2; it died without shutting down, between runs; `squeal start` starts one. A SIGKILL, or a test that signals its own process group (`kill(0, ...)`), ends a daemon this way.
Daemon: no daemon running since 2026-01-02T14:02:00.000Z; it died without shutting down, between runs. A SIGKILL, or a test that signals its own process group (`kill(0, ...)`), ends a daemon this way.
```

(The second line is `--full`'s.)

## Tests

`test/harness/held-start.test.ts` (new), through the real Codex PostToolUse and the real Claude Code PostToolBatch and Stop (`runCodexHook`, `runHook`), with an `ensureDaemon` that answers `spawned` and records the boundary:

- One spawn over every boundary of a held start: the first boundary finds no start and spawns; the next round finds that spawn within its grace; then the test takes the lock and marks the start, and rounds at 5 s, 11 s, 30 s and 85 s spawn nothing. Once the start fails (the lock and its mark go), each boundary spawns (below).
- With a stale record and a live start mark: no spawn over two rounds, the second past the grace.
- Still spawn: a start mark that names a process that is gone; a spawn mark at or before the last heartbeat; a spawn mark past its grace with no start mark (each boundary of the round spawns: the first spawn keeps its time); a stale record with a spawn mark alone (each boundary spawns, as before).

Before the change, the four start cases failed with the extra spawns (Squeal, revision 3: `expected [ 'Codex PostToolUse', …(2) ] to deeply equal [ 'Codex PostToolUse' ]`, and for the stale record six spawns where none were expected). The two control cases passed at revision 3 and pass after it.

Changed with the change (Squeal, revision 7, before the edits):

- `test/harness/stopped.test.ts` ("says a daemon is starting when the stop's mark lands while its SessionStart spawns one"): it expected 2 spawns. The second came from a PostToolBatch within the SessionStart spawn's grace, which is the spawn this row removes. It now expects 1. The texts it checks are unchanged.
- `test/harness/stale-replacement.test.ts` (the first case): the notice after the failed start has no death sentence (above). The case now checks that plain status and `--full` name no death at the notice, and that the next news and both forms of status name it once the new spawn's grace has passed.

## For whoever continues

- A window is left: once the first spawn's grace passes with no start mark, each boundary spawns until a daemon marks its start. `markSpawn` keeps the first spawn's time since the last heartbeat (row 011-251), so readers say the daemon stopped, and `ensure` reads the same mark. This happens after a failed start, and when a spawned daemon takes more than `DAEMON_START_GRACE_MS` (10 s) to take the lock. Idle, the window from spawn to lock is under 1 s. A fix would need a second time in the spawn mark (the last spawn, beside the first), which `src/core/daemon/start-mark.ts` owns. The test pins the current behaviour after a failed start.
- `squeal start` and older hooks write no spawn mark, so the window before their daemon takes the lock is not covered either. After that, the start mark covers it.
- The handoff path (`successor`, `--await-lock`) does not read the marks: one successor per claim (row 011-32) bounds it.
- A sentence offered for C9: "Amended 2026-10-26 (row 011-252): a hook boundary that finds a daemon's start current, as status reads it (a start mark that names a live process, or, with the record cleared, a spawn mark within `DAEMON_START_GRACE_MS` after the last heartbeat), spawns no daemon. Before, each boundary during a held start spawned one that waited up to 30 s for the lock and noted that it gave up. With a stale record, a spawn mark alone is no start, and the boundary spawns as before. So the boundary after a failed start spawns and marks that spawn, and the header and status name the recorded daemon's death only once that spawn's grace has passed with no start (the coordinator, request `08d14db3`)."

## Type changes

None. `HookEnsureResult`'s comment now says `spawned` also covers a current start.

## Checks

- `npm run lint` (biome, 2365 files, no fixes) and `npm run typecheck` (`tsc --noEmit`, exit 0) at `d03b350dd`'s code, 23:01 UTC.
- `squeal status --wait 60000 src/harness/shared/ensure.ts test/harness/held-start.test.ts test/harness/stopped.test.ts test/harness/stale-replacement.test.ts test/harness/spawn-mark.test.ts test/harness/starting-daemon.test.ts test/keys/key-format.test.ts` at revision 12 (`d03b350dd` with these notes uncommitted): `Named test files at revision 12: 4 known failures: 4 tests; 184 test files, each with a current result`. The 4 are the bundle tests (`test/harness/plugin.test.ts`, `codex/plugin.test.ts`, `pi/package.test.ts`, `opencode/package.test.ts`: `post-tool-batch.mjs`, `post-tool-use.mjs`, `worker.mjs` and `hooks/after.mjs` differ from the build). The row does not own the bundles; the coordinator rebuilds them. `spawn-mark.test.ts`, `starting-daemon.test.ts`, `stale-replacement.test.ts`, `key-format.test.ts`, `held-start.test.ts` and `stopped.test.ts` pass. 48 test files of the worktree are unknown (no check yet); none is in the selection.
- Host load during the Squeal runs: 3 to 25 on 24 CPUs (other coordinators' work; 25.0 at 23:01, 3.3 at 23:04). No failure was read as transient.
- Not run: `test/e2e/**` (Squeal does not cover it; the brief runs no e2e suite), the bundle build (not this row's).

## Commits

- `2367dfa4b` fix(011-252): a hook boundary that finds a daemon's start current spawns no second daemon
- `60b2cae18` test(011-252): stopped and stale-replacement read one spawn during a current start
- `d03b350dd` test(011-252): stale-replacement: status names the death only once the new spawn's grace passed
- the docs commit with these notes
