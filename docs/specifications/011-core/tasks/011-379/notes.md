# 011-379: class-A files wait with `rest()`

Worker f3c9eb6b, wave 114 W1, 2026-11-16. Base: `0bce31956` (0.1.524). Shape: slice.

## Answer

All 22 files moved. None was sent to row 011-380. Each test file that reaches a moved call passed 3 of 3, and its time did not change between rounds.

## The edit

One line per call site; nothing else changed.

- Vitest harness (`h`): `h.scheduler.idle()` → `h.rest()`. Files: `busy-hold`, `busy-requests`, `rekeyed-wait`, `resolved-wait`, `runner-bound-retry`, `slow-continuous`, `slow-nudge`, `slow-pool`, `slow-rank`, `slow-release-setup`, `slow-request-join`, `slow-request-load`.
- Catch-up side (`side`): `side.scheduler.idle()` → `side.rest()`. Files: `admission-runner-work`, `group-lanes-moments`, `group-lanes-width`, `manual-groups`, `narrow-run`, `sync-readers`, `group-lanes-fixture.ts`.
- Claims fixture and wall fixture (no `rest()` of their own): `.scheduler.idle()` → `.scheduler.rest()`. Files: `backlog-wall` (`WallSide` has no `rest()`; typecheck found it), `claims-slow-slot` (`b`), `wall-fixture.ts` (2 sites).

Not edited:

- `fresh-worktree-durations.test.ts`: row 011-378 owns it (brief).
- `group-lanes-default`, `group-lanes-integration`, `group-lanes-limits`: no call of their own; they reach `group-lanes-fixture.ts`, which moved. Run below.
- `runtime-files-slow.test.ts`: no call of its own; it reaches only `quiet-clock.ts`, which row H (011-378) moves. Not run here; the row that moves `quiet-clock.ts` runs it.

`git grep -nE "scheduler\??\.idle\("` over the 22 moved files finds nothing.

## Runs

`env -u PLUGIN_ROOT -u PLUGIN_DATA timeout 600 node_modules/.bin/vitest run --maxWorkers=3 <23 files>`, three rounds, 24 CPUs, 61 tests per round, all passed. Load is the one-minute load average:

- Round 1: 16:48:07 to 16:48:38 UTC, load 8.2 → 7.9.
- Round 2: 16:48:38 to 16:49:09 UTC, load 7.9 → 8.5.
- Round 3: 16:49:09 to 16:49:40 UTC, load 8.5 → 8.1.

| File | Round 1 | Round 2 | Round 3 |
|---|---|---|---|
| `admission-runner-work.test.ts` | passed 0.4 s | passed 0.4 s | passed 0.4 s |
| `backlog-wall.test.ts` | passed 3.4 s | passed 3.2 s | passed 3.2 s |
| `busy-hold.test.ts` | passed 6.7 s | passed 6.7 s | passed 6.7 s |
| `busy-requests.test.ts` | passed 1.1 s | passed 1.3 s | passed 1.2 s |
| `claims-slow-slot.test.ts` | passed 0.3 s | passed 0.3 s | passed 0.3 s |
| `group-lanes-default.test.ts` | passed 0.5 s | passed 0.5 s | passed 0.5 s |
| `group-lanes-integration.test.ts` | passed 1.4 s | passed 1.5 s | passed 1.4 s |
| `group-lanes-limits.test.ts` | passed 2.2 s | passed 2.3 s | passed 2.1 s |
| `group-lanes-moments.test.ts` | passed 3.3 s | passed 3.3 s | passed 3.3 s |
| `group-lanes-width.test.ts` | passed 0.4 s | passed 0.5 s | passed 0.4 s |
| `manual-groups.test.ts` | passed 2.4 s | passed 2.4 s | passed 2.4 s |
| `narrow-run.test.ts` | passed 2.5 s | passed 2.5 s | passed 2.5 s |
| `rekeyed-wait.test.ts` | passed 1.1 s | passed 1.3 s | passed 1.3 s |
| `resolved-wait.test.ts` | passed 0.7 s | passed 0.7 s | passed 0.7 s |
| `runner-bound-retry.test.ts` | passed 3.7 s | passed 3.5 s | passed 3.5 s |
| `slow-continuous.test.ts` | passed 7.4 s | passed 7.5 s | passed 7.6 s |
| `slow-nudge.test.ts` | passed 2.6 s | passed 2.6 s | passed 2.7 s |
| `slow-pool.test.ts` | passed 1.6 s | passed 2.0 s | passed 1.7 s |
| `slow-rank.test.ts` | passed 23.3 s | passed 23.5 s | passed 23.4 s |
| `slow-release-setup.test.ts` | passed 6.9 s | passed 6.9 s | passed 6.9 s |
| `slow-request-join.test.ts` | passed 0.7 s | passed 0.9 s | passed 0.7 s |
| `slow-request-load.test.ts` | passed 5.2 s | passed 5.2 s | passed 5.3 s |
| `sync-readers.test.ts` | passed 0.1 s | passed 0.1 s | passed 0.1 s |

Limit: no run on the old `idle()` code at the same load, so "ends at the same point" rests on the survey's probe (every call `same`) and the stable times here, not on a before/after comparison.

Squeal: `squeal status --wait 60000` on the 22 changed paths, revision 2: 30 test files selected (the fixtures select 13 and 4 readers), no known failures, each current.

## After candidate CI 43916532418 (coordinator, 2026-11-16)

`claims-slow-slot.test.ts` is class B on CI: on Node 26 (shard 3/3) its `records` case read `passing()` as 1 where 2 was expected, because `rest()` returned while the released run was still in flight (the survey's warning: a call that is "same" on this host can be "aside" on a slower one). It now waits with the claims side's `quiet()` (row 011-378), which also waits for runner work. Local: 3 of 3 at load 3.5 to 6.
