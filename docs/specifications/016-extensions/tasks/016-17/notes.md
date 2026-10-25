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

## Direct marks on closure paths (Q5, 2026-10-25)

The coordinator's answer to Q5: the core keeps a direct mark for every project path a process the test file started imported, its closure's paths too; only the written-directory bound drops one. A file whose run grew nothing has no `ObservedGrowth`, and routing it through one turns a re-keyed file's store into `no-key` (`storeDecision`), so the marks take the start-up paths' route (`ca004eaed`): `keys.markDirect` in the record's preparation (`observedGrowth`), `keys.writeSeen` in `endRecord`'s transaction, which stores what the view holds and the store lacks (`ObservedSets.writeMarks`). Tests: `test/scheduler/observed-direct.test.ts`, "marks a child's import its closure reaches only through another module" (catch-up runner) and "stores a node:test child's import of a closure path as a mark, beside no observed path" (real node:test); `test/keys/observed.test.ts`, the rolled-back `writeMarks`.

node:test's split by process (Q5): the recorder writes one file per process; the file whose edges reach the test file's entry is its own process, worker threads included; what each other file loaded from its own non-preload roots is `direct` (`src/runners/node-test/run/observed.ts`).

## Start-up growth from another worktree

node:test's adapter reported another worktree's preload growth as a recreated project (`takeRecreate`). The core now does it: a refinement that reads no environments joins the start-up paths other worktrees stored (`keys.regrowStartup`, `refinement.ts` apply). Test: `test/scheduler/preload-refresh.test.ts`, mutation-checked.

## Directory records: cost per call (Q3 (a))

node:test's recorder (`src/runners/node-test/runtime/recorder.cjs`) wraps `mkdir`, `mkdtemp`, `rm`, `rmdir` and `rename`, sync, callback and promise forms. A repeated absolute path costs one `Set` lookup; a new path one `path.resolve` and one `appendFileSync` of one line. Measured 2026-10-25, 200,000 calls of each, three rounds, the host at load 60 on 24 CPUs: `mkdirSync` of an existing directory 5.2 to 5.9 µs without the recorder and 5.2 to 6.0 µs with it; `rmSync` of a missing path 6.3 to 9.5 µs and 6.6 to 7.9 µs. No difference above the noise. Tests: `test/runners/node-test/recorder-written.test.ts`.

## Residuals

- **A rolled-back record's direct marks.** As the start-up paths below: `markDirect` adds to this daemon's view before the record's transaction, so a rolled-back write leaves the view ahead of the store until the next record writes it. An over-mark in this daemon only.
- **A rolled-back record's start-up write.** `rekeyEnvironments` adds a run's start-up paths to the keys' view before the environments are read again (`seeStartup`); the record's transaction stores them (`writeStartup`). When that transaction rolls back, this daemon keys the paths while the store lacks them, until its next record, which writes what the view holds and the store lacks. An over-key in this daemon only (coordinator and 011's coordinator, accepted). Test: `test/scheduler/one-write-path.test.ts`, "keys a start-up path the record's rolled-back transaction did not store, and stores it next".

## Assertion changes

| Test | Before | After | Why |
| --- | --- | --- | --- |
| `test/scheduler/observed-inputs.test.ts:64` | each file runs once at the start; `ignored/build.txt` is not in the closure ("a blind spot") | the run that first hashed `ignored/build.txt` runs again (001-134); the path is in the closure | D4's written-directory bound keeps a git-ignored path the run wrote no ancestor of (the human, O1) |
| `test/scheduler/observed-growth.test.ts:37` → `:39` | B inherits A's pass under a key lacking the observed path; a runner-only refinement re-keys and runs it | B never inherits A's pass: B runs its own copy, which fails; the refinement then runs nothing | the core stores A's pass under the key that holds the path, as it does a Vitest file's (D4) |
| `test/runners/node-test/adapter-attribution.test.ts` (all cases, e.g. `:145` → `:148`) | the adapter's `closure()`, `affected()` and `environment()` after a run hold what it loaded | the run's `observed` and `environmentObserved` hold it; a spawned child's loads are `direct`, a Worker's are not | the core assembles closures and environments (D4); the adapter keeps nothing |
| `test/runners/node-test/adapter-plugin-root.test.ts:98` → `:105` | the closure after a run holds the CLI's loads | the report holds them, `direct` too; keys alike under two roots as before | as above |
| `test/runners/node-test/run.test.ts`, `run-preload.test.ts`, `run-reads-fidelity.test.ts` | `ObservedClosure` of three fields | `direct: []` and `written: []` too; in `run-preload` the runner process's graph gives no `direct` | the closure gained the two fields (D4) |
| `test/daemon/observed-timer.test.ts:112` → `:116` | the timer asks on a change of `nodeTest.observed.*` and `nodeTest.observedPreloads.*` | on a change of `observed.*`, `observedStartup.*` and `observedDirect.*` | the old keys are never read (Q6) |
| `test/scheduler/preload-refresh.test.ts:27` | another worktree's growth written to `nodeTest.observedPreloads.*` | written to `observedStartup.*` | as above |

## Moved cases (Q4)

Listed as C4 and C5 move them: old `file:line` (at `ca004eaed`), new `file:line`.

| Old | Claim | New |
| --- | --- | --- |
| `test/runners/node-test/adapter-shared.test.ts:66` (file deleted) | a daemon running before another worktree observed a path learns it at its next revision, whatever changed, once, and then its edits of the path run the file | `test/scheduler/one-write-path.test.ts:107` |
| `test/runners/node-test/adapter-shared.test.ts:99` | a closure asked for before any revision holds what another worktree stored | `test/scheduler/observed-direct.test.ts:76` (B's keys hold A's paths: B inherits, no run); `test/keys/observed.test.ts:61` |
| `test/runners/node-test/adapter.test.ts:208` (deleted) | stored observations key the file before its first run | `test/scheduler/observed-direct.test.ts:58` (after a restart) |
| `test/runners/node-test/adapter.test.ts:173` (store part) | the run's write of what the graph missed, once | the report part stays at `adapter.test.ts:147`; the store: `test/scheduler/one-write-path.test.ts:41`, `test/keys/observed.test.ts` (a known path writes nothing) |
| `test/runners/node-test/graph-structural.test.ts:151` (deleted with `recordObserved`) | a path a run loaded outside the static closure makes the file affected | `test/scheduler/one-write-path.test.ts:41` and `:107` (an edit of the kept path runs the file) |
| `test/runners/node-test/adapter-preload.test.ts:63` (keying part) | a preload's run-time load enters the environment, makes every file affected and is read by another worktree from the start | `test/scheduler/one-write-path.test.ts:85` (stored, keyed after a restart, its edit runs the file); `test/scheduler/preload-refresh.test.ts:18` (another worktree's growth, no runner recreate); `test/scheduler/observed-growth.test.ts:201` (a second worktree keys with it and misses when its copy differs). The report part stays at `adapter-preload.test.ts:59` |
| `test/runners/node-test/adapter-preload-require.test.ts:105` (keying part) | the `--require` preload's helper is stored, keyed, affects the file and keys another worktree | as the row above; the report part stays at `:101` |
| `test/runners/node-test/adapter-preload-quoted.test.ts:80` (keying part) | as above, and a worktree whose helper differs keys its environment apart | as the row above; the report part stays at `:57` |
| `test/runners/node-test/adapter-loader.test.ts:185` | the helper beside an async loader reaches the preload key | the report's `environmentObserved`, `:178`; keying as above |
