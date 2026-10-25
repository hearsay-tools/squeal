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
| Q6 (warm-up) | `test/cli/warmup.test.ts:136` fails since C2: the record holds no path for the Vitest file, whose closure keys its git-ignored read | (a): the fixture's readers become slow and fast node:test files, whose fs reads stay unkeyed, so the suggestion text stays true; the slow-wait case at `:180` is row 005-82, not this row's; the warm-up naming a Vitest file's scratch reads as unkeyed build output is row 005-85 (coordinator) |
| Q8 (warm-up) | On a slow Vitest file's first run the warm-up subtracts the closure from before the record, so it names a git-ignored read "unkeyed" that the same record keys (D4, O1): `squeal setup` on a fresh repository said so | (a): this row's regression, fixed in `WarmUp.read` (`src/core/scheduler/warm-up.ts`), which leaves out what the record keys through the bound `observedGrowth` uses (`scratchOf`, exported); 011 told (coordinator) |
| Q7 | Stored direct marks in the edit cut | They count among the K shortest of the other direct importers, never as a bare source's fallback; the 011 C4 sentence is the coordinator's at integration (011's coordinator) |

## The direct marks in the edit cut (Q7), measured

Store copies under `/tmp`, taken 2026-10-25 10:43Z, read only, deleted after the count (`count.mjs`: for each observed meta key, how many test files hold each path). cezar: no pytest keys; the node:test observed sets (every module load, an upper bound on the child imports) hold one path for at most 6 test files (`test:package`, `packages/cezar/dist/agent-config/*.js`, of 9 files) and at most 2 in `test:unit` and `root:test:unit`. Neither current `nodeTest` entry is slow, so their children are not recorded. squeal: no node:test or pytest project. One revision moves at most 6 files on cezar before the cap and 0 on squeal; with the cap at most K as edits.

## Direct marks on closure paths (Q5, 2026-10-25)

The coordinator's answer to Q5: the core keeps a direct mark for every project path a process the test file started imported, its closure's paths too; only the written-directory bound drops one. A file whose run grew nothing has no `ObservedGrowth`, and routing it through one turns a re-keyed file's store into `no-key` (`storeDecision`), so the marks take the start-up paths' route (`ca004eaed`): `keys.markDirect` in the record's preparation (`observedGrowth`), `keys.writeSeen` in `endRecord`'s transaction, which stores what the view holds and the store lacks (`ObservedSets.writeMarks`). Tests: `test/scheduler/observed-direct.test.ts`, "marks a child's import its closure reaches only through another module" (catch-up runner) and "stores a node:test child's import of a closure path as a mark, beside no observed path" (real node:test); `test/keys/observed.test.ts`, the rolled-back `writeMarks`.

node:test's split by process (Q5): the recorder writes one file per process; the file whose edges reach the test file's entry is its own process, worker threads included; what each other file loaded from its own non-preload roots is `direct` (`src/runners/node-test/run/observed.ts`).

pytest (C5): what `recordSpawned` marked, the imports of the processes a test file started, is the report's `direct`, no narrowing. Test: `test/scheduler/pytest-observed.test.ts:119`, a test file that reaches `app.through_b` through `app.through_a` and starts a child that imports it: the core stores the mark beside no observed path for it, on Python 3.10 and 3.13.

## The written-directory bound: the two ignored-path cases per runner

| Runner | Kept | Dropped | Test |
| --- | --- | --- | --- |
| Vitest | `dist/x.json`, a git-ignored read | `.tmp/u1/y.txt`, below `.tmp/u1`, which the run created | `test/scheduler/one-write-path.test.ts:41` (the catch-up fixture's runner reports as Vitest's recorder does); the recorder's `mkdtemp`: `test/runners/observe/recorder.test.ts` |
| node:test | `nt/dist/x.mjs`, a git-ignored module | a module below the test's `mkdtempSync` directory in `nt/.tmp` | `test/scheduler/ignored-observed.test.ts:40` |
| pytest | `dist/built_x.py`, a git-ignored module | a module below the test's `tempfile.mkdtemp` directory in `.tmp` | `test/scheduler/pytest-observed.test.ts:119`, Python 3.10 and 3.13 |

## The warm-up names only what no key will hold (Q8)

`WarmUp.read` leaves out, per file, the paths and listings the run's `observed` reports that the written-directory bound keeps, for a project `keys.observes`: the record keys them. Test: `test/scheduler/warm-up.test.ts:72`, a fresh repository (lookup-only, so the warm-up is each file's first run): both Vitest files that stat `ignored/build.txt` have no entry for it and their closures hold it; the node:test file that reads it is still named; a Vitest read below a directory the file made is still named (row 005-85, today's behaviour). Two Vitest files read the path, so the one that runs second has no first-seen re-run (001-134) to hide the first entry; without the fix the case fails.

## pytest's start-up filter (C5)

`Observed.recordSession` dropped a session path that every listed test file's closure held, the stored observations of every run and worktree included (B5, 007-36). The adapter now keeps no observation, so it drops a path in every listed file's static closure, as before, or one that every file this run ran whole reached from its own roots: a root conftest's load through a library (`test/runners/pytest/adapter-session.test.ts:143`). This is sound without the stored set: when every file of the run reached the path itself, each of their keys holds it; a file that does not reach it reports it as a start-up path when it runs.

## Start-up growth from another worktree

node:test's adapter reported another worktree's preload growth as a recreated project (`takeRecreate`). The core now does it: a refinement that reads no environments joins the start-up paths other worktrees stored (`keys.regrowStartup`, `refinement.ts` apply). Test: `test/scheduler/preload-refresh.test.ts`, mutation-checked.

## Directory records: cost per call (Q3 (a))

node:test's recorder (`src/runners/node-test/runtime/recorder.cjs`) wraps `mkdir`, `mkdtemp`, `rm`, `rmdir` and `rename`, sync, callback and promise forms. A repeated absolute path costs one `Set` lookup; a new path one `path.resolve` and one `appendFileSync` of one line. Measured 2026-10-25, 200,000 calls of each, three rounds, the host at load 60 on 24 CPUs: `mkdirSync` of an existing directory 5.2 to 5.9 µs without the recorder and 5.2 to 6.0 µs with it; `rmSync` of a missing path 6.3 to 9.5 µs and 6.6 to 7.9 µs. No difference above the noise. Tests: `test/runners/node-test/recorder-written.test.ts`.

pytest's start-up hook (`src/runners/pytest/runtime/sitecustomize.py`, in every Python process of the run, pytest's too) wraps `os.mkdir`, `os.rmdir`, `os.rename` and `os.replace`; `os.makedirs`, `tempfile.mkdtemp`, `pathlib` and `shutil.rmtree` reach them. A path named before costs one `getcwd` and one set lookup; a new one a `realpath` and one `os.write` of one line. Measured 2026-10-25, 200,000 calls of each, three rounds, the host at load 54 on 24 CPUs, an existing directory to `os.mkdir` and a missing one to `os.rmdir`: Python 3.13 3.3 to 5.0 µs a call without the hook and 5.7 to 7.4 µs with it; Python 3.10 2.7 to 4.5 µs and 7.5 to 13.8 µs. About 3 µs (3.13) and 5 µs (3.10) a call, the cost of a Python-level wrapper; a relative path costs the same once the set holds it. Tests: `test/runners/pytest/run/spawned.test.ts`, "records each directory a process creates, removes or renames, in every form, and no file write (016 D4)", on both Pythons.

## The validity comparison (C6)

`test/keys/validity` against `squeal--v0.1.308`, 2026-10-25 (`test/keys/key-format.test.ts` passes, 12 of 12; the eight validity self-tests pass):

| Version | Case that shows the raise | Last release | Candidate |
| --- | --- | --- | --- |
| `NODE_TEST_ADAPTER_VERSION` 9 to 10 | `adapter:node-test`, "a test sees the directory it made recorded as written" (`cases/adapter/node-test.ts`) | fail | pass |
| `PYTEST_ADAPTER_VERSION` 3 to 4 | `adapter:pytest`, the same name, on Python 3.10 and 3.13 (`cases/adapter/pytest.ts`) | fail | pass |
| `RECORDER_VERSION` 3 to 4 | `observe`, "reads below a directory made by mkdir and one made by mkdtemp" (`cases/observe/written.ts`) | no `written` | `written: ["out", <temporary 1>]` |

Each raise case is 007-55's kind of proof: equal keys, and a test whose outcome the runtime's new record decides. The reason each `why` gives is the change of what the core keeps. `KEY_FORMAT_VERSION` and `VITEST_ADAPTER_VERSION` stay: their cases agree and every changed line runs.

What C6 built, all under `test/keys/validity` (validity `notes.md`, decision 17):
- the `adapter:node-test` kind, which `notes.md` listed as not built: `harness/node-test.ts`, the node:test runtime in each side's `dist/node-test/`, the `ranFiles` direction, the component's kind. It also has an outcomes case;
- `Kept` in `harness/reported.ts`: the pytest and node:test kinds read the adapter's closures, environments and affected files with what the core keeps from each report. Without it, the three pytest case pairs whose runs observe paths or start-up imports had keys that differ (the adapter alone no longer holds them), and no outputs compared. With it, every pytest and node:test case has equal keys at both trees, and only the raise cases differ;
- `elsewhere` for the `assemble` kind: a second worktree's keys over the same store store observed paths, direct marks and start-up paths, one entry malformed; this one reads them back as a refinement does. They run the new `ObservedSets`, `StartupSets` and `WorktreeKeys` lines at the candidate, and the release's `refreshObserved`, `observing` and `ObservedSets.refresh` merge at the release. The start-up case's keys differ: a tree before D4 keeps no start-up paths in the core;
- `temporary` for the `observe` kind, so a `mkdtemp` name reads alike at both trees.

`StartupSets.add` had no caller but a test: it is gone, and `test/keys/observed.test.ts` calls `see` and `write`.

After the rebase onto `d81a46ec2` the last release is `squeal--v0.1.309`. Between the two releases only `src/core/code/**` and `src/core/daemon/daemon.ts` changed, no runner or keys code. `test/keys/key-format.test.ts` passes against 0.1.309 too, 12 of 12, with the same three raise cases.

## The last commit: the stores gone, the kit on the core

- `observedStore`, `pytestObservedStore`, `ObservedStore`, `ObservedPaths`, the adapters' `observed` option and the four `nodeTest.observed*` and `pytest.observed*` key functions are deleted. The runner factories lose their `store` option, so `daemon.ts` passes none (two lines).
- The kit (`test/kit`) keys as the core does, and its adapters get nothing back. `OpenWorktree.record` sees the run's start-up paths, reads the environments again when they lack one (as `rekeyEnvironments`) and stores the marks and start-up paths (`writeSeen`, as `endRecord`). A step's direct check reads the adapter's `direct` or the core's stored marks through `observedDirectOf`, the production owner (review 016-21 S1); an environment check reads the adapter's files with the core's (`environmentFiles`). The fake pack reports a child's loads as `direct`, or keeps them in memory (`marks: "memory"`), which still fails in worktree b and after the restart.
- K10's `DIRECT` gaps for pytest and node:test slow are gone: both pass. node:test fast keeps `FAST` (004 D5), Vitest keeps its K10 gap (row 016-22). node:test K5 and its two variants pass again, with the start-up paths from the core.
- Mutation check, 2026-10-25: with `ObservedSets.writeMarks` returning at once, K10 fails on node:test slow, pytest under Python 3.10 and 3.13, and the fake, each at steps 7 and 13 (`affected=none, marked=false`). Restored after.

## Review 0.1.313 repairs

- **B1, the edit cut read the marks before the shared refresh.** `fetchRunnerPart` asked `observedDirectOf` before `applyRunnerPart` refreshed the shared marks (`regrowObserved`), so a live worktree missed a mark another worktree stored after it started: its edit ran the shortest transitive file and left the marked one to catch-up. `applyRunnerPart` now reads the marks once, after the refresh and the closures it applies; `RunnerPart.observedDirect` is gone. `cutAtStart` keeps its read: it follows the keys' bootstrap, which reads the store. Test: `test/scheduler/observed-direct.test.ts`, "reads a mark a live second worktree stored after this one started", which failed before the fix (`editPaths` `[z]`).
- **The kit's memory-marks case never read its marks.** In `test/kit/driver.test.ts`, K10 with `marks: "memory"` asked for direct only in worktree b and after the restart, so the fake's remembered-marks callback ran 0 times, and the case would pass if memory mode never marked. It now edits the child's import in a before the switch and asserts a puts the file in direct from its own memory (`affected=direct, marked=false`), then the failures in b and after the restart. Mutation check, 2026-10-25: with the fake's `remembered.set` skipped, step 3 fails (`affected=none`).

## Residuals

- **A rolled-back record's direct marks.** As the start-up paths below: `markDirect` adds to this daemon's view before the record's transaction, so a rolled-back write leaves the view ahead of the store until the next record writes it. An over-mark in this daemon only.
- **A rolled-back record's start-up write.** `rekeyEnvironments` adds a run's start-up paths to the keys' view before the environments are read again (`seeStartup`); the record's transaction stores them (`writeSeen`). When that transaction rolls back, this daemon keys the paths while the store lacks them, until its next record, which writes what the view holds and the store lacks. An over-key in this daemon only (coordinator and 011's coordinator, accepted). Test: `test/scheduler/one-write-path.test.ts`, "keys a start-up path the record's rolled-back transaction did not store, and stores it next".

## Assertion changes

| Test | Before | After | Why |
| --- | --- | --- | --- |
| `test/scheduler/observed-inputs.test.ts:64` | each file runs once at the start; `ignored/build.txt` is not in the closure ("a blind spot") | the run that first hashed `ignored/build.txt` runs again (001-134); the path is in the closure | D4's written-directory bound keeps a git-ignored path the run wrote no ancestor of (the human, O1) |
| `test/e2e/pytest.test.ts:268` ("inherits into synced worktrees"; coordinator, review 0.1.313, CI 40195874433) | a second synced worktree runs `test_resources.py` and `test_core.py` once, their result in main being keyed without what their first run observed (007-14); it inherits the rest | it runs none and inherits every result; an edit of the observed `resources` package in it then runs `test_resources.py`, and so does the restore | the core stores each result under the key that holds what its run observed (D4), as the third worktree's case in the same test already showed; the added edit proves the observed import keys the file in the second worktree (goal 5) |
| `test/scheduler/observed-growth.test.ts:37` → `:39` | B inherits A's pass under a key lacking the observed path; a runner-only refinement re-keys and runs it | B never inherits A's pass: B runs its own copy, which fails; the refinement then runs nothing | the core stores A's pass under the key that holds the path, as it does a Vitest file's (D4) |
| `test/runners/node-test/adapter-attribution.test.ts` (all cases, e.g. `:145` → `:148`) | the adapter's `closure()`, `affected()` and `environment()` after a run hold what it loaded | the run's `observed` and `environmentObserved` hold it; a spawned child's loads are `direct`, a Worker's are not | the core assembles closures and environments (D4); the adapter keeps nothing |
| `test/runners/node-test/adapter-plugin-root.test.ts:98` → `:105` | the closure after a run holds the CLI's loads | the report holds them, `direct` too; keys alike under two roots as before | as above |
| `test/runners/node-test/run.test.ts`, `run-preload.test.ts`, `run-reads-fidelity.test.ts` | `ObservedClosure` of three fields | `direct: []` and `written: []` too; in `run-preload` the runner process's graph gives no `direct` | the closure gained the two fields (D4) |
| `test/daemon/observed-timer.test.ts:112` → `:116` | the timer asks on a change of `nodeTest.observed.*` and `nodeTest.observedPreloads.*` | on a change of `observed.*`, `observedStartup.*` and `observedDirect.*` | the old keys are never read (Q6) |
| `test/scheduler/preload-refresh.test.ts:27` | another worktree's growth written to `nodeTest.observedPreloads.*` | written to `observedStartup.*` | as above |
| `test/integration/touched-in-flight.test.ts:45` (`a15da9a9e`) | the harness writes the git-ignored `flags/heard` the fixture's test polls | the test makes `flags/` itself | D4 keeps a git-ignored path whose directories the run made none of, so the poll became an input that changed during the run; the claims about `fixtures/data.txt` and `src/mod.ts` are unchanged |
| `test/scheduler/warm-up.test.ts:38` → `:42`, `:73` → `:77`; `warm-up-in-flight.test.ts:57` → `:61` (`0ba0275bf`) | the warm-up names `ignored/build.txt` for the Vitest file; its edit re-runs nothing | the Vitest file's entry is empty, the node:test file's holds the path; its edit re-keys the Vitest file only, which waits for the slow lane | D4 (O1): the Vitest file's closure holds the git-ignored read; node:test's fs reads are no closure path |
| `test/cli/warmup.test.ts:136` → `:163`, `:224` → `:251` (one fixture) | a slow and a fast Vitest file read `build/out.txt`; the record names it for the slow one | the readers are node:test files (`node` named, as setup's daemon has only `git` on its PATH; the suite's build copies the node:test runtime); the record and the suggestion are as before | D4 (O1): a Vitest file's closure holds its git-ignored read; node:test keys loads, not reads (Q6 (a)) |
| `test/runners/pytest/adapter.test.ts:127` → `:97` | the run's observed-only path is in the injected store, the adapter's `closure()` and `affected().transitive` | the run's `observed` holds it; `closure()` and `affected()` stay the graph's | the core keys it (D4) |
| `test/runners/pytest/adapter-session.test.ts:115` → `:94`, `:232` → `:196` | a start-up plugin's computed import joins the store's session key and the adapter's environment files | the run's `environmentObserved` holds it; the environment's files stay the adapter's own; `observedLoads` is set | the core keeps the start-up set and joins it to the environment's key (D4) |
| `test/runners/pytest/adapter-session.test.ts:178` → `:143` | the closures hold the conftest's load through a library | each file's `observed` holds it, and it is no start-up path | as above; the start-up filter reads the run's closures (section above) |
| `test/runners/pytest/spawned.test.ts:96` → `:92`, `:139` → `:136` | the adapter's `closure()` holds a child's import and `affected()` makes the file direct | the core's `observed.small` and `observedDirect.small` hold it; the graph holds none of it | the core keeps the marks (D4, goal 6) |
| `test/runners/pytest/focused.test.ts:200` → `:175` | a focused run writes nothing to the store; the whole run's path joins the closure | a focused run reports no `observed`; the whole run's report holds the path | the report is what the core reads (D4) |
| `test/runners/pytest/run/report.test.ts` | `PytestObservedClosure` of three fields | `written: []` too | the closure gained the field (D4) |
| `test/integration/pytest.test.ts:153` | the synced worktree runs `test_core.py` and `test_resources.py` | `test_core.py` only | main's pass of `test_resources.py` is stored under the key that holds its observed `app/data/__init__.py`, which the worktree's copy matches (D4) |
| `test/integration/pytest-environment.test.ts:134` | the plugin's import in `pytest.observedSession.small` | in `observedStartup.small` | the old keys are never read (Q6) |
| `test/scheduler/idle-pass.test.ts:102` → `:105` | no read of the two adapters' injected stores in a quiet pass | no read of the core's `observed.*`, `observedDirect.*` and `observedStartup.*` keys, counted on `store.meta.get` | the stores are gone; the core reads the shared keys (D4) |
| `test/store/worktree-meta.test.ts:31` → `:28`, `:68` → `:61` | the four `nodeTest.observed*` and `pytest.observed*` key functions among the shared rows | `observedDirectMetaKey` and `observedStartupMetaKey` instead | the old key functions are deleted (Q6) |
| `test/kit/steps.ts` (`edit`, `hand`, `closures`); `test/kit/driver.test.ts:154` | a step is direct by the adapter's `affected().direct`; an environment by the adapter's files; the fake keeps its marks in a meta key of its own | direct by the adapter or the core's stored marks (`observedDirectOf`); an environment by the adapter's files or the core's; the fake reports its marks; the line reads `(affected=none, marked=false)` | the core keeps the marks and start-up paths (D4, review 016-21 S1) |
| `test/kit/packs/node-test.ts`, `test/kit/packs/pytest.ts` | K10 KNOWN by `DIRECT` (pytest, node:test slow) | PASS | D4 closes the gap (row 007-56) |

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
| `test/runners/pytest/adapter.test.ts:178` (store part) | a second adapter, as another worktree's daemon, reads the run's observation from the store | `test/scheduler/observed-direct.test.ts:76` (a second worktree keys with what the first observed); `test/scheduler/pytest-observed.test.ts:119` (the core stores pytest's observed paths, and a restart keys with them and runs nothing); `test/integration/pytest.test.ts:138` (a worktree whose observed-only module differs keys with it and runs) |
| `test/runners/pytest/adapter-session.test.ts:115` (store, other and third worktree) | another worktree re-keys the project at its next refinement; one started later keys the path before any run | `test/scheduler/preload-refresh.test.ts:18` (another worktree's growth at the next refinement, no runner recreate); `test/scheduler/one-write-path.test.ts:85` (stored, keyed after a restart); `test/integration/pytest-environment.test.ts:110` (real pytest: stored, its edit re-runs, a differing worktree does not inherit) |
| `test/runners/pytest/graph/invalidate.test.ts:115` (deleted with `recordSpawned`) | a file whose run started a process that imported a changed path is its direct importer | `test/scheduler/observed-direct.test.ts:58` and `:92` (the cut); `test/scheduler/pytest-observed.test.ts:119` (real pytest: the mark stored); `test/runners/pytest/spawned.test.ts:92` |
| `test/runners/pytest/graph/invalidate.test.ts:129` (deleted with `recordObserved`) | a file whose last run loaded a changed path outside its closure is scheduled | `test/scheduler/one-write-path.test.ts:41` and `:107`; `test/runners/pytest/spawned.test.ts:92` (real pytest: an edit of a child's import re-keys and runs both files) |
| `test/runners/node-test/adapter-observed.test.ts:18` (file deleted with `observedStore`) | a missing or malformed key reads as nothing | `test/keys/observed.test.ts:54` (paths), `:132` (start-up paths) |
| `test/runners/node-test/adapter-observed.test.ts:25` | two daemons' writes merge per test file, sorted, per project | `test/keys/observed.test.ts:27` |
| `test/runners/node-test/adapter-observed.test.ts:39` | the paths widen the stored closure a starting worktree keys from | `test/scheduler/observed-direct.test.ts:76` (a second worktree keys with what the first observed); `test/keys/observed.test.ts:27` (a worktree that starts later reads the set) |
| `test/runners/node-test/adapter-observed.test.ts:64` | two daemons' preload paths merge, sorted, and a change is read at once | `test/keys/observed.test.ts:110` (start-up paths, read at the next refresh) |
