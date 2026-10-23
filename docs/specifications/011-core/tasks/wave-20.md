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

## R1: review of cand/0.1.273

Use /reviewer. Shape: review. Pinned to `cand/0.1.273` at a1618a61f2b3992321e28e2aa2ae548bdbc36072. The range is `b911f082c..a1618a61f` (`origin/main` at b911f082c):
- W2's seven commits (006-98, worker 6077df44) and the 006 docs commit;
- W1's four (011-126, worker e8b08f00);
- W3's three (009-31, worker a6a03320);
- one docs commit (011 C7, the 011 and 009 `status.md` lines);
- the release commit (0.1.273, bundles).

Read `docs/specifications/011-core/tasks/wave-20.md` (W1 to W3; this R1 brief is on main, not in the candidate). Read the notes under `011-core/tasks/011-126/`, `006-model-evals/tasks/006-98/` and `009-pi-adapter/tasks/009-31/`, and board rows 011-126, 006-98 and 009-31. Read the amended 011 C7 and 006 D3 sentences and the three new `status.md` lines. The coordinator widened two rows:
- W1's to `ledger.ts` and `setup.ts` (request 7640bfa1);
- W2's to `stopOnSignal` calls in `judge-calibrate.mjs`, `regrade.mjs` and `run-baseline.mjs`, and to two optional fields in `evals/lib/index.d.mts` (requests f15f0a70, dd200ec4 and 5d9a129b).

Check:
- 011-126:
  - a record that gives up on a busy store keeps its prepared results and lands once. Its environment re-key and withhold count are not applied twice, and its files do not run again;
  - `Ledger.commit`'s put-back runs on a busy error only. A newer entry beats the drained one, and nothing is written twice;
  - the turn order of records and the pump cannot starve the pump or leave a record unlanded at the close;
  - a tier whose record waits keeps its lane, `idle()` and the close consistent;
  - the scheduler tests without `busySliceMs` keep the store's own timeout;
  - the writes the notes list as still at 5 s are the only ones.
- 006-98:
  - a judge call runs in a group that `killRunning` reaches, and a timeout ends the whole group;
  - `stopOnSignal`'s synchronous wait is bounded at 5 s, and exits 128 + n;
  - `run-cell.mjs` does not install it twice;
  - `run-baseline`'s cells still take a terminal's signal as before;
  - a refused ground truth writes no record;
  - `judge-isolation.test.ts` still holds.
- 009-31:
  - the minimal environment still exercises what a Pi session's worker does;
  - the fresh call must deliver;
  - the guard reads the load before and after the runs;
  - the bound is still 80 ms.
- the release:
  - `test/keys/key-format.test.ts` passes with `KEY_FORMAT_VERSION` unchanged;
  - the version is 0.1.273 in all eight places;
  - the bundles match the tree;
  - the four launchers are byte-identical.

Run `npm ci`, then run directly the test files W1 to W3 added or changed. Never run a script under `evals/bin/`, `tasks/011-122/probe/` or `tasks/009-31/probe/` yourself, `--help` included. The full suite is run twice: by CI on the candidate (run 39904823555) and by the coordinator's locked gate (`.ai/cezar/t/04a258b0/gate-w20.log`). A gate log names only failing files. Write `reviews/0.1.273.md` under `docs/specifications/011-core/`, with a PASS or FAIL verdict, and commit it alone.

## Wave 20.5: repair of review 0.1.273

Review `reviews/0.1.273.md` failed `cand/0.1.273` (a1618a61f) on one proven blocker, B1, in 011-126. W2 (006-98) and W3 (009-31) need no change. One repair, then one narrow re-review.

### W4: 011-126 B1, a busy record checks the current merge hold before it lands

Use /worker. Shape: repair. Resume of worker e8b08f00, on its own branch.

Outcome: a record that waits for a busy store stores nothing at a key the current merge hold names when it lands, and leaves that file queued until the hold ends, as C9 says.

Read `reviews/0.1.273.md` (B1, its regression body, N1 and "Inputs for the fix wave"); spec 011 C9, the unresolved-merge sentences.

Seam: `#prepare` and `#write` in `src/core/scheduler/scheduler.ts` (`:1047` to `:1128`). Keep prepared what must run once: the observations, the environment re-key and the counted withholds. Before each unwritten record's store decision, read the merge hold anew and apply its file and setup exclusions, without counting a withhold again and without a re-run because the store was busy.

Owns: `scheduler.ts`, `test/scheduler/busy-*.test.ts`, `tasks/011-126/notes.md`. Not yours: the result validity decoder, C9's text, `tiers.ts`, the board, bundles, version. No `npm run build`.

Done when:
- the review's regression is a test that fails at a1618a61f and passes now: the held key stays empty and queued after the free, and the hold's end starts the queued work;
- a setup exclusion case passes, if the repair changes that boundary;
- `busy-tier.test.ts`, `busy-edit.test.ts`, `busy-record.test.ts`, `busy-commit.test.ts` and the merge-hold and setup tests pass unchanged in their bounds;
- the notes' list of writes still at 5 s adds N1's two paths (`#hold.check()` in `#ended`, and `#recheckTiers`' `#adopt` and `#cutTiers`);
- lint, typecheck and `squeal run --all --wait` pass (bundle drift excepted), with their output in your summary.

### R2: re-review of the repaired candidate

Use /reviewer. Shape: review, narrow: B1 and the repair delta only, against `reviews/0.1.273.md`. Write `reviews/0.1.273-r2.md`.
