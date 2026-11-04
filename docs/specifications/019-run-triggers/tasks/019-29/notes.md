# 019-29 notes: the commit line in the boundary that sees the commit

Worker fc0f9273, 2026-11-04. Brief `tasks/wave-5.md`, 019-29 (lessons round 1, P2 option a). Base `68c033886` (cand/0.1.399 plus the wave 5 briefs). No build: the bundles are the candidate's.

## What changed

1. **The wait.** `syncOnHeadMove` (`src/core/commit/boundary.ts`) still asks for a `sync` pass only when `HEAD` moved since the daemon's last look. It now also asks `sync-status` every 20 ms until the pass ended, bounded at `HEAD_MOVE_WAIT_MS` (500 ms) from before the first ask. The daemon answers `sync-status` with a revision only after `reconcile()`, and that pass runs `reportHeadMove`, which stores the report with `seen`. So when the wait ends on an ended pass, the report is in the store, and the same boundary's `onToolBoundary` tells it through `commitNews`. `commit-told.ts` needed no change.
2. **No wait when there is nothing to wait for.** No `HEAD` move: no request, so no wait. These end the wait at once: no daemon recorded, no answer to `sync` within the socket bound (100 ms), an error answer (for example "this daemon cannot sync"), a pass that ended before the first answer, or a `sync-status` answer that is not a pending `sync` (the daemon forgot the id or was replaced). A `sync-status` ask with no answer is asked again while the wait lasts. Each ask's socket timeout is the smaller of 100 ms and what is left of the wait, so the wait cannot pass 500 ms by much.
3. **Signature.** `syncOnHeadMove(store, worktreeId, root, bounds?)`: the fourth parameter was `timeoutMs`; it is now `{ socketMs?, waitMs? }`. The only callers are `deliver` (defaults) and `test/commit/boundary.test.ts`. `HEAD_MOVE_WAIT_MS` is exported from `boundary.ts`, not from `src/core/commit/index.ts`, which is 019-28's.

## Harness budgets

`deliver` is shared by Claude Code's PostToolBatch, Codex's PostToolUse, OpenCode's bridge turn and Pi's session. Claude Code and Codex hooks time out at 2 s (`plugins/*/hooks/hooks.json`). OpenCode (`EVENT_DEADLINE_MS`) and Pi (`EVENT_DEADLINE_MS`) give an event 2 s. The 500 ms wait fits all four.

## Measured

`test/commit/boundary-daemon.test.ts`, three direct runs at load 15: the boundary after `git commit` took 125.6, 249.2 and 148.7 ms with the pass, and the boundary with no move took 4.1, 3.2 and 4.8 ms. Under heavier load the pass can pass 500 ms. Then the line comes at a later boundary, as before this row, and the test fails on `reported()`.

## Checks

- Red first: `test/commit/boundary-daemon.test.ts` failed on the old code at `expect(reported()).toBe(sha)`. The boundary returned before the pass stored the report.
- `test/commit/boundary.test.ts`, fake daemon socket: the wait polls until the pass ends; it stops at 500 ms when the pass does not end; it does not wait when the pass ended at once, the daemon refuses, or the daemon forgot the id; a PostToolBatch after a commit waits; the next one, with the `HEAD` reported, sends no request.
- The latency tests (`test/harness/*latency.test.ts`) run the committed bundles, which do not yet hold this change. Their fixtures have no `HEAD` move, so the new code takes the old path: `headMovedSinceLook` is false and nothing is asked.

## Checks expected to fail until the build

The build is not this row's. These fail on drift only, because `deliver.ts` and `boundary.ts` are bundled: `test/harness/plugin.test.ts` "bundles are committed exactly as `npm run build` produces them", and the Codex, Pi and OpenCode package tests that compare bundles.

## Known limits, not in this row

- A pass slower than 500 ms (a large repository, a pass behind an edit's revision, high load) still delivers the line at the next boundary. If the commit was the last tool call, the agent is not told. Option (b) of P2 (Stop tells an untold commit line once) would cover that case.
- If a pass fails after the daemon's in-memory `looked` moved but before it stored `seen`, the store's `seen` keeps differing from `HEAD`. Then each edited boundary asks for a pass again, as before this row, and now waits up to the pass's end each time.
