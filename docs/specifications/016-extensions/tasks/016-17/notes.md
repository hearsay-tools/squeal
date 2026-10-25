# 016-17 one write path for observed paths: notes

Worker aa7eeb16, 2026-10-25. Brief: `tasks/wave-2.md`, section 016-17. Spec D4 with the human's three decisions of 2026-10-25. Code read at `0d1180b87`.

## Seam map (read before the first edit)

| Part | Today | File |
| --- | --- | --- |
| Core merge | `observedGrowth` drops git-ignored paths, merges other worktrees' sets, hashes into the stat cache, marks `firstSeen`; gated by `keys.observing` (policy `observe.runtimeInputs`) | `src/core/scheduler/observed.ts:41` |
| Core store | `ObservedSets`, meta `observed.<project>`, map test path to paths, merge, never prune | `src/core/keys/observed.ts` |
| Core write | `keys.addObserved(file, growth.add)` under the lock | `src/core/scheduler/record-tier.ts:152` |
| Core read | `setClosure` adds the set while the policy holds | `src/core/scheduler/keying.ts:371` |
| Start-up paths | `environmentObserved` drives `rekeyEnvironments`; the core keeps no set | `src/core/scheduler/environment-growth.ts:28` |
| Preload heal | `unresolvedPreloads` reads `nodeTest.observedPreloads.<p>` only | `src/core/scheduler/growth.ts:18` |
| Poll | node:test keys only, every 5 s, a runner-only refinement (`queueObserved`) | `src/core/daemon/lifecycle.ts:346`, `src/core/scheduler/runner-work.ts:121` |
| Direct | `affected().direct` becomes the refinement's `direct` set and the edit cut's input | `src/core/scheduler/refinement.ts:162`, `edit-cut.ts:75`, `:192` |
| node:test store | `observedStore`, keys `nodeTest.observed.*`, `nodeTest.observedPreloads.*` | `src/core/daemon/node-test-runners.ts:30` |
| pytest store | `pytestObservedStore`, keys `pytest.observed.*`, `pytest.observedSession.*` | `src/core/daemon/pytest-runners.ts:32` |
| node:test tracker | `Observed`: `refresh`, `of`, `preloads`, `takeGrown`, `takeRecreate`, `record` | `src/runners/node-test/adapter-observed.ts`, used in `adapter-project.ts:64-180` |
| pytest tracker | as node:test, plus `outside`, `recordSession`, `recordSpawned` | `src/runners/pytest/adapter-observed.ts`, used in `adapter.ts:166-336` |
| Writes | Vitest's recorder records `w` (open that creates or truncates, `mkdir`, `rm`, `rmdir`, `unlink`, `rename`, ...); `mkdtemp` is not wrapped. node:test's module recorder and pytest's import hooks record no writes | `src/runners/observe/fs.cjs:200-225`; `src/runners/node-test/runtime/recorder.cjs`; `src/runners/pytest/runtime/*.py` |
| Versions | `NODE_TEST_ADAPTER_VERSION` "9", `PYTEST_ADAPTER_VERSION` "3", `RECORDER_VERSION` "3" (enters Vitest's adapter version as `+observe.3`) | `src/runners/{node-test,pytest}/version.ts`, `src/runners/observe/runtime.ts:13` |

A new optional `RunnerEnvironment` field enters no environment hash: `environmentHash` lists its inputs (`src/core/keys/environment.ts:72`).

## Commit plan

Sent to the coordinator as a request before any product code; the answer is recorded below.

## Decisions
