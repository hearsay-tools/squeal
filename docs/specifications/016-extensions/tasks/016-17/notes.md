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

Sent to the coordinator as a request before any product code (2026-10-25), approved with five answers. C1 the core form; C2 the core path; C3 the recorder records `mkdtemp`; C3b `RECORDER_VERSION` 3 to 4; C4 node:test and C5 pytest onto the core path, each with its version raise; C6 the validity cases; a last commit, after the rebase onto 016-21, deletes both stores, both types and the packs' `observed:` lines.

## Decisions

| # | Question | Answer (who, 2026-10-25) |
| --- | --- | --- |
| Q1 | Files beyond the brief's list | Approved: `src/core/types/runner.ts`, `src/core/keys/observed.ts`, `src/core/keys/startup.ts` (new), `record-tier.ts`, `refinement.ts`, `edit-cut.ts`, `growth.ts`, `environment-growth.ts` (2 lines, approved later), `src/core/daemon/lifecycle.ts`, `src/runners/observe/fs.cjs`, the trackers' callers and graph methods (coordinator; 011's coordinator told) |
| Q2 | `RECORDER_VERSION` | Raised, in its own commit (the human) |
| Q3 | node:test and pytest record no writes | (a): both runtimes record directory creates and removes and report `written` (coordinator) |
| Q4 | Adapter-suite cases that assert the injected store | Moved to core-level tests of the same claim, each listed below (the human) |
| Q5 | `direct` for node:test | node:test fills it too, its edges split by process; two lines to the coordinator before that part (coordinator) |
| Q6 | The older daemon | No read, write or delete of the four old keys; safe because of both raises (coordinator) |
| Q7 | Stored direct marks in the edit cut | They count among the K shortest of the other direct importers, never as a bare source's fallback; the 011 C4 sentence is the coordinator's at integration (011's coordinator) |

## The direct marks in the edit cut (Q7), measured

Store copies under `/tmp`, taken 2026-10-25 10:43Z, read only, deleted after the count (`count.mjs`: for each observed meta key, how many test files hold each path). cezar: no pytest keys; the node:test observed sets (every module load, an upper bound on the child imports) hold one path for at most 6 test files (`test:package`, `packages/cezar/dist/agent-config/*.js`, of 9 files) and at most 2 in `test:unit` and `root:test:unit`. Neither current `nodeTest` entry is slow, so their children are not recorded. squeal: no node:test or pytest project. One revision moves at most 6 files on cezar before the cap and 0 on squeal; with the cap at most K as edits.

## Residuals

- **A rolled-back record's start-up write.** `rekeyEnvironments` adds a run's start-up paths to the keys' view before the environments are read again (`seeStartup`); the record's transaction stores them (`writeStartup`). When that transaction rolls back, this daemon keys the paths while the store lacks them, until its next record, which writes what the view holds and the store lacks. An over-key in this daemon only (coordinator and 011's coordinator, accepted). Test: `test/scheduler/one-write-path.test.ts`, "keys a start-up path the record's rolled-back transaction did not store, and stores it next".

## Assertion changes

| Test | Before | After | Why |
| --- | --- | --- | --- |
| `test/scheduler/observed-inputs.test.ts:64` | each file runs once at the start; `ignored/build.txt` is not in the closure ("a blind spot") | the run that first hashed `ignored/build.txt` runs again (001-134); the path is in the closure | D4's written-directory bound keeps a git-ignored path the run wrote no ancestor of (the human, O1) |

## Moved cases (Q4)

Listed as C4 and C5 move them: old `file:line`, new `file:line`.
