# Wave 25 of spec 011

Four rows on disjoint files, dispatched by coordinator 04a258b0 on 2026-10-23 from main after 0.1.278. W1, W2 and W4 come from the human's load decisions of 2026-10-23 (`research/edit-load.md`, `research/stored-nothing.md`); W3 is the follow-up the human asked for when releasing 0.1.277 over `reviews/0.1.277-r2.md` B1. Focused checks R2 (011-145) waits for W1: both edit tier selection.

## W1: 011-153, catch-up of an edit waits for 120 s of quiet

Use /worker. Shape: slice.

Outcome: catch-up of an edit starts no tier until 120 s pass with no revision that queues a test file of its lane, whether or not a tier was cancelled.

Read board row 011-153; 011 C4 step 5 as amended 2026-10-23 (the sentence after "A lane whose runner cannot cancel"); `research/stored-nothing.md` finding 4; `tasks/011-82/design.md`.

Seam: `src/core/scheduler/quiet.ts` (`BacklogQuiet`, `BACKLOG_QUIET_MS`, `quietQueued`) and the gate in `selectTier` (`src/core/scheduler/tiers.ts:237`), which today holds every backlog tier only after a cancel. A lead: a second wait in `BacklogQuiet` that each queuing revision starts or restarts, `CATCHUP_QUIET_MS` 120 s, read by the gate for entries queued as catch-up (`ledger.queue.isCatchUp`). Status already names a lane's wait and `quietUntil` (`src/core/status/standing*.ts`, `next-step.ts`): make it name this one too.

Owns `src/core/scheduler/{quiet,tiers,revision,refinement}.ts`, `src/core/status/{standing,standing-groups,next-step}.ts` where the wait is named, their tests; also fix the stale `SchedulerOptions.busySliceMs` comment in `src/core/scheduler/options.ts` (since 011-132 slice 4 it slices only when `busyWaits` is set). Not yours: `src/core/scheduler/bootstrap.ts` (W2), `src/harness/`, `src/core/daemon/` (W3), the board, spec text, bundles, version. No `npm run build`.

Done when the row's done-when holds; the 011-82 tests pass unchanged; lint, typecheck and `squeal run --all --wait` pass (bundle drift excepted). Run every test command with `env -u PLUGIN_ROOT -u PLUGIN_DATA`. Draft any spec sentence in `tasks/011-153/notes.md`. Paste the output in your summary.

## W2: 011-154, a new worktree's misses take their duration from the file's newest stored result

Use /worker. Shape: slice.

Outcome: a new worktree's first backlog tiers stay within the 120 s budget because its misses carry the durations the store already holds.

Read board row 011-154; 011 C4 step 5 (the backlog budget); `research/stored-nothing.md` finding 2.

Seam: `src/core/scheduler/bootstrap.ts:181`, `if (previous === null) continue;`. A lead: give such a miss `durationOf(newestResults(store, file.ref))`, the helper at `:260` that the no-result case already uses, then measure what it costs at a start with about 900 misses (it queries every check of each file).

Owns `src/core/scheduler/bootstrap.ts`, a store read in `src/core/store/repos/` if one is needed, their tests, `tasks/011-154/`. Not yours: `quiet.ts`, `tiers.ts` (W1), the board, spec text, bundles, version. No `npm run build`.

Done when the row's done-when holds with a test over a real store; the start cost is measured and stated; lint, typecheck and `squeal run --all --wait` pass (bundle drift excepted). Run every test command with `env -u PLUGIN_ROOT -u PLUGIN_DATA`. Paste the output in your summary.

## W3: 011-151, a hook's step-down and stop reach only the incarnation its decision read

Use /worker. Shape: slice, with one decision request.

Outcome: no hook asks a short successor to step down or stops it, whatever registers between a hook's handoff decision and its socket connect.

Read board row 011-151; `reviews/0.1.277-r2.md` B1 (its probe and its one-worker fix); `reviews/0.1.277.md`; `tasks/011-140/notes.md`; 011 C9 as amended 2026-10-23 (the exception).

Seam: `handOver` and `requestStepDown` in `src/harness/shared/ensure.ts` (snapshot `:153`, request `:157`, `:255`, `stop` `:263`), `requestDaemon` in `src/core/daemon/client.ts`, the step-down handler in `src/core/daemon/handlers.ts:295`. The guard must hold for supported older daemons, which know no mark. Before building, send me the mechanism you choose and what an older daemon does with it, as a request; build after the reply.

Owns `src/harness/shared/ensure.ts`, `src/core/daemon/{client,handlers}.ts`, their tests, `tasks/011-151/`. Not yours: `src/core/scheduler/` (W1, W2), `src/cli/start.ts` unless the decision reply names it, the board, spec text, bundles, version. No `npm run build`.

Done when the row's done-when holds, including both deterministic regressions the review names; the 011-140 tests pass; lint, typecheck and `squeal run --all --wait` pass (bundle drift excepted). Run every test command with `env -u PLUGIN_ROOT -u PLUGIN_DATA`. Draft the C9 sentence that replaces the exception in `tasks/011-151/notes.md`. Paste the output in your summary.

## W4: 011-155, the host-load measurement counts a result stored when its run stored it

Use /worker. Shape: slice (probes only).

Outcome: the daily host-load runbook reports "stored nothing" without the results the prune deleted with their worktree.

Read board rows 011-155 and 011-114; `research/stored-nothing.md` finding 1 and `probes/stored-nothing/pruned.mjs`, `fate.mjs`; `research/probes/host-load/README.md`.

Seam: `docs/specifications/011-core/research/probes/host-load/waste.mjs`. Probes read store copies only: copy a store with its `-wal` and `-shm` first; never open a live store or socket. Never run a script under `evals/bin/` or `tasks/*/probe/`.

Owns `docs/specifications/011-core/research/probes/host-load/` only. Not yours: product code, the board, spec text.

Done when the row's done-when holds: one run on store copies reproduces 011-148's split within 1%, and the README says how. Paste the output in your summary.
