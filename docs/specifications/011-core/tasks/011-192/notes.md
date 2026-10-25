# 011-192: why `busy-edit.test.ts:151` saw the first heartbeat after the hold seconds late

Wave 34 W4, worker c53007f3, from main a6a2aa3f6 (0.1.301). Shape: slice.

## Answer

The heartbeat was not late. The test read the wrong beat.

The daemon stamps a heartbeat before its write waits for the lock. The heartbeat step is `["heartbeat", () => beat(context, now())]` (`src/core/daemon/lifecycle.ts:340`): `now()` runs first, then `beat` opens a `BEGIN IMMEDIATE` transaction that waits up to the busy slice, 250 ms (`BUSY_SLICE_MS`, `src/core/store/busy.ts:8`; `Connection.transaction`, `src/core/store/connection.ts:47`). When the lock frees while the heartbeat's retry is in its slice, the retry takes the lock a few ms after the free, but its stamp is from before the free.

The test took the first stamp at or after the writer's `freed` (`at >= freed`). It skipped the retry's beat and waited for the next interval tick, which comes on the heartbeat's own 5 s period (`#heartbeatMs`, `src/core/daemon/daemon.ts:400`; `setInterval(heartbeat, ...)`, `lifecycle.ts:380`). That tick came 353 to 4,512 ms after the free. The revision has no such filter, so line 150 passed while line 151 failed: the shape of review 0.1.300's failure (4,224 ms).

Reproduced at natural load, none made on purpose: 2 failures in 20 runs, both this mechanism. The first beat written after the free landed 3 to 99 ms after it in all 20 runs.

No daemon fault. A stamp at most a slice older than its write changes no reader: status reads a daemon as down only after two missed periods. Stamping inside the transaction would not be enough for the test either, because the writer stamps `freed` after its `COMMIT` returns, so a daemon write can still carry a time a few ms before `freed`. The test now takes the order of the writes, not the stamps.

## What the hold blocks

- Every write. The heartbeat group (heartbeat, harness check, leaving check) gives up in its slice and is pending in `SlicedWrites` (`src/core/daemon/sliced-writes.ts:66-86`).
- While it is pending, an interval tick does nothing (`run` returns, `sliced-writes.ts:48`). One retry timer runs the pending groups after `busyBackoffMs` (0, 100, then 250 ms), one group per retry while the store stays busy; the group that gave up goes to the back, so the heartbeat and consumer expiry take turns.
- The event loop. The pass's retry and the timers' retry each hold it for a 250 ms slice, in turns (`tasks/011-122/notes.md`, "Phases after the lock frees"). Node reschedules an interval from the start of a late callback, so these holds move the heartbeat's phase. Where the next tick falls after the free is therefore not fixed.

## Evidence: 20 instrumented runs

Probe: `probe/instrument.diff` added an SQLite trigger in the fixture's store that logs every heartbeat write as `(stamp, written)`, `written` being SQLite's clock when the `UPDATE` ran, after the lock was taken. `probe/loop.sh` ran the file 20 times in this worktree, 2026-10-24 23:33Z to 23:41Z, and `probe/summary.py` reads `probe/before/beats.jsonl`. Times in ms from `freed`. Load is the one-minute average from `/proc/loadavg` before and after each run (`probe/before/runs.txt`); other wave-34 workers made it.

| Run | Load | Revision | First beat after the free (stamp, written) | Old pick (first stamp ≥ freed) | Result |
|---|---|---|---|---|---|
| 1 | 19.3 → 18.4 | 172 | 16, 16 | 16 | pass |
| 2 | 18.7 → 20.2 | 45 | 50, 50 | 50 | pass |
| 3 | 22.9 → 21.2 | 170 | 3, 3 | 3 | pass |
| 4 | 20.9 → 20.0 | 55 | 5, 5 | 5 | pass |
| 5 | 19.2 → 19.2 | 8 | 99, 99 | 99 | pass |
| 6 | 27.2 → 31.4 | 4 | 13, 13 | 13 | pass |
| 7 | 35.0 → 34.9 | 18 | 86, 86 | 86 | pass |
| 8 | 37.5 → 40.2 | 272 | 4, 4 | 4 | pass |
| 9 | 40.6 → 36.1 | 82 | **−215**, 16 | **4,512** | **fail** (line 151) |
| 10 | 34.8 → 35.0 | 312 | **−4**, 4 | **1,491** | **fail** (line 151) |
| 11 | 33.9 → 33.9 | 268 | 23, 23 | 23 | pass |
| 12 | 35.5 → 36.1 | 21 | 27, 27 | 27 | pass |
| 13 | 34.4 → 32.1 | 7 | 67, 68 | 67 | pass |
| 14 | 32.1 → 33.7 | 290 | **−60**, 20 | 353 | pass (a tick came in time) |
| 15 | 34.2 → 37.9 | 236 | 4, 4 | 4 | pass |
| 16 | 37.2 → 35.3 | 250 | 9, 10 | 9 | pass |
| 17 | 37.5 → 37.8 | 3 | 10, 11 | 10 | pass |
| 18 | 41.1 → 42.9 | 27 | 76, 76 | 76 | pass |
| 19 | 44.2 → 46.0 | 135 | 20, 21 | 20 | pass |
| 20 | 45.6 → 48.8 | 147 | 23, 24 | 23 | pass |

Run 9's failure message: `the heartbeat, lock due free at 1792885017846, freed at 1792885017851; notes: ["the store was busy for 10.7 s ...; ran once it was free: the heartbeat, consumer expiry, revision 1"]: expected 4512 to be less than or equal to 1000`. Its log shows the retry's beat (stamp −215, written +16), then nothing until the tick at +4,512.

In 3 of 20 runs the heartbeat's retry held its slice when the lock freed: 0 of 6 at load 19 to 27, 3 of 14 at 32 to 41. That hints that load raises the odds; at this n it is not confirmed. Row 011-122's 21 runs at load 3 to 22 had no miss. Load is not needed for the mechanism: only the heartbeat in its slice at the free, and a next tick more than 1 s away.

## The change

`test/daemon/busy-edit.test.ts`: `heartbeatLog` puts the same trigger in the fixture's store once the baseline has recorded. When the writer says `holding`, the test notes the last logged beat. No write lands during the hold, so the next logged beat is the first written after the free, whatever its stamp and however late the test reads it. The bound is now on that beat's `written - freed`, still `WITHIN_MS` (1,000 ms). A miss prints every beat after the hold. Replayed on the 20 runs above, that measure is 3 to 99 ms; the two failures read 16 and 4 ms. The revision's bound is unchanged.

The header comment names row 011-192.

## What the heartbeat bound does not tell

A mutant whose timers retry only every 5 s (`sliced-writes.ts:95`, `busyBackoffMs(...)` replaced by 5,000, in a copy of the tree outside this worktree) passed 7 of 7. The four logged runs (`probe/mutant/beats.jsonl`) wrote the first beat 246 to 705 ms after the free, each followed by a second beat 0 to 4 ms later, so the retry and an interval tick ran together. Why a 5 s retry lands that early in every run was not traced; the daemon was not instrumented. The fact stands: neither the old bound nor the new one caught a 5 s retry in this fixture. `test/daemon/sliced-writes.test.ts` checks that the retry happens and that ticks coalesce; no test bounds the retry's backoff. That is a possible row for the coordinator, outside this one.

## Reproduce

Apply `probe/instrument.diff` to `test/daemon/busy-edit.test.ts` at a6a2aa3f6, then `probe/loop.sh <out-dir> 20` and `python3 probe/summary.py <out-dir>/beats.jsonl`. The loop runs the test file only, in its own worktree, with `PLUGIN_ROOT` and `PLUGIN_DATA` unset.

## Verification

The changed test, `env -u PLUGIN_ROOT -u PLUGIN_DATA npx vitest run test/daemon/busy-edit.test.ts` in this worktree at dfccd343f, 20 times in a row by `probe/loop.sh`, 2026-10-24 23:48Z to 23:56Z (`probe/after/runs.txt`): 20 passed, 0 failed, 19.8 to 27.2 s each. One-minute load before and after each run, made by other workers and none on purpose:

| Run | Load | Run | Load | Run | Load | Run | Load |
|---|---|---|---|---|---|---|---|
| 1 | 33.9 → 34.8 | 6 | 24.6 → 24.9 | 11 | 58.5 → 63.1 | 16 | 53.0 → 46.0 |
| 2 | 34.8 → 29.8 | 7 | 24.9 → 38.4 | 12 | 63.1 → 61.5 | 17 | 46.0 → 45.2 |
| 3 | 29.8 → 28.2 | 8 | 38.4 → 45.6 | 13 | 61.5 → 53.7 | 18 | 45.2 → 46.1 |
| 4 | 28.2 → 24.2 | 9 | 45.6 → 55.7 | 14 | 53.7 → 50.0 | 19 | 46.1 → 47.5 |
| 5 | 24.2 → 24.6 | 10 | 55.7 → 58.5 | 15 | 50.0 → 53.0 | 20 | 47.5 → 43.2 |

The changed test logs nothing when it passes, so how many of these 20 had the retry stamped before the free is not known. The replay of the 20 probe runs above covers the two that failed.

`npm run lint`: `Checked 2065 files in 809ms. No fixes applied.`, exit 0. `npm run typecheck`: exit 0.

`squeal run --all --wait` at aee6bc72f (revision 10), 2026-10-25 about 00:00Z to 00:20Z, exit 1: "Checkpoint 23e6d032 completed at revision 10: 1 known failure: 1 test; 1066 test files". `busy-edit.test.ts` passed in it. The failure is `test/harness/opencode-dispose.test.ts`, "serve: an abort of the new turn, then the old Stop's answer, stores nothing": "the plugin killed the held Stop at +2054, at or after its idle deadline (+2000)", at load 1.56 per CPU. This change cannot reach that file (the OpenCode plugin's idle deadline). It is the load miss that row 008-38 and the 014-04 gates record. A first attempt at revision 9 had no verdict, exit 3: this worker's own notes edit made revision 10 while it ran. A retry with reason `load` is queued; Squeal runs it once the one-minute load falls below the 24 CPUs.
