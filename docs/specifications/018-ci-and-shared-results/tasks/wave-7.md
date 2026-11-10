# Spec 018 wave 7: `squeal ci record` on Vitest 4

The human, 2026-11-10: "Squeal fix: Yes, both" (row 018-26, then a cezar PR that moves its pinned Squeal version), "Red step: A: leave it red".

## 018-26 `squeal ci record` works with Vitest 4

Use /worker. Shape: slice (fix).

Outcome: `squeal ci record` writes a part for a project on Vitest 4.1 as it does on Vitest 5, so cezar's merge queue publishes results.

Evidence: cezar merge-group run 42799552999 (hearsay-tools/cezarion), every shard: `squeal ci record: Vitest process N: could not record (vitest/node has no Logger.setVitest); no part`. cezar uses Vitest 4.1.10; Vitest 4.1's `vitest/node` exports no `Logger` (it exports `Vitest`, `createVitest`, `startVitest`). The daemon already runs Vitest 4.1.10 (rows 013-09, 013-10).

Read: `spec.md` D8; `src/runners/vitest/ci-runtime/vitest-ci.cjs` (the header and the `setVitest` wrap near line 167).

Starting seam: `vitest-ci.cjs`, the attach point. Find one hook point that both Vitest 4.1 and 5 call once per instance after its reporters exist (for example a `Vitest.prototype` method), keep Vitest 5's current behaviour, and fail as today (a `failed` file, never a thrown error) when neither exists.

Probe: a Vitest 4.1.10 install is at `/home/agent/projects/squeal/.ai/cezar/t/3739e45a/cezar-pr/node_modules/vitest` (read only). Copy a small fixture project to `$TMPDIR` and link that package; never write into that clone, never use the real HOME.

Owns: `src/runners/vitest/ci-runtime/vitest-ci.cjs`, a new test such as `test/runners/vitest/ci-record-vitest4.test.ts` and its fixture. Leave alone (row 018-23's repair is running): `descriptors.cjs`, `children.cjs`, `evidence*.cjs`, `test/runners/vitest/ci-evidence*`, `test/ci/export-wrapper.test.ts`, `src/cli/main.ts`, `spec.md`.

Done when: a test that runs `squeal ci record` around a Vitest 4.1 project (a stub `vitest/node` with Vitest 4.1's exports is acceptable in the repository; say if you also ran it on the real 4.1.10) writes a part with the run's outcomes, and failed before the fix; existing `ci record` tests pass; lint and typecheck pass; `squeal status --wait 60000` on the changed paths. No build, no full suite.
