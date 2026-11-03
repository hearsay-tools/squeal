# 019-14 notes: Stop for groups and `stop.maxHolds`

Worker 89db1657, 2026-11-03. Baseline `cand/0.1.396` (587e54fd3). Residue for integration with 019-15 and 019-16.

## Seam map

- `src/core/state/required.ts` (new): `stopRequired(policy)` gives `{ groupOf, waitMs, maxHolds }`, or `null` when no group has `stopRequires` (019-07). `groupOf(ref)` is the name of the group Stop waits for that owns the file (019-10's `groupView`), else `null`. `requiredNotCurrent(states, keys, required)` replaces `slowFilesNotCurrent` (deleted from `state/slow.ts`): each listed required file pending or not run, with its group (`RequiredFile`). `openGroups(open)` lists the groups once. Test files only.
- `src/core/delivery/turn.ts`: `readStopHolds`, `countStopHold`, `promptTurn`. The count rides in the consumer's turn row as `stopHolds`; `writeTurn` keeps it, `writeTurn(null)` drops it. Absent while 0, so the row is byte-identical to today's until a hold.
- `src/core/delivery/delivery.ts`: `startTurn` (the prompt of every harness: Claude Code and Codex `submitPrompt`, Pi `run`, OpenCode `chat.message`) calls `promptTurn` first. One line.
- `src/core/slow/stop-wait.ts`: `requestGroups(store, worktreeId, groups, budgetMs)` replaces `sendRunSlow`. `slow` sends `run-slow`; any other group reaches the marked line `// Row 019-15: run-group for <group> goes here.` in `requestGroup`. `stopWaitBoundMs(policy)` is the clamp `stopSlowWaitMs` and `stopRequired` share.
- `src/harness/shared/stop-slow.ts` (waiting entry): `stop_hook_active` no longer read. Returns at once with no hold left; `waitForRequired` asks each open group once; `decide` counts the hold in the block's transaction.
- `src/harness/shared/stop-decide.ts` (new, moved from `stop.ts`): `stopRules` (holds left, waiting entry known, `blocking`, `handoff`) and `decide`.
- `src/harness/shared/stop.ts` (2 s entry): `stopTurn` takes `quiet`; `decideTurn` loops the decisions; `hold` counts.
- `src/harness/codex/handlers.ts`: `stop` with `stop_hook_active` runs `stopTurn` with `quiet: true` instead of a bare `endTurn`; `stopSlowTier` passes no `stopHookActive`. `src/harness/claude-code/hooks/stop-slow.ts`: same input change.
- `src/harness/shared/hook.ts`: `HookDeps.monotonicNow`, the waiting entry's wait clock (default `performance.now`), for the fast-clock tests.

## Decisions the spec did not settle

1. **What counts as a hold.** A block whose reasons include required checks not current (2 s entry) or the waiting entry's block (a failure untold, or not current at the bound). A block of another policy alone is not a hold. A retries block (`STOP_DECISIONS`) counts when this entry decides the required checks, so a continued Stop cannot loop on it.
2. **Where the count lives.** In the turn row, not a new meta row: no `WORKTREE_META_ROWS` entry, and unregister and expiry already drop it. A registration while registered (SessionStart `resume` or `compact`) writes the turn row again and so drops the count: after a compaction mid-turn, `stop.maxHolds` holds are available again.
3. **SubagentStop keeps `stop_hook_active`** for required checks and never counts: spec D4.4 says SubagentStop is unchanged (one hold, no wait), whatever `stop.maxHolds` says.
4. **Codex Stop with `stop_hook_active`** stays silent about news (a Codex news block is a continuation): `quiet` skips ensure, the fast wait and `newsText`. It now decides required checks when the waiting entry is not known to run (`maxHolds` above 1 holds again there), writes the handoff, and nudges the slow tier as a silent Stop does.
5. **`blocking` (the `atRevision` guard)** is today's (`!stop_hook_active` and a blocking policy, required checks included) or "this entry decides required checks and may hold". With `stop_hook_active` and the waiting entry known, the guard stays off, as `stop-retry-bound.test.ts` pins.
6. **The 2 s entry's fast wait** skips every group lane file (`slowView(policy).isSlow`: not the `tests` group), not only slow-marked ones. Identical without `checks`.
7. **S2 zero budget.** `requestGroups` sends nothing when no time is left (`slowWaitMs: 0`); the bound's block names `run --slow --wait`. Otherwise the requests share `min(2000 ms, time left)`.
8. **Lint groups at `stop`** are not required here: `requiredNotCurrent` reads test files only, and the scheduler has no lint lane yet.

## For integration

- **019-15:** at the marked line in `src/core/slow/stop-wait.ts` (`requestGroup`), call `requestGroupRun(socketPath, group)` with `budget` as its timeout, and `.catch(() => {})`. Then `stop-required.test.ts` "blocks at the bound ... asks no run-slow for it" still passes (it counts `run-slow` only); add a `run-group` count there.
- **019-16:** the Stop texts still say `stop.requireSlowSuite` and `run --slow --wait` for a configured group (`slowSuiteReason`, `slowWaitReason`, `slowFailuresReason` in `text.ts`). `stop-required.test.ts` matches only the file list in those texts, so new words do not break it. The skill reference should say holds count per turn from the user's prompt.
- **Build:** not run. `plugins/claude-code/dist` and the Codex runtime drift (`test/harness/plugin.test.ts > bundles`, `test/harness/codex/packaging/runtime.test.ts`).

## Found, not fixed

- `stopSlowWaitMs` (still `requireSlowSuite` only) feeds `slowPolicyView.stopWaitMs`, the slow-tier status line. A configured group at `stop` has no status line until 019-16.
- `nudgeSlow` reads `header.slowPending`, which counts slow-marked files only; a configured group's files at `stop` get no nudge from the silent Stop. The waiting entry's request covers them once 019-15 connects `run-group`.
- Open question 6 (does a Claude Code Stop fire after Esc) is not probed here.
