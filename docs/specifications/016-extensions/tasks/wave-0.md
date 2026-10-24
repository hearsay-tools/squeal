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

## Review of candidate `cand/016-12`

Use /reviewer. Candidate `cand/016-12`, pinned to the SHA named in the spawn. The range is `origin/main..<SHA>`: row 016-12's four test commits (the kit) and one docs commit (011 C14 amended for D2). No bundle changes and no version raise. Write `docs/specifications/016-extensions/reviews/016-12.md` and commit it on your branch.

Read `spec.md` goals 1, 2 and 8, D1 and D2; the 016-12 brief above; `research/runner-kit.md` findings 2 and 3.

Check, with proof where you can:
1. **The kit fails when it should.** Break one adapter at a time in a scratch copy (for example, pytest reading a reused `logDir`, or node:test `invalidate` dropping an edit) and show the matching kit file fails. A kit that passes against a broken adapter is a blocker.
2. **Verdicts.** KNOWN passes and UNEXPECTED PASS fails, through the real driver; the "names no runner" test can fail.
3. **Goal 8.** The `squeal.config.json` inputs: an edit in one runner's folder re-runs that runner's kit file only, and no runtime file a kit file loads is missing (a missing input is a stale pass).
4. **D2.** The `logDir` comment and the C14 text agree with D2.
5. **Flake risk** on CI: the pytest kit's uv-managed Pythons and fixture sync; the version-sensitive entry.

Run the independent full suite under the host lock: `flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4`, and paste the result. Name each failing file and whether it changed in the range. Label every finding as proven, plausible or unverified. Only a proven break blocks. Verdict: PASS or FAIL.
