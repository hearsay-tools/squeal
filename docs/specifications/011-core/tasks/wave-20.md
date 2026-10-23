# Wave 20 of spec 011

Three planned rows the coordinator chose on 2026-10-23 under the human's standing instruction ("If you are done with it before morning - grab the next piece yourself", 2026-10-22), from main with 0.1.272. The triage digest's rows (gh-64, gh-75 to gh-77) still wait for the human. W2 is spec 006's and W3 is spec 009's; this coordinator runs both. Their files are disjoint, so they run in parallel. `src/core/scheduler/tiers.ts` stays out of every row here (row 011-120). The candidate is 0.1.273 unless another lands first. No eval runs in this wave.

## W1: 011-126, the pump's writes on a busy store stop holding the event loop

Use /worker. Shape: slice.

Outcome: while another connection holds the store's write lock, a tier that records, its requeue and the next selection's lookup no longer hold the daemon's event loop for 5 s each, so pings, heartbeats and an edit's pass keep running. A result that a tier has already run is still stored after the lock frees, and that tier is not run again.

Read board row 011-126; `tasks/011-122/notes.md` ("With a tier in the hold", "For the next row"); spec 011 C7, the busy-store paragraph ("Past its start, the writes a daemon can retry wait 250 ms instead"); `reviews/0.1.272.md` N1.

Seam: `#record` and `#requeue` in `src/core/scheduler/scheduler.ts` (`:960`, `:1245`), the selection's lookup (`selectTier`'s last-use write), and `busy-resume.ts`. A lead: run these writes under `withBusySlice`, as `#handleBatch` already does (`:353`). Hold an ended run's results in memory, and retry its record through `BusyResume` instead of requeuing its files.

Owns: `scheduler.ts`, `busy-resume.ts`, their tests (`test/scheduler/busy-*.test.ts`), a new test beside `test/daemon/busy-edit.test.ts`, notes under `tasks/011-126/`. Not yours: `tiers.ts` (ask first if the record path needs it), `src/core/watcher/` (the pause), `evals/` (W2), `test/harness/pi/` (W3), the board, spec text, bundles, version. No `npm run build`. Before you run the 011-122 probe, fix N1 first: refuse a root that has Git metadata, and use a scratch HOME.

Done when:
- In a test where a tier records during a 12 s hold, no event-loop stall passes 1 s, and every ping is answered within 1 s.
- The tier's results are stored after the lock frees, with no re-run of its files.
- `busy-edit.test.ts` and `busy-record.test.ts` still pass.
- Lint, typecheck and `squeal run --all --wait` pass (bundle drift excepted). Put their output in your summary.

## W2: 006-98, a judge call running at the runner's termination ends with it

Use /worker. Shape: slice.

Outcome: when `run-cell` is terminated during a judge call, that call's process group is killed, and no judge process is alive when the runner exits.

Read board row 006-98; `006-model-evals/tasks/006-97/notes.md` ("Seen, not fixed"); spec 006 D3, the paragraph on a runner told to stop (amended 2026-10-23).

Seam: `claudeRunner` in `evals/lib/judge.mjs` (`:182`) spawns outside the groups that `killRunning` (`evals/lib/session.mjs`) tracks. A lead: let `runBounded` take the call's stdin, or export a way to track a child's group, so that `claudeRunner` runs its child in a group that `killRunning` reaches.

Owns: `evals/lib/judge.mjs`, `evals/lib/session.mjs`, `test/evals/judge-*.test.ts`, `kill-running.test.ts`, `run-cell.test.ts`, `fake-cell.ts`, notes under `006-model-evals/tasks/006-98/`. The two other "Seen, not fixed" items are in scope only if each is small; otherwise put them in the notes. Not yours: the rest of `evals/`, `src/`, the board, spec text, bundles, version. Run the test files only. Never run a script under `evals/bin/` yourself, `--help` included: it starts a real run.

Done when:
- A test with a fake judge terminates the runner during a judge call and shows that no judge process is alive at exit.
- The judge's scratch-HOME isolation (`judge-isolation.test.ts`) still holds.
- Lint, typecheck and `squeal run --all --wait` pass. Put their output in your summary.

## W3: 009-31, the Pi fresh-worker latency check fails only on a real cause

Use /worker. Shape: survey, then repair.

Outcome: the notes name the cause of the slow tail in "boundary on a fresh worker": the worker's start, the host, or the test's load guard. The test then asserts only what spec 009 promises, under the load it claims.

Read board row 009-31; spec 009 D4 (the 80 ms p95 from 002); `tasks/011-122/notes.md` ("Verification", the 80.9 ms miss); `reviews/0.1.272.md` (the 144.5 ms miss).

Seam: `test/harness/pi/latency.test.ts`: `calm()` (`:30`) reads the one-minute load once, after the runs; `COLD_RUNS` 10 makes the slowest run the p95; `createDeliveryHost` is in `src/harness/pi/host.ts`. A lead: time each fresh worker's start apart from its first call, beside a locked full suite, before any change.

Owns: `test/harness/pi/latency.test.ts` and its helpers, notes under `009-pi-adapter/tasks/009-31/`. A fix in `src/harness/pi/host.ts` only if it is small and the notes name the phase it removes. Not yours: the rest of `src/`, `evals/`, the board, spec text, bundles, version. No `npm run build`.

Done when:
- The notes give the phases and their times from at least 20 fresh workers beside a locked full suite.
- The test passes 20 of 20 beside a suite. If the bound must change, the notes propose the D4 sentence instead.
- Lint, typecheck and `squeal run --all --wait` pass (bundle drift excepted). Put their output in your summary.
