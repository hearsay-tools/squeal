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
