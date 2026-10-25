# Wave 36

From cand/0.1.304b `776c6832e` (011-196 and 011-199, in review), 2026-10-25, on the human's go for both rows. One worker, two rows in order: 011-198's third round builds a record of delivered passes, and 011-200 reads it. They cross in that record, so they do not run in parallel. They ship together in the release after 0.1.304, unless 011-200 is late; then 011-198 ships alone. Row 011-195, the model-based test, follows in wave 37.

## W1: 011-198 then 011-200, the change feed records each pass it delivered

Use /worker. Shape: repair, then slice. Rows 011-198 and 011-200 in `docs/board.md`.

Outcome: `run --all` plans a checkpoint only after a reconciliation pass that started after the request was delivered, and status says when the last delivered pass is late.

Read both rows; `tasks/011-197/findings.md`; reviews `reviews/0.1.304.md` and `reviews/0.1.304-r2.md` (B1's two paths); the earlier rounds on `origin/cand/0.1.304` (`f049340cb`, `c51cc53c4`, the test `test/scheduler/full-suite-pass.test.ts`) as reference, not as a base; spec 011 C2's reconciliation paragraph (`spec.md:84`), C4's explicit checkpoints (`spec.md:156`), C6, C8's header (`spec.md:182`), C7.

011-198, the single owner the human chose: the change feed records each pass it delivered, with the time that pass started, at the one place a batch is stored (`reconcileNow`, `src/core/watcher/change-feed.ts:258`, beside `passHead`). `requestFullSuite` (`src/core/scheduler/scheduler.ts:544`) notes the time, awaits a pass, and plans only when a pass that started after that time was delivered; otherwise it rejects, and `run --all` gives no verdict (exit 3; `src/cli/run.ts:118`). No per-path outcome tracking: a failed, closed or retried pass is a pass that was not delivered. Port both B1 paths as tests; each fails on `origin/cand/0.1.304`'s first round or on `6df494769`.

011-200, as the human approved: when the last delivered pass is older than twice the idle interval (60 s), `status`, Stop's wait and the hook headers say so, for example "edits since 01:03:50 may not be seen yet; results current as of revision 23". When the feed is on time, the output does not change. Status reads the store with no daemon, so the daemon stores the time. C7: no column on an existing table under an unchanged `user_version`; use a new table or a meta row. Write it at most once per pass, never per batch of the watcher.

Owns `src/core/watcher/change-feed.ts`, `src/core/types/watcher.ts`, `requestFullSuite` and its option in `scheduler.ts`, `src/core/daemon-loop/index.ts`, `#requestFullSuite` in `daemon.ts`, the store and output code that 011-200 needs (send one request naming the files before you edit them), new tests. Not yours: `src/core/scheduler/{ledger,tiers,queue}.ts`, `src/core/code/` (spec 015), the board, spec text, `status.md`, bundles, version. No `npm run build`.

Land each row as its own commits, 011-198 first, so it can ship alone. Done when both rows' done-when hold; say how long `run --all` waits on a pass in the fixture and on this repository; lint, typecheck and `squeal run --all --wait` pass (bundle drift excepted). Run every test command with `env -u PLUGIN_ROOT -u PLUGIN_DATA`. Paste the output.

## W2: 011-202, `recordTier`'s record transaction under complexity 20

Use /worker. Shape: slice. Row 011-202 in `docs/board.md`. Added 2026-10-25 on main `f1531664f` (0.1.304), on a seam that W1 does not touch.

Outcome: no function of `recordTier` is over complexity 20, with no behaviour change.

Read the row; `status.md`'s 011-193 and 011-196 lines; spec 011 C15 Lifetime; `test/scheduler/promotion-cut.test.ts`, `first-observation.test.ts`, `queue-promotion.test.ts` (the orders that 011-193 and 011-196 fixed).

Seam: the transaction inside `ledger.queue.settlingOnce` in `recordTier` (`src/core/scheduler/tiers.ts:699`, CC 58). First edit, offered as a lead: move the loop body's branches into one function per outcome of `storeDecision`, over one record state object that holds the lists the loop fills.

Owns `recordTier` in `src/core/scheduler/tiers.ts`, a new `src/core/scheduler/record-tier.ts` if the functions need their own file. Not yours: `selectTier`, `queue.ts`, `ledger.ts` (spec 016's 0.1.306 changes `Ledger#write`), `src/core/watcher/`, `scheduler.ts`, `src/core/daemon-loop/` (W1), `src/core/code/` (spec 015), tests (no test changes), the board, spec text, `status.md`, bundles, version. No `npm run build`.

Done when the row's done-when holds; paste `squeal code src/core/scheduler/tiers.ts` for the `recordTier` lines before and after; lint, typecheck and `squeal run --all --wait` pass (bundle drift excepted). Run every test command with `env -u PLUGIN_ROOT -u PLUGIN_DATA`. Paste the output.
