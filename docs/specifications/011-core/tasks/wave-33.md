# Wave 33

From main `d0efe8dd4` after 0.1.298 (011-183), 2026-10-24. W1 and W2 run on disjoint seams (the change feed; the stop-cancel test) and ship together in one release; Q1 is the quality scan due after about ten landed rows.

## W1: 011-187, a change of the extra files alone reconciles too

Use /worker. Shape: slice. Row 011-187 in `docs/board.md`.

Outcome: a change of the extra files that replaces the watcher is followed by a reconciliation pass, so no edit in flight is lost there either.

Read the row; `docs/specifications/011-core/reviews/0.1.298.md` N1; `tasks/011-183/notes.md` (the swap, the probes, the cost); 011's reconciliation paragraph (`spec.md:84`).

Seam: `Feed.setExtraFiles` (`src/core/watcher/change-feed.ts:173`). The scheduler calls it from inside a batch (`onExtraFiles`, `src/core/daemon-loop/index.ts:76`). First edit, offered as a lead: reconcile when `rebuildSpec` returns true. Since 011-183, `rebuildSpec` returns true after every update. So first count how often `onExtraFiles` fires on this repository. If it fires per batch, make the answer exact for this caller (true when the backend replaced or widened its watch) rather than adding a pass per batch. Say which you chose and why.

Tests, red first on main: a case in `test/watcher/rewatch.test.ts` where `setExtraFiles`'s rebuild meets a new ignored directory and the edited file is still delivered.

Owns `src/core/watcher/change-feed.ts`, the comment at `src/core/watcher/chokidar-backend.ts:74`, `test/watcher/rewatch.test.ts`, `tasks/011-187/`. Not yours: the board, spec text, `status.md` (the coordinator drops the spec's exception), bundles, version, `src/core/scheduler/`, `test/daemon/stop-cancel.test.ts` (row 011-188 runs beside you). No `npm run build`.

Done when the new case fails on main and passes on yours (say how you showed it); the cost per pass and how often it runs are in the notes; lint, typecheck and `squeal run --all --wait` pass (bundle drift excepted). Run every test command with `env -u PLUGIN_ROOT -u PLUGIN_DATA`. Paste the output.

## W2: 011-188, `stop-cancel.test.ts:170` finds the holding test's child gone

Use /worker. Shape: slice. Row 011-188 in `docs/board.md`.

Outcome: `test/daemon/stop-cancel.test.ts`'s "returns within seconds mid-batch" case no longer finds the holding test's child gone right after it wrote its pid; the cause is named.

Read the row; main CI run 40130054900, job Node 22 (2/3) (`gh run view 40130054900 --log-failed`); `stop-cancel.test.ts` (`holdingTest` at `:46`, the case at `:159`); row 001-436, the same case's other failure at `:161` (a leftover daemon after stop), which is not this row.

Lead, not proven: the daemon cancelled and restarted the tier after the holding test wrote `started`, so the file named the first run's child. Find what can cancel a lone tier in this fixture: a revision, a re-plan, a yield, the host gate. Read the fixture's store and run logs from a reproduction. Forcing the order is allowed; making host load on purpose is not.

Owns `test/daemon/stop-cancel.test.ts`, helpers under `test/daemon/` that only it uses, `tasks/011-188/`. A daemon fault in `src/` is in scope when its fix is small: send one request with the cause and the exact edit, then continue on the test-side default. Not yours: `src/core/watcher/` and `test/watcher/` (row 011-187 runs beside you), the board, spec text, `status.md`, bundles, version. No `npm run build`.

Done when the cause is named with evidence in `tasks/011-188/notes.md`; the fix holds (a daemon fix comes with a test that fails without it); the case passes 20 runs in a row on this host (`env -u PLUGIN_ROOT -u PLUGIN_DATA npx vitest run test/daemon/stop-cancel.test.ts -t "mid-batch"`, the load average beside each); lint, typecheck and `squeal run --all --wait` pass. Run every test command with `env -u PLUGIN_ROOT -u PLUGIN_DATA`. Paste the output.

## Q1: 011-189, quality scan of 0.1.287 to 0.1.298

Use /quality. Row 011-189 in `docs/board.md`.

Scan spec 011's landed work from `squeal--v0.1.286` to `squeal--v0.1.298` against `docs/vision.md` and `docs/styleguide.md`. Leave spec 015's and spec 016's commits out (0.1.289, 0.1.290, 0.1.292, 0.1.293, 0.1.295 and 0.1.297 are 015's). 011's rows in the stretch:
- releases: 011-182 (0.1.294), 011-184 (0.1.296, three review rounds), 011-183 (0.1.298);
- tests only: 011-142, 011-178, 011-179;
- docs: 011-177, 011-180 (survey), 011-181 (research), 011-185, 011-186.
The previous scan is `docs/specifications/011-core/quality/2026-10-24.md` (0.1.273 to 0.1.286); do not repeat its candidates unless they changed.

Look in particular at:
- the deadline and rank logic split across `src/core/scheduler/yields.ts`, `promotions.ts` and `queue.ts` after 011-184's three rounds;
- the two copies of `sample-trees.py` (`research/probes/host-load/` and `011-181/`), and the probes under `tasks/*/probe/` that nothing runs any more;
- tests that a newer test supersedes but that still run;
- spec and `status.md` text that no longer says what the code does.

Write `docs/specifications/011-core/quality/2026-10-25.md` in the form of the previous scan: drop candidates, proposed rows, slices. Commit it. Never edit the board. Never run a script under `evals/bin/` or `tasks/*/probe/`.
