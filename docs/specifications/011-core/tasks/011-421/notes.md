# 011-421 notes: the named wait's last read reuses the snapshot's rows

Row 011-421 (repair, performance, same output). Wave 125 W4, 2026-11-20. Follow-up of row 011-411 (`tasks/011-411/notes.md`, decision "The named wait's last read is not wired").

## Changes

| File | Change |
| --- | --- |
| `src/cli/wait/named.ts` | The last read of `namedPoll` builds the snapshot first, with `buildSnapshotWithReads`, and passes its `reads` to `readVerdict` and `readNamedFiles`. Before, `readVerdict` ran first, then `buildSnapshot`, then `readNamedFiles`; each read every state of the worktree. |
| `test/cli/named-snapshot-reads.test.ts` | New describe for `waitForNamed` on the same three-import store: (1) its JSON and text equal those of the separate reads (`readVerdict` and `readNamedFiles` without rows, `buildSnapshot`); (2) it calls the whole-worktree `knownStates.list` once. On the old `named.ts` the count is 3 (checked: "expected 3 to be 1"). |

No type changes.

## Decisions

- **Order.** The snapshot is built before the verdict now, because the verdict needs its rows. All three run in the poll's read transaction (`pollStatus` opens one per read, `withStatusStore`), so the order does not change what they see. The verdict's held/fixed logic (`held`, `fixed`, `heldAsVerdict`, `untaken`) and the 023-26 `withUnlisted` call are unchanged.
- **Standing time.** `readNamedFiles` keeps `standingAt` (row 011-63) as its `now`; the `reads` are rows, not a time, so it still names what held each file at the deadline's last millisecond. It passes `undefined` for `load` to keep the default `hostLoad`, as before.
- **The test settles at once.** It names B (current pass) and C (current fail), so the first decided read is the last one, and the count covers the whole wait. A pending file would add earlier poll reads, which read only the named files' states.

## Checks

- `pnpm exec vitest run --maxWorkers=2 test/cli/named-snapshot-reads.test.ts`: 4 passed. With `named.ts` from HEAD~ the new count test failed (3, not 1).
- `pnpm exec vitest run --maxWorkers=2` over `test/cli/status-wait-*.test.ts test/cli/named-*.test.ts test/cli/wait/ test/cli/handoff-wait.test.ts test/cli/slow-wait-liveness.test.ts test/cli/source-path-readers.test.ts`: 56 files, 473 tests passed.
- `pnpm run lint`, `pnpm run typecheck`: pass.
- No `test/e2e/**` file names the changed paths.
- `squeal status --wait` on the two changed paths, two waits (400 s, then 540 s): no verdict in time. 488 test files read `named.ts`. At the second deadline 63 were still pending (the backlog ran 4 files per tier, the 011-418 effect). 4 tests failed, all bundle drift: `cli/squeal.mjs differs from the build` in `test/harness/plugin.test.ts`, `test/harness/codex/packaging/runtime.test.ts`, `test/harness/opencode/package.test.ts`, `test/harness/pi/package.test.ts`. That is expected: the wave forbids `pnpm run build` in a worker, so the committed bundles do not hold this change until the coordinator builds the candidate. No other failure.
