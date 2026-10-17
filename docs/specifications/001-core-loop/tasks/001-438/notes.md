# 001-438: lowering's two carried limits

Worker notes, 2026-10-17. Spec 001 D11 Priority; review wave-18 S1 and its "Pre-existing limitations". Node 24.21.0, a 24-CPU host, the test process at nice 0, uid 1001.

## What changed (`src/core/daemon/low-priority.ts`)

- **S1, a reused pid.** `walk` returns `Identity[]`, `{ pid, start }`, not pids. `below` reads `statOf` for each descendant it lists and leaves out one already exiting. A carrier's `seen` holds `pid:start` keys, so a pid reused between two walks reads as new and is lowered. A reused pid also drops the old key, so `lost` is set as for any vanished descendant.
- **`lower` checks identity.** `lower` takes identities and lowers only those whose `statOf` start still matches. This covers the reviewer's stale-carrier case too: a `found` entry whose pid now names another process is no longer reniced.
- **The `ionice` batch.** `ionice -c 3 -p a b c` exits at the first pid it cannot set. The pids left after the identity check go to `ionice` in one batch, as before. When the batch fails (not `ENOENT`, more than one pid), each pid is retried alone, so the gone or foreign pid fails on its own.

`Identity` is a new exported type. `lowerWhile`'s fifth parameter changes from `(pid) => number[]` to `(pid) => Identity[]`. Only tests pass it; `escaped.ts` calls with four arguments and is unchanged.

## Why both the identity check and the retry

Probe (40 orphaned `sleep`s, each killed with SIGKILL and then read at once): every one already read `PF_EXITING` (25 `R`, 15 `Z`) right after `kill`, and `ionice` exited 1 on all 40. So the identity check drops almost every pid that exits before the batch. The retry covers what remains: a pid that exits between the check and `ionice`'s own `ioprio_set`, a few ms under load, or one `ionice` may not set. A pid that is the test's own unreaped child stays a zombie, which `ionice` accepts. So the test's gone pid has to be reaped first.

## Tests (`test/daemon/low-priority.test.ts`)

- `lowers a descendant at a pid an earlier walk listed for another process (wave-18 S1)`. The walk seam stands in for kernel reuse. The first walk lists the sleeper's pid with `start - 1` (the earlier process, gone before it is lowered); later walks list its real identity. Keying `seen` by pid alone fails it: `expected +0 to be 10`.
- `gives a slow lane's live descendant idle I/O past a gone pid and one not ours (wave-18)`. The batch is `[fork, gone (reaped), pid 1, live]`. Pid 1 is alive, so the identity check keeps it, and `ionice` cannot set it, which makes the retry deterministic. Results with each fix removed:

| version | result |
|---|---|
| both | pass |
| identity check, no retry | `{ nice: 10, io: 'none: prio 0' }` |
| retry, no identity check | pass (the retry covers the gone pid too) |
| neither (the code before) | `{ nice: 10, io: 'none: prio 0' }` |

  The test runs only where `ionice` exists and pid 1 belongs to another user. As root, or in a container whose init is the test's own user, it is skipped, so it never renices or ionices a real init.

## Walk cost

`bench.test.ts.txt` in this folder is 001-437's bench with a `withStat` switch. With the switch on, the walk reads one `statOf` per descendant, as `below` now does, and counts it. To run it, copy it to `test/daemon/` under a name outside Vitest's `include` (Squeal would otherwise run it) and point a temporary config's `include` at it. Delete both afterwards. The 001-437 walk and the 001-438 walk ran alternately in the same process, two rounds, load average about 5 to 6:

| 12 carriers, 10 s, after the first second | reads per look | walk wall per look (mean, p95) | walk CPU |
|---|---|---|---|
| 001-437 as recorded (review wave-18) | 19.9 | 0.264 ms (mean) | **2.24 ms a second** |
| 001-437 walk, round 1 | 19.9 | 0.298, 2.86 ms | 2.14 ms a second |
| 001-438 walk, round 1 | 21.1 | 0.283, 2.89 ms | **2.27 ms a second** |
| 001-437 walk, round 2 | 19.9 | 0.252, 2.52 ms | 1.59 ms a second |
| 001-438 walk, round 2 | 21.1 | 0.247, 2.50 ms | **2.08 ms a second** |

| first second, 12 carriers | reads per look | walk CPU per look |
|---|---|---|
| 001-437 walk, rounds 1 and 2 | 204 | 3.10, 2.60 ms |
| 001-438 walk, rounds 1 and 2 | 216 | 3.40, 2.80 ms |

One carrier, 60 s, 001-438 walk: 0.96 ms CPU a second in its first second and 0.06 ms a second after (001-437 recorded 1.0 and 0.06).

- A carrier with one child adds one `stat` read per walk, about 6% more reads.
- The walk CPU after the first second stays within the run-to-run spread of the 001-437 walk: 2.08 to 2.27 ms a second against 1.59 to 2.24.
- D11's "about 3 ms CPU a look in their first second, then about 2.5 ms CPU a second" still holds.
- `lower` adds one `stat` read per process it lowers (not per walk). The retry adds one `ionice` per pid only when a batch fails.

## For the landing

`KEY_FORMAT_VERSION` 11 re-pinned in place to `3cccc31b…b84e`. No `squeal--v*` tag carries 11: the local tags match `git ls-remote`, and the newest, 0.1.199, has 10. No version bump and no `npm run build` in this row.
