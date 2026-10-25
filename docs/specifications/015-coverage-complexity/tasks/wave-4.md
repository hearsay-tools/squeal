# 015 wave 4: coverage leaves the daemon's main thread to the change feed

Briefed by coordinator 52e58f23 on 2026-10-25, from 011-197's findings (`docs/specifications/011-core/tasks/011-197/findings.md`, recommendation 2). Coverage is off in this repository until this row lands. 011's wave 35 (rows 011-198 and 011-199) fixes `run --all` and the change feed beside it.

## W1: 015-42

Use /worker. Shape: repair. Starts from main after 0.1.302. Outcome: with coverage on, an edit becomes a revision about as fast as with coverage off, while records are written and judged.
- Read 011-197's findings (Evidence, Recommendation 2, Not determined), `spec.md` D8 to D10, and the notes of 015-11, 015-12 and R6.
- **Writer.** The payload read, `JSON.parse` and `map` leave the main thread (`src/core/code/coverage/writer.ts`, `map.ts`). Lead: a `worker_threads` worker that returns the record.
- **Step.** Keep the loader map (`readLoaders`) until keys or results change, and count its read inside `STEP_BUDGET_MS` (`crap/step.ts`, `crap/loaders.ts`).
- **Pacing.** After a coverage step or writer job that took `d` ms on the main thread, the next one waits `setTimeout(d)`, not `setImmediate` (`code/pass/index.ts` `soon()` and the `more` chain, `writer.ts`).
- **The 01:09 to 01:27 load.** Find what kept the loop busy after the writer drained, with a `monitorEventLoopDelay` probe in a test, and fix it here.
- **Owns.** `src/core/code/coverage/**`, `src/core/code/crap/**`, `src/core/code/pass/index.ts`, and their tests. Leave `src/core/watcher/**` and `src/core/scheduler/**` alone (011's wave 35). Ask me before you edit `src/core/daemon/**`.
- **Done when.**
  - The findings' test, red first: a reconciliation pass over about 2,000 tracked files finishes within 3× its unloaded time while the writer stores payloads that take 200 ms or more each. Skip it when `LOADED`.
  - The loader map is read once while keys and results stay, and again after either changes.
  - A step's successor waits at least the step's own time (fake timers).
  - While a large payload is stored, the main thread's longest turn stays under 100 ms. Skip it when `LOADED`.
  - Records stay byte-identical. Ask me before you change one or `COVERAGE_PROVIDER_VERSION`.
  - `tasks/015-42/notes.md` gives the times before and after.
  - Lint, typecheck and `squeal run --all --wait` pass; paste the output. Do not build bundles or raise the version.

## 015-43: review of candidate 0.1.305 (015-42)

Use /reviewer. Candidate `cand/0.1.305`, pinned to the SHA named in the spawn. The range is `origin/main..<SHA>` at 0.1.302: 015-42's four commits (W1 above) and one build commit (bundles with the new `cli/coverage-map.mjs`, version 0.1.305; 0.1.303 and 0.1.304 are held by 016 and 011). Write `docs/specifications/015-coverage-complexity/reviews/0.1.305.md` and commit it on your branch.

Read `docs/specifications/011-core/tasks/011-197/findings.md`, `spec.md` D8 to D10 with their 2026-10-25 amendments, `status.md` (2026-10-25) and `tasks/015-42/notes.md`.

Check, with proof where you can:
1. **The main thread.** The bundled daemon finds `cli/coverage-map.mjs` and maps there. No coverage turn on the main thread runs long: payload maps, the first cold loader read, the sources sent to the worker. Pacing holds for `soon()`, the `more` chain, wakes, revisions and writer jobs.
2. **Correctness.** Records are byte-identical between the worker, the main-thread path and 0.1.302. The cache drops what results, records, a revision or a wake change, so no judgement reads a stale loader map, condition or signature. A failed worker loses no record. A worker that stops on an empty queue restarts on the next run.
3. **Coverage off** is unchanged: no worker, no extra pass.

Run the independent full suite under the host lock: `flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4`, and paste the result. Name each failing file and whether it changed in the range. Label every finding as proven, plausible or unverified. Only a proven break blocks. Verdict: PASS or FAIL.
