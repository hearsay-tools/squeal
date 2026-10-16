# Wave 16 (2026-10-16)

One row, reported as hearsay-tools/squeal#2: a tool that deletes a worktree per worker keeps failing because that worktree's daemon and its Vitest children still hold the directory. Leave `docs/board.md`, `docs/specifications/*/status.md`, key pins, `package.json` versions and `plugins/*/dist` to the coordinator. Verify with `npm run lint`, `npm run typecheck` and `squeal run --all --wait`, and paste its output. Do not run `npm run build` in your tree.

## W1: 001-367, `squeal stop` cancels the tier and returns once nothing of Squeal's is left

Use /worker. Shape: slice. Read the board row, issue #2 (`gh issue view 2`), and spec 001's D10 (the `squeal stop` sentences and the exception after "A tier in flight finishes", both amended today) and D12.

Outcome: `squeal stop [root]` exits 0 only once the daemon and every process it started are gone, even mid-batch, and 1 past its bound, naming what is left. A daemon that accepted a stop starts no tier, the departure's slow drain included.

Seams:
- `src/cli/stop.ts` (the 60 s wait that reports "finishing the tier in flight" and exits 0).
- `onStop` in `src/core/daemon/daemon.ts:540`, and `#shutdown`'s `loop.close()`, which waits for the tier.
- The tier stop a timeout uses, and D12's children (`src/core/daemon/escaped.ts`, `terminate.ts`).

Lead: give `loop.close` a cancel mode that only the stop request uses. The superseded, sessions-gone and reinstall exits keep letting the tier finish.

Owns: those files, `README.md` (name `squeal stop <worktree>` as the step before deleting a worktree), and new tests. Leave `src/cli/remove.ts` alone unless it breaks.

Done when:
- A real-daemon test stops a daemon mid-batch, with a test that sleeps and spawns a child. Stop returns within a few seconds, and afterwards no process has its cwd or an open fd under the root (`/proc/*/cwd`, `/proc/*/fd`).
- A test shows that a stop during the departure drain starts no slow file.
- A test shows that a daemon left alive past the bound makes stop exit 1 and name it.
