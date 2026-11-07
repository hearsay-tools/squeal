# 015-111 notes: the split of `test/scheduler/helpers.ts`

Worker 573f10bc, 2026-11-07. Brief: `../wave-28.md`, section 015-111.

## Where the helpers went

| File | Holds | Runner adapters it loads |
|---|---|---|
| `test/scheduler/cleanup.ts` | `SLOW`, the cleanup and trace registries, the `afterEach` hook, `cleanUp`, `onCleanUp`, `keptByTrace`, `traceRepo` | none |
| `test/scheduler/repo.ts` | `ALL_TEST_FILES`, `ref`, `createRepo`, `addWorktree`, `openRepoStore` | none |
| `test/scheduler/recording-runner.ts` | `RecordedRun`, `FailingCall`, `RecordingRunner`, `recordingRunner` (types and the recorder only) | none |
| `test/scheduler/vitest-harness.ts` | `Harness`, `HarnessOptions`, `PartContext`, `openHarness` over a real Vitest adapter | Vitest |
| `test/scheduler/node-test-harness.ts` | `NodeTestHarnessOptions`, an `openHarness` that adds node:test adapters beside Vitest | Vitest, node:test |

`helpers.ts` is deleted; no file re-exports the old names.

Seams a later change must know:

- The `afterEach` hook lives in `cleanup.ts`. A test file loads it once, through `repo.ts` or a harness. A test file that imports only `recording-runner.ts` types registers no hook, and needs none.
- `HarnessOptions.nodeTest` and `nodeTestTierSize` moved to `NodeTestHarnessOptions`. The Vitest harness instead takes `parts(context)`, a builder of runner parts beside Vitest, called once with the harness's note and its current policy. `node-test-harness.ts` uses it; a later runner can too.
- Both harness files export `openHarness` under the same name, so an importer changed only its import line. A test that hands `nodeTest` to the harness must import the node:test one. **The type check does not catch the wrong one when the option comes through a spread** (`...(pkg ? { nodeTest: [PKG] } : {})`, `test/integration/touched-scope.test.ts`): the option is then dropped in silence. Verified by changing that import on purpose: `pnpm run typecheck` passed.
- `openHarness` was 28 in cyclomatic complexity, over the threshold of 20. The policy and the options handed straight to the scheduler are now `harnessPolicy` and `passedThrough`; `openHarness` is 13.

## Reach of the runner adapters

Measured by `runner-reach.mjs` (a static walk of value imports, as Vite's esbuild transform keeps them under `verbatimModuleSyntax`; 1,517 test files). "Through the helpers" counts the test files that reach a helper file from which the adapter is reachable.

| Adapter | Through the helpers, before | after | At all, before | after |
|---|---|---|---|---|
| `src/runners/vitest/adapter.ts` | 153 | 136 | 349 | 337 |
| `src/runners/node-test/adapter.ts` | 153 | 7 | 312 | 182 |

153 test files reach a helper file before and after. The 17 that no longer reach the Vitest adapter through the helpers use only `repo.ts` and `cleanup.ts`; 5 of them still reach it by another path (`test/code/pass/daemon-loop.test.ts`, `test/scheduler/daemon-loop.test.ts`, `feed-delivered.test.ts`, `full-suite-pass.test.ts`, `linked-start.test.ts`). The 136 open a harness over a real Vitest adapter, 8 of them through a fixture (`slots-fixture.ts`, `crash-rekey-fixture.ts`, `forced-requeue-fixture.ts`, `warm-up-repo.ts`). The 7 that reach node:test hand `nodeTest` to the harness: 5 test files directly, and `warm-up.test.ts` and `warm-up-in-flight.test.ts` through `warm-up-repo.ts`.

The new helper files import from defining modules. Their own unchanged neighbours (`phase-trace.ts`, `recording-sink.ts`, `quiet-clock.ts`, `store-wait.ts`) still import barrels; those lines are 015-110's.

## Re-running

```sh
node docs/specifications/015-coverage-complexity/tasks/015-111/runner-reach.mjs            # current tree
node docs/specifications/015-coverage-complexity/tasks/015-111/runner-reach.mjs <checkout>  # another one
node docs/specifications/015-coverage-complexity/tasks/015-111/rewrite-imports.mjs          # after a rebase that brings new importers of helpers.ts
pnpm exec biome check --write <the files it printed>
```

`rewrite-imports.mjs` maps each old name to its new file and sends `openHarness` to `node-test-harness.ts` when a line of the importer names `nodeTest:` or `nodeTestTierSize:` outside a policy. Biome then sorts the lines and turns all-type imports into `import type`.
