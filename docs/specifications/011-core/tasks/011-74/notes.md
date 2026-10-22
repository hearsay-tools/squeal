# 011-74: `squeal hold [--max <d>] -- <command>` (notes)

Board row 011-74, R3 of `tasks/011-61/design.md` (sections 3 and 4), spec 011 C9 (*Hold command*) as amended 2026-10-21. Brief: `tasks/wave-16.md`, W2. Baseline `009ccbb49` (0.1.268). The type changes are by coordinator agreement, request 96fa359a.

## Seam map

| File | What it does now |
| --- | --- |
| `src/core/scheduler/hold-rows.ts` | The writers of the `commandHold` row of `meta` beside R1's reader, each in one transaction: `addCommandHold`, `setCommandHoldChild`, `removeCommandHold` (`null` when the entry is gone already), `clearCommandHolds`, `pruneCommandHolds` (removes the entries a rule ends, says why: `gone` or `until`). The last removal deletes the row. |
| `src/core/scheduler/command-hold.ts` | `CommandHold`, the scheduler's view of the row: `check()` reads it, prunes only when an entry ended, and writes one note per ended entry. A timer fires at the earliest `until`. `processIdentity`, `holderGone`, `holdName`, `boundText` are shared with the CLI. `COMMAND_HOLD_MAX_MS` is 3 h. |
| `src/core/scheduler/scheduler.ts` | `commandHold()`: checks the row; while it holds, aborts every flight that has a hold controller and resolves once they ended; when it stopped holding, pumps. `#fly` gives each tier whose runner cancels (`cancels(context, file)`, not a slot) its own `AbortController`, merged with the daemon's stop signal into `executeTier`'s `stop`. `#record` re-queues a hold-cut tier's unfinished files uncounted, as a supersession cancel does. `#onHold()` (merge or command) gates `#pump`, `#cutTiers`, `inUse`, `slowPending`, `owedWork` and `#hasWork`. `Ledger.holds` stays merge-only: a command hold changes no key and no lookup. |
| `src/core/scheduler/slow-tier.ts` | The slow selection's hold guard (review 0.1.269, B1): `SlowHost.held()` and `holdCheck()`. `next(launch)` runs the pump's hold check again after the load guard's wait, checks `held()` in `#select` under the lock, and starts the run through `launch` in that same block. |
| `src/core/daemon/handlers.ts`, `protocol.ts` | `hold` answers at once with a `requestId`; `hold-status` reports `settled` once the scheduler's check and cancel ended. `resume` checks the row again. A stopping daemon answers `daemon is stopping`; the next daemon starts on hold. |
| `src/core/daemon/desk.ts`, `desk-messages.ts`, `front-desk.ts` | The front desk answers from memory in a worker thread, so `hold` crosses to the daemon thread as a message and its result comes back as `hold-result`. `requestHold` and `requestResume` are optional in `DeskEvents`, so the fakes of other tests need nothing. |
| `src/core/daemon/daemon.ts`, `lifecycle.ts` | `#requestHold()` calls `scheduler.commandHold()`; before the loop runs, or while it stops, it only reads the row. The heartbeat (5 s) calls it through the optional `commandHolds` timer. |
| `src/cli/hold.ts` | The wrapper: parses, adds its entry, asks `hold` and polls `hold-status` (at most 3 s, `HOLD_WAIT_MS`), prints one line, runs the command, removes its entry, asks `resume` when it removed it. `endCommandHolds` is `squeal start`'s part. |
| `src/cli/start.ts` | Clears every entry after the stop mark, prints a line per entry whose command still runs, and asks a live daemon to `resume`. |
| `src/cli/main.ts` | The command table and `--help`. `--help` is read only before `--`. |

## Decisions the spec and design did not settle, and the choice

1. **The request waits by polling.** The front desk answers from memory, so `hold` cannot block until the cancel ended. It returns a `requestId`, and the wrapper polls `hold-status` every 50 ms, as `sync` and `sync-status` do. After 3 s the wrapper starts the command anyway; the cancel goes on in the daemon.
2. **The cancel is per flight.** A controller per tier, passed as `executeTier`'s `stop`, so neither `tiers.ts` nor the runner changed. Vitest reads it as a cancel with cause `hold` (`run cancelled: squeal hold` in the run's report). Slots (node:test, pytest) and tiers whose runner does not cancel get no controller and run to their end; no slot starts after them.
3. **Slow Vitest tiers are cancelled too** (design 3.3: "Vitest, fast and slow"). No tier is picked while a hold holds: see the repair below.
4. **When the row is read.** At `hold` and `resume`, at each heartbeat, at the scheduler's start, and by a timer at the earliest `until`. The check reads first and writes only to prune. A busy store is silent and read again at the next heartbeat. An earlier version that always wrote made `test/daemon/busy-edit.test.ts` note `database is locked`.
5. **Holder gone.** Every process the entry records is gone: missing, its PID reused (another start time), or a zombie. An entry that records no process (no `/proc`) or records them in another PID namespace ends only at `until`. The wrapper records itself before it asks the daemon and the command once it spawned, so a wrapper killed before the spawn leaves an entry that the next check removes.
6. **The command.** It is spawned without a shell, with the inherited stdio and the caller's cwd. `squeal hold -- npm run gate` works as typed; pipes and `&&` need `sh -c`. The entry's `command` is the arguments joined by spaces.
7. **Exit codes.** The command's code; `128 + n` for signal `n`; 127 when it is not found and 126 when it cannot start otherwise, as a shell exits; 2 for a usage error. SIGINT, SIGTERM and SIGHUP are passed on to the command.
8. **What the wrapper prints.** One stderr line once the hold settled: `squeal: validation of <root> is on hold until \`<command>\` exits, at most until HH:MM:SS (3 h); edits are recorded and not run`. Without a store it runs the command and says `nothing is on hold: no Squeal daemon has run in this worktree`; a hold never creates a store. A daemon that refuses `hold` (one before this row) adds `; the running daemon did not take the hold (<error>), so its tiers run on`. No daemon at all adds nothing: the next one starts on hold.
9. **`--max`.** `durationMs` of `failures.ts` (`90s`, `30m`, `2h`, `1d`); `--max=<d>` too; 0 is refused. Options are read only before `--` or the first argument that is not one.
10. **The notes.** `the hold for \`<command>\` (pid N) passed its 2 s bound` or `... ended: its command is gone`, with `; validating again` on the last when no merge hold holds either. The pid is the command's, else the wrapper's. An entry the wrapper or `squeal start` removed writes no note.
11. **`squeal start`** prints `Ended the hold for \`<command>\` (pid N); the command still runs` on stdout, before its status, for each entry whose processes live. It asks a running daemon to `resume`; a daemon it spawns reads no entry.

## Type changes (all additive)

- `src/core/types/daemon.ts`: `HoldRequest`, `HoldStatusRequest`, `ResumeRequest` in `DaemonRequest`; `HoldResponse { requestId, settled, holding: boolean | null, error: string | null }` and `ResumeResponse` in `DaemonResponse`.
- `src/core/types/scheduler.ts`: `Scheduler.commandHold(): Promise<boolean>`.
- `src/core/types/runner.ts`: `CancelCause` gains `"hold"`; `src/runners/vitest/run.ts` `CANCEL_CAUSES` gains `hold: "squeal hold"`.
- `src/core/daemon/desk.ts` `DeskEvents` and `lifecycle.ts` `TimerContext`: optional `requestHold`, `requestResume`, `commandHolds`.

## Tests (R3's done-when)

| R3 test | Where |
| --- | --- |
| 1 | `test/scheduler/command-hold.test.ts` (fake runner: the cancel within 2 s, files queued, the edit's revision, the queue at the end) and `test/daemon/hold.test.ts` test 1 (real daemon and Vitest; exits 0, 7, 143). `test/cli/hold.test.ts`: exit codes against a stand-in daemon. |
| 2 | both files, test 2: the heartbeat removes the entry within 6 s of the command's exit, with its note. |
| 3 | both files, test 3. |
| 4 | `test/scheduler/command-hold.test.ts` test 4: ends between 2 and 3 s with one note; the later removal writes nothing. |
| 5 | `test/daemon/hold.test.ts` test 5. The next daemon is started directly, not by a hook's edit: the hooks are unchanged and ensure a daemon once the first edit cleared the mark. |
| 6, 7 | `test/scheduler/command-hold.test.ts`. |
| slots | `test/scheduler/command-hold.test.ts`: a slot in flight runs its file to its end and no slot starts after it. |
| 8 | below. |

`test/daemon/hold.test.ts` runs the CLI built by `tsc` (`daemonSuite`), not the bundle; no e2e test was written for this row.

## Test 8: RSS of a held daemon (measured 2026-10-23)

This repository at `a3c67236f`, cloned into a scratch dir: 903 Vitest test files. A daemon built from the branch, with its own `HOME`, `XDG_RUNTIME_DIR` and `XDG_CONFIG_HOME`, and `baseline.onStart: "lookup-only"` so that its start ran nothing. Load average 9 to 14 on 24 CPUs. RSS is `VmRSS` of the daemon and its descendants.

| State | RSS |
| --- | --- |
| Just started, nothing run | 724 MiB |
| Idle, not on hold, after one test file ran (5 samples over 20 s) | 553 MiB |
| One tier in flight (2 test files) | 704 MiB: daemon 597, Vitest fork 104, the test's `sleep` 2 |
| On hold, the tier cancelled, after an edit of `src/core/types/index.ts` queued all 903 files (8 samples over 2 min) | 595 to 611 MiB, no descendants |
| Peak of the daemon (`VmHWM`) | 788 MiB |

A held daemon with the whole suite queued sits about 45 to 60 MiB above the same daemon idle and not on hold, and about 100 MiB below it with one tier in flight. The hold itself keeps only the row's entries; the difference is the keying of the 903-file revision. The cancel ended the Vitest fork, so nothing else stays resident. The hold was not released afterwards: that would have run all 903 files on a shared host.

## Repair of review 0.1.269, B1 (W3 of wave 16.5)

The pump checked the hold, then waited in `SlowTier.next()` for the load guard. A hold that began during that wait cancelled only the flights already in `#inFlight`. When the load fell, `#select` saw no hold and the pump flew the tier: a Vitest run started and was cancelled at once, and a node:test or pytest file ran during the hold.

- **Preemption.** `commandHold()` preempts the slow tier when the hold holds, so a load guard wait ends at once and the pump stops on the hold.
- **The check after the wait.** `next()` runs the pump's `#holdCheck` (`SlowHost.holdCheck`) after the guard, beside the runtime's check, and plans again unless it reads `free`. This sees a merge hold that began during the wait, which nothing preempts; a merge hold that ended reconciles what it released first, as at the pump.
- **The check under the lock.** `#select` returns nothing while `held()` (either hold), before it picks a file, takes a pool lease or starts the tier. The slot `next()` took is released in its `finally`. No claim, lease or running row is taken.
- **Selection and launch in one block.** `next(launch)` calls `launch` (the pump's `#fly`) inside the lock callback that ran `#select`. No `await` lies between the check and the runner call, so a hold that settled cannot be crossed by a selected tier. `SlowNext` is `"flown" | "again" | null`. Before, the selected run went back to the pump through an `await`.
- **Removed.** `#fly`'s abort of a tier picked while a command hold held: no tier is flown while either hold holds.
- **Tests.** `test/scheduler/command-hold-slow.test.ts`: the review's sequence (one slow 3 s file, the guard's load at 10 then 0 after `commandHold()` returned `true`) with a runner that cancels and one that does not, each asserting no run, no slot permit, no pool permit, and the file queued, then the run after the hold's end. Both failed at `332a3de99` (a cancelled run; a run not cancelled, in flight). A merge hold made by `git update-index` during the wait, which only the check after the wait sees: it failed at `332a3de99` too (the file ran). The in-flight slow cancel: a Vitest slow tier in flight is cancelled, its file queued, and it runs after the hold.
- **Not forced by a test.** A hold that begins while `next()` waits for the lock after taking the slot: `#select`'s `held()` stops it. No hook reaches that window; a batch that changes nothing holds the lock without a preemption.

## Not covered, for the next worker

- **Status and hooks.** R2 (row 011-73) words the command hold in status and the hooks. Until it lands, status lists the held files as queued with no reason.
- **No `/proc`.** Without it no process is recorded, and only `until` (3 h by default) or `squeal start` ends a hold whose wrapper died.
- **The wrapper's wait is bounded, not the cancel.** A runner slow to cancel goes on cancelling after the wrapper started the command at 3 s.
