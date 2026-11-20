# 011-417: a backlog tier's gate reads fresh CPU

Worker of row 011-417, wave 125 W1, 2026-11-20. Shape: repair. Source: `research/run-width-design.md` section 1 and Recommendation 1, probe `research/probes/run-width-design/stale-cores.ts`.

Brief defect: the brief names the probe as `probes/run-width-design/stale-cores.ts`. It is at `research/probes/run-width-design/stale-cores.ts`.

## Change

`src/core/capacity/pool.ts`:

- `#restartWindow()`: sets `#measured` to `null`, resets the tree and reads the tree and the host. A new window starts at that moment.
- `shrinkTo` calls it when the lease returned permits. `#release` calls it when the pool stays active (another lease or an edit's tier). When the pool goes idle, `#deactivate` already forgets `#measured`.
- Until the next refresh or gate read measures the new window, `#cores()` gives the held workers (leases' permits plus edits' workers), as it did before the first window. The mark that `#republish` writes states those workers too.
- `#busy()`: a backlog gate reads the host again once the last read is `HOST_WINDOW_MIN_MS` (1 s) old. Before, it read again only when the window was 30 s old. A window older than 30 s still counts nothing (a host read that fails keeps no window).

No type change. No change to `cores.ts`, `marks.ts`, `share.ts` or `background.ts`.

## Tests

`test/capacity/fresh-reading.test.ts` (new):

| Test | Before | After |
|---|---|---|
| A to C: a 1-permit slot open, a 9-wide tier (8 granted) at 9.5 / 8.2 / 7.2 cores ends, the next tier asks at once: offer and grant | 0 / 1 / 2 | 8 |
| The tier shrinks to 2 at 3 cores (slot 1 + tier 2): offer | 0 | 6 |
| After the end, a measured window of 4 cores counts: offer 5 | 5 | 5 (guard, not a discriminator) |
| E: a waiter looks every 2 s while another daemon's mark holds 9 at 9.6 cores; at t = 20 s that mark goes and the host reads 0.3 | 1 (the floor) | 9 |

`test/capacity/host-gate.test.ts`: the test "a window older than a mark's freshness is read again" asserted the 30 s rule. It now asserts the 1 s rule. Its second half (a checkpoint's offer reads nothing; a failed read leaves no window; the next read a second later) is unchanged.

The probe itself now prints the research's `stale-cores.d.txt` numbers: A to C 8, D 9, E 9 at t = 20 s, F 6.

## Not done, for the next worker or the coordinator

- An edit's tier that ends (`running()`'s return function) does not restart the window. C10's "a tier of its own that ended since counts no more" covers it too, but the brief and the research named leases only. An edit's tier holds no permit, so its stale cores delay a backlog tier only until the next refresh (10 s). A follow-up could call `#restartWindow()` there too.
- The gate's own read (every second while a backlog tier asks) reads the tree too and discards its value, as the 30 s read did before. So the next refresh measures the tree over the time since that read, a shorter window. `#measured` is not updated from the gate's read. Choice: the probe's design; updating `#measured` there would move the tree's cores off the refresh's cadence.
- Cost: each release beside another lease and each shrink that returns permits walks the daemon's process tree once (`ProcTreeCpu.read`). A tier's tail shrinks at each file's end, so up to one walk per ended file in the tail.

## Proposed C10 Size text

Replace, in C10 Size, "less what its tree used in that window, plus the cores its tiers use now; so a tier of its own that ended since counts no more. A window is fresh for 30 s, as a mark is; a stale one is read again at the backlog tier's gate over the time since the last read, never sooner than 1 s after it." with:

> less what its tree used in that window, plus the cores its tiers use now: when a lease ends or returns permits, its daemon counts the workers it still holds until a window that starts then is measured, so a tier of its own that ended since counts no more. A backlog tier's gate reads the host over the window since the last read once that is 1 s old; a window older than 30 s counts nothing (amended 2026-11-20, row 011-417, `research/run-width-design.md` section 1: an ended tier's measured cores counted up to 10 s and gave the next tier 0 to 2 permits instead of 8; a reading up to 30 s old gave a waiting daemon the 1-permit floor on an idle host instead of 9).

## Checks run

- On the old `pool.ts` with the new tests: `timeout 300 pnpm exec vitest run --maxWorkers=2 test/capacity/fresh-reading.test.ts test/capacity/host-gate.test.ts`: 6 failed, 13 passed (the five new discriminators and the rewritten 1 s test).
- With the fix: `timeout 300 pnpm exec vitest run --maxWorkers=2 test/capacity/`: 11 files, 76 tests passed.
- The 20 test files outside `test/capacity/` that use the pool (`grep -rl "createPermitPool\|capacity/pool" test`), `timeout 600 ... --maxWorkers=2`: 20 files, 63 tests passed.
- No `test/e2e/**` file names the changed paths.
- `pnpm run lint`, `pnpm run typecheck`: pass.
- Squeal, `squeal status --wait <ms> src/core/capacity/pool.ts` at revision 7 (`pool.ts` reaches 1,204 test files): 767 current and pass, 437 pending when the daemon's heartbeat stopped (a new daemon was starting). 2 fail, both expected bundle drift: `test/harness/opencode/package.test.ts` and `test/harness/pi/package.test.ts`, "cli/squeal.mjs differs from the build". The brief forbids `pnpm run build` in this worktree; the coordinator's build at the candidate clears them. The Claude Code bundle test will drift the same way.
