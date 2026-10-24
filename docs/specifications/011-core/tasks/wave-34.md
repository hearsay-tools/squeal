# Wave 34

From main `50f6ce4fa` after 0.1.301 (015's), 2026-10-25. Four rows on disjoint seams: pnpm's key readers (W1), the scheduler's promotions and yield clock (W2), the named selection and a forwarder (W3), and a daemon test's heartbeat bound (W4). They ship together in one release, 0.1.302 or the next free version. W2 and W3 both edit `src/core/scheduler/focused.ts`, in different functions (below). Row 011-195, the model-based test, is wave 35: its invariants need 011-193 and 011-194 on its base.

## W1: 011-190 with quality slice 5, pnpm's readers under complexity 20

Use /worker. Shape: slice. Row 011-190 in `docs/board.md`.

Outcome: `readPnpmLockfile` and `installedDependencies` are each under complexity 20, and pnpm's `parent` and virtual store are stated once, with no key change.

Read the row; `docs/specifications/011-core/quality/2026-10-25.md` slice 5; review `reviews/0.1.282.md` B1 (the `null` rules that stay).

Seam: `readPnpmLockfile` (`src/core/keys/pnpm-lockfile.ts:87`). First edit, offered as a lead: one function for each kind of line, over one reader state object.

Owns `src/core/keys/{environment,pnpm-lockfile,pnpm-install,pnpm-graph,packages}.ts` and the imports of their tests. Not yours: `src/core/scheduler/`, `src/cli/`, `test/daemon/`, the board, spec text, `status.md`, bundles, version. If the key-format alarm refuses a moved line that no case runs, stop that part and say which; it waits for 011-105's raise. No `npm run build`.

Done when the row's done-when holds; lint, typecheck and `squeal run --all --wait` pass (bundle drift excepted). Run every test command with `env -u PLUGIN_ROOT -u PLUGIN_DATA`. Paste the output.

## W2: 011-193 then 011-194, a cut keeps open promotions, and one clock reading decides a yield

Use /worker. Shape: repair. Rows 011-193 and 011-194 in `docs/board.md`.

Outcome: a tier's cut no longer drops an open wait's promotion, and one `TierYields.check` reads the clock once for every decision it makes.

Read both rows; `docs/specifications/016-extensions/research/model-scheduler.md` findings 2 and 3; the probe `016-extensions/research/probes/model-scheduler/model.probe.ts` and `results/directed.md` for the fixture and the two sequences. Port the sequences into tests; do not run `run.sh` or `replay.sh`. Spec 011 C15 Rank and Lifetime; review `reviews/0.1.296-r2.md` B2.

Seams: `RunQueue.add` (`src/core/scheduler/queue.ts:195`) for 011-193; lead: settle after the entry is in the queue. `TierYields.check` (`src/core/scheduler/yields.ts:151`) for 011-194; lead: read `at` once there and pass a context whose `now` returns it.

Land 011-193 and 011-194 as separate commits, each with its test, so either can land alone. The human may choose the plain repair for 011-194 (quality slice 2: a `now` parameter for `remainder`, `byRemainder` and `boundOf` only). If you find a reading that a frozen clock makes wrong, send one request before you go on.

Owns `src/core/scheduler/{queue,promotions,yields,claims}.ts`, `focusedWaiting` in `src/core/scheduler/focused.ts:53-64`, new tests under `test/scheduler/`, `tasks/011-194/`. Not yours: `focuses` and `mayFocus` in `focused.ts:22-33` (W3 removes the forwarder), `test/scheduler/backlog-slots.test.ts` (W3), `src/core/keys/`, `src/cli/`, the board, spec text, `status.md`, bundles, version. No `npm run build`.

Done when both rows' done-when hold; each new test fails on main and passes (say how you showed it); lint, typecheck and `squeal run --all --wait` pass (bundle drift excepted). Run every test command with `env -u PLUGIN_ROOT -u PLUGIN_DATA`. Paste the output.

## W3: 011-191, slices 3, 4 and 7

Use /worker. Shape: slice. Row 011-191 in `docs/board.md`.

Outcome: the `focuses` forwarder is gone, the named selection is its own module, and the backlog-slots test is named for what it asserts. No behaviour change.

Read the row; `docs/specifications/011-core/quality/2026-10-25.md` slices 3, 4 and 7.

Seam: `src/cli/status-wait-paths.ts:79-243`. First edit, offered as a lead: move that block to `src/cli/named-selection.ts` in one commit, then change the imports.

Owns `src/cli/{status-wait-paths,named-selection,status-paths,named-file-lines,main}.ts`, `focuses` and `mayFocus` in `src/core/scheduler/focused.ts:22-33`, and the one test name in `test/scheduler/backlog-slots.test.ts:72`. Not yours: the rest of `focused.ts` (W2 changes `focusedWaiting`), `src/core/scheduler/` otherwise, `src/core/keys/`, the board, spec text, `status.md`, bundles, version. No `npm run build`.

Done when the row's done-when holds; lint, typecheck and `squeal run --all --wait` pass (bundle drift excepted). Run every test command with `env -u PLUGIN_ROOT -u PLUGIN_DATA`. Paste the output.

## W4: 011-192, `busy-edit.test.ts:151` misses its heartbeat bound under load

Use /worker. Shape: slice. Row 011-192 in `docs/board.md`.

Outcome: the cause of the late first heartbeat after the lock frees is named, and the case passes beside load.

Read the row; `test/daemon/busy-edit.test.ts` (the header comment at `:22-35`, the case at `:81`); review `reviews/0.1.300.md` (the locked run's failure); row 011-122, the same file's revision bound, another cause.

Lead, not proven: the heartbeat runs on its own timer, so its first beat after the hold can come a full period later, while the revision is stored at once. Find the heartbeat's period and what the hold blocks. Forcing the order is allowed; making host load on purpose is not.

Owns `test/daemon/busy-edit.test.ts`, helpers under `test/daemon/` that only it uses, `tasks/011-192/`. A daemon fault in `src/` is in scope when its fix is small: send one request with the cause and the exact edit, then continue on the test-side default. Not yours: `src/core/scheduler/`, `src/core/keys/`, `src/cli/`, the board, spec text, `status.md`, bundles, version. No `npm run build`.

Done when the cause is named with evidence in `tasks/011-192/notes.md`; the case passes 20 runs in a row on this host (`env -u PLUGIN_ROOT -u PLUGIN_DATA npx vitest run test/daemon/busy-edit.test.ts`, the load average beside each); lint, typecheck and `squeal run --all --wait` pass. Run every test command with `env -u PLUGIN_ROOT -u PLUGIN_DATA`. Paste the output.
