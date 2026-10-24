# Wave 0: the kit's scaffold and the observed-path survey

Two rows, in parallel, on disjoint files.

## 016-12 the kit's scaffold

Use /worker. Shape: slice. Outcome: the kit of spec D1 exists, with its driver, three packs and K1 to K3, and passes on Vitest, node:test and pytest in Squeal's own suite.

Read: `spec.md` Goals 1, 2 and 8, D1 and D2; `research/runner-kit.md` findings 2 and 3; `research/probes/runner-kit/` (its `scenarios.ts`, `packs.ts` and `kit.ts` are the lead); `src/core/types/runner.ts`.

Starting seam: move the probe into `test/kit/` as `scenarios/`, `packs/` and `driver.ts`. First edit: `test/kit/vitest.test.ts` runs K1 through the driver. For pytest, use the Python environment that the pytest adapter tests already use (`test/runners/pytest/`).

Owns: `test/kit/**`; `squeal.config.json` `inputs` entries for `test/kit/**`; the `logDir` doc comment in `src/core/types/runner.ts` (D2, comment only).

Leave alone: `src/**` beyond that comment, `test/runners/**`, `test/keys/**`, the docs.

Done when:
- `test/kit/{vitest,node-test,pytest}.test.ts` pass, with K1 to K3 PASS on every runner;
- a driver test with a fake pack proves KNOWN, and proves UNEXPECTED PASS failing;
- a test shows `driver.ts` names no runner;
- `squeal run --all --wait` is green;
- the final message lists every runner precondition the packs needed.

## 016-13 the observed-path survey

Use /researcher. Shape: survey. Outcome: how observed paths flow today in each runner and in the core, every difference between the core's path and the injected stores, and how today's meta entries migrate, so that D4's slice can be briefed and the human can decide each difference. Follow `research/README.md`.

Read: `spec.md` D4 and goals 5 and 6; 011 C3, C4 and C12; board rows 007-47, 007-52 and 007-56; `docs/specifications/007-pytest-runner/tasks/007-55-notes.md`; `src/core/scheduler/observed.ts`; `src/core/daemon/{node-test,pytest}-runners.ts`; `src/runners/{node-test,pytest}/adapter-observed.ts`; `src/runners/vitest/observe.ts`; `src/runners/observe/`.

Questions:
1. Per runner: what is observed, per file and per project; where it is kept (meta, stored closures, memory); who reads it back, and when (`closure()`, `affected()`, `environment()`, after a restart, in another worktree).
2. Each step of the core's path (ignored paths, stat-cache hashing, `firstSeen`, link targets, listings, the merge lock). For each step the injected stores lack: a case where a verdict would change, checked by a small probe where cheap.
3. Does any node:test or pytest step drop git-ignored paths today, the recorder included? See 009 lessons observation 4.
4. What an adapter needs back, read-only, after the change (closure growth, 007-56's direct marks, start-up paths), and the narrowest interface that gives it.
5. Migration: how the `nodeTest.observed.*` and `pytest.observed.*` meta entries are read once into the core's form, and what an older daemon on the same store does after that.

Own `research/observed-paths.md` and `research/probes/observed-paths/`.
