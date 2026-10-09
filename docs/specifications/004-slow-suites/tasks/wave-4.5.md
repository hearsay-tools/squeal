# 004 wave 4.5 briefs: the wave-4 review's blockers

Read `reviews/wave-4.md` (FAIL at `96cb807`, product `21cd841`) first: each blocker has its probe and a one-worker fix. Common rules: test first, the review's probe as a failing test at `21cd841` on Node 22 and 24; do not run `npm run build`; scratch in one `/tmp` directory of your own, removed; no CPU burners; never delete or kill what you did not start; re-run a failing file alone before calling it yours.

## 004-37 a parallel slow tier: each file its own artifact and its own start (B1, B2, S2)

Outcome: each file of a multi-file slow tier is recorded with its own declared artifact, a node:test slow tier runs exactly its tier's width, and no slow file starts after an edit arrived or the scheduler closed.

Seams: B1 in `src/core/scheduler/slow-tier.ts` (capture artifact globs per selected file before execution; record each file's keys with its own globs). B2: slow node:test concurrency follows the slow tier's width, independent of `runner.tierSize` (the runner's concurrency for a run, in `src/runners/node-test/run/` and the options the daemon passes, `src/core/daemon/daemon.ts`'s runner setup); never hand a slow adapter more files than it starts together, or return unstarted ones to the scheduler before they start after an edit or close; files already started finish (D4). S2: `test/daemon/drain.test.ts` gains a consumer held in a turn with two or more queued, unstarted slow files, then SessionEnd: they start and store before exit; and a SessionStart plus first edit before the second file starts.

Owns: `src/core/scheduler/slow-tier.ts`, `src/runners/node-test/run/**` (concurrency only), the slow runner wiring in `src/core/daemon/daemon.ts`, `src/core/daemon/slow-instance.ts`, their tests, `test/daemon/drain.test.ts`. Leave alone: `src/core/keys/**` (004-38), `src/core/state/**` (004-39).

Done when: B1, B2 and S2 as tests on both Nodes (a real adapter or daemon for B2, with unequal `maxParallel` and `tierSize`, start markers, an edit and a drain bound); lint, typecheck, full suite on Node 24 and 22.

Use /worker.

## 004-38 a symlinked ignored build directory enters the key (B3)

Outcome: a declared artifact reached through a symlinked directory (`dist -> real-build`, both ignored) is hashed and watched under its declared paths, so two worktrees with different builds never share a slow key.

Seam: `src/core/keys/ignored-inputs.ts` (git lists the link, never its contents) and its use in `src/core/scheduler/keying.ts`: expand declared globs through symlinked project directories within the worktree, with the watcher's loop and outside-repository limits; exclude `node_modules`. If the watcher must learn the new paths beyond the existing extras path, stop and ask me first (001-159 is in the watcher).

Owns: `src/core/keys/ignored-inputs.ts`, its use in `src/core/scheduler/keying.ts`, their tests. Done when: the review's two-worktree differing-build probe and an artifact edit are tests on both Nodes; lint, typecheck, full suite.

Use /worker.

## 004-39 a real source addition at revision 1 counts (B4)

Outcome: "sources changed since" is suppressed only for a worktree's initial listing, never for a genuine source file added at its first watch revision.

Seam: `src/core/state/slow.ts:221`: decide by the revision's actual provenance (the start scan against a watch batch; see how revisions record their trigger) rather than revision number and hash shape. Keep 004-31's slow-test and fixture exclusions.

Owns: `src/core/state/slow.ts`, `test/status/slow-tier.test.ts`. Done when: paired tests (a genuine add-only first watch revision after a revision-0 run; the initial listing) on both Nodes; lint, typecheck, the status tests.

Use /worker.

## 004-40 re-review of wave 4.5

Outcome: `reviews/wave-4.5.md`: are `reviews/wave-4.md` B1 to B4 and S2 closed, and nothing around them broken. Range pinned at dispatch. Rules as for 004-14. Second and last round on this slice: a remaining blocker goes to the human.

Use /reviewer.
