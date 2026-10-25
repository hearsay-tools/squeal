# Wave 35

From main after 0.1.302 and 011-197's findings, 2026-10-25. Three rows on disjoint seams: the full-suite checkpoint's plan (W1), the reconciliation pass's candidates (W2), and the record's re-run paths (W3). They ship together in one release. Spec 015 owns the coverage share of the main thread (`tasks/011-197/findings.md` recommendation 2). Row 011-195, the model-based test, follows in wave 36.

## W1: 011-198, `run --all` reconciles before it plans

Use /worker. Shape: repair. Row 011-198 in `docs/board.md`.

Outcome: a full-suite checkpoint never certifies a revision older than the worktree, however far the change feed lags.

Read the row; `docs/specifications/011-core/tasks/011-197/findings.md` (the timeline, recommendation 1); `Daemon#requestSync` (`src/core/daemon/daemon.ts:852`) and lessons defect 30; spec 011's reconciliation paragraph (`spec.md:84`) and C5 checkpoints.

Seam: `Scheduler.requestFullSuite` (`src/core/scheduler/scheduler.ts:544`). First edit, offered as a lead: a `beforeFullSuite` option that `createDaemonLoop` (`src/core/daemon-loop/index.ts`) wires to `feed.reconcile("interval")`, awaited before the lock.

Owns `src/core/scheduler/scheduler.ts` (`requestFullSuite` and its option), `src/core/daemon-loop/index.ts`, `src/core/daemon/daemon.ts` (`#requestFullSuite` only), `test/scheduler/daemon-loop.test.ts`. Not yours: `src/core/watcher/` (W2), `src/core/scheduler/tiers.ts`, `ledger.ts`, `environment-growth.ts` (W3), `src/core/code/` (spec 015), the board, spec text, `status.md`, bundles, version. No `npm run build`.

Done when the row's done-when holds; say how long `run --all` waits on a pass in the test fixture and on this repository; lint, typecheck and `squeal run --all --wait` pass (bundle drift excepted). Run every test command with `env -u PLUGIN_ROOT -u PLUGIN_DATA`. Paste the output.

## W2: 011-199, a pass checks the files committed since the last head

Use /worker. Shape: repair. Row 011-199 in `docs/board.md`.

Outcome: a file added and committed while its watcher event is still queued is found by the next reconciliation pass.

Read the row; `tasks/011-197/findings.md` (recommendation 3, the bench `added.ts` it describes); spec 011 C3 and the reconciliation paragraph (`spec.md:84`); `src/core/scheduler/head-move.ts`.

Seam: `candidatesForReconcile` (`src/core/watcher/candidates.ts`). First edit, offered as a lead: when `HEAD` moved since the last revision or `head-move` record, add `git diff --name-only <recorded head> HEAD` to the candidates.

Owns `src/core/watcher/{candidates,change-feed}.ts` and new tests under `test/watcher/`. Not yours: `src/core/scheduler/` and `src/core/daemon-loop/` (W1, W3), `src/core/code/` (spec 015), the board, spec text, `status.md`, bundles, version. If the recorded head is only in the scheduler, send one request with the interface you need before you edit there. No `npm run build`.

Done when the row's done-when holds; the cost of the extra `git diff` per pass is measured on this repository; lint, typecheck and `squeal run --all --wait` pass (bundle drift excepted). Run every test command with `env -u PLUGIN_ROOT -u PLUGIN_DATA`. Paste the output.

## W3: 011-196, a file that a record's re-run queues again keeps its promotion

Use /worker. Shape: repair. Row 011-196 in `docs/board.md`.

Outcome: a promoted file that `rerunGrown` or `rerunFirstSeen` queues again keeps its open wait's promotion through the record, as 011-193 made the cut, split, discard and not-started paths do.

Read the row; `status.md`'s 011-193 line; `test/scheduler/promotion-cut.test.ts`; spec 011 C15 Rank and Lifetime.

Seam: `recordTier` in `src/core/scheduler/tiers.ts` (the settles after its loop, `rerunGrown` at about `:809`, `ledger.rerunFirstSeen` at about `:816`). First edit, offered as a lead: keep those files' running marks until their re-run has queued them.

Owns `recordTier` in `src/core/scheduler/tiers.ts`, `src/core/scheduler/environment-growth.ts`, `Ledger.rerunFirstSeen` in `src/core/scheduler/ledger.ts`, `test/scheduler/promotion-cut.test.ts`. Not yours: the rest of `ledger.ts` (spec 016's 016-15 adds a line before `Ledger#write`'s setup sink), `scheduler.ts` (W1), `src/core/watcher/` (W2), the board, spec text, `status.md`, bundles, version. No `npm run build`.

Done when the row's done-when holds; lint, typecheck and `squeal run --all --wait` pass (bundle drift excepted). Run every test command with `env -u PLUGIN_ROOT -u PLUGIN_DATA`. Paste the output.
