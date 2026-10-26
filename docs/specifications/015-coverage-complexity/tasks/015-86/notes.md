# 015-86 notes: coverage from Squeal's node:test runs

Worker 9ca0bc6a, 2026-10-26, from `tasks/wave-17.md` W1 (`research/node-test-coverage.md` Recommendation 1 to 4). Shape: slice. Baseline `ab4b1c2b8` (main after 0.1.354).

## What changed

| Part | Change | Where | Test (red first) |
|---|---|---|---|
| The record | `ownRecord` maps each script of a node:test file's own `NODE_V8_COVERAGE` file that sits under the worktree root and outside `node_modules`. Under a loader (a `source-map-cache` entry whose first source is the script's own URL), it maps through that map over the cached `lineLengths`, and the blob is of the map's `sourcesContent`, the text the loader read; a map without that text is `unread` (repair R1). Without such a map, V8 ran the file as it is, which is read at map time. `mapScript` reads the closing-punctuation rule at the mapped source position when only line lengths are known (the research's variant D). The writer and its worker thread take `CoveredFile.ownRoot`; the worker then asks the main thread for no source. | `src/core/code/coverage/{own,map,sourcemap,record,mapper,map-worker,types}.ts` | `test/code/coverage/own.test.ts` |
| The run | Per covered file, `NODE_V8_COVERAGE` and `SQUEAL_NODE_TEST_COVERAGE` are set to `<logDir>/cov-<i>`, made before the spawn. The recorder deletes both in the test file's own process (where the runner sets `NODE_TEST_CONTEXT`): `SQUEAL_NODE_TEST_COVERAGE` at once, `NODE_V8_COVERAGE` at the entry, after the preloads (repair R1), and only when it is Squeal's directory, so a project's own value stays. Its main thread writes `own-<pid>` there. After the run, the adapter takes, for each completed file, the one main-thread file (`coverage-<pid>-<time>-0.json`) of that pid and deletes the rest. | `src/runners/node-test/run/{run,coverage}.ts`, `runtime/recorder.cjs`, `adapter-project.ts` | `test/runners/node-test/coverage.test.ts` |
| The rules | `ProjectCoverage`: coverage on while `enabled()` and the project does not run its files in the `node --test` process (`--test-isolation=none` or `--experimental-test-isolation=none`, last one wins). A file whose closure imports `node:inspector`/`inspector`, or whose project's preloads do, runs without (D8 Fidelity), noted once per file. | `src/runners/node-test/coverage.ts` | same file |
| Keys | A coverage-on node:test `resolvedConfig` ends with `"coverage":{"provider":"squeal","version":2}`. `invalidate` recreates the project when the policy turned coverage on or off since the last `environment`, so the checks re-key once. Coverage off: the key is byte-identical to 0.1.354's. | `adapter-environment.ts`, `adapter-project.ts` | `coverage.test.ts`, "keys with Squeal's marker"; validity cases |
| Daemon (agreement part 1) | The node:test runner set gets the coverage switch and the writer's `collected`. | `src/core/daemon/{daemon,node-test-runners}.ts` | `test/runners/node-test/coverage-daemon.test.ts` (a real daemon stores a record at the node:test file's result key) |
| Loaders (agreement part 2) | `node-test` joins `RECORDING_RUNNERS`. New `IN_PROCESS_ENVIRONMENTS` (`node-test`, `pytest`): their environment files count as loaded by each test file whether or not the runner gives records. Before, that held only for runners without records, so a node:test preload's module would have read `no test file loads this file`. | `src/core/code/coverage/runtime.ts`, `src/core/code/crap/loaders.ts` | `test/code/crap/no-coverage.test.ts`, "reads a node:test preload's module covered from each test file's record" (red without the `loaders.ts` change: `onlyPreload fail -`) |
| Tests moved (agreement part 3) | 015-75's tests use pytest as the runner without records. The session start now reads `Coverage comes from Vitest and node:test runs only; functions that only pytest tests run read not measured.`, and names only pytest when both runners are configured. | `test/code/crap/{no-coverage,not-measured}.test.ts` | the moved tests pass on the old source (14 of 14) before part 2 lands |
| Validity | Three `adapter:node-test` cases: coverage on, coverage off, `--test-isolation=none`. The harness reads the coverage marker as wording, counts each handed-over payload as a stored `<file> (coverage record)`, copies each payload into the driver's own `NODE_V8_COVERAGE` (so the recorder's new lines count), and keys what `invalidate` answers. | `test/keys/validity/{case.ts,harness/node-test.ts,cases/adapter/node-test.ts}` | see below |

Validity against the last release (`npx tsx test/keys/validity/compare-refs.ts squeal--v0.1.354 HEAD adapter:node-test` at `26347ddf6`):

```
squeal--v0.1.354 -> HEAD, 3860 ms, fired: true (global 20->20, vitest 3->3, node:test 10->10 fired, pytest 4->4, recorder 4->4)
  adapter:node-test	outcomes of a passing file, a failing one and one that fails to load: keys equal, outputs equal
  adapter:node-test	a test sees the directory it made recorded as written: keys equal, outputs equal
  adapter:node-test	a run with coverage on stores its outcomes and a coverage record (row 015-86): keys equal, outputs equal, wording differs
  adapter:node-test	a run with coverage off keeps the last release's keys and outputs (row 015-86): keys equal, outputs equal
  adapter:node-test	a project under --test-isolation=none takes no coverage (row 015-86): keys equal, outputs equal, wording differs
  reported: adapter:node-test case "a run with coverage on stores its outcomes and a coverage record (row 015-86)": run 1, validity:test/area.test.mjs (coverage record): absent at the last release, completed at the candidate (the candidate stores more)
uncovered: 0
```

`NODE_TEST_ADAPTER_VERSION` stays 10. `test/keys/key-format.test.ts` passes in Squeal at revision 43.

## Repair R1 (review 0.1.358 B1)

**Cause.** The recorder deleted `NODE_V8_COVERAGE` at `--require` time, before the project's `--import tsx` ran. tsx 4.23.15 sets `sourcesContent: !!process.env.NODE_V8_COVERAGE || <inspector on>` once, when its transform module is evaluated (`node_modules/tsx/dist/register-B1c7OH6V.cjs` for `require`, `index-DE3OBZuV.mjs` for `import`). On Node 22.23.3 and 24.21.0 tsx installs its hooks with `module.registerHooks`, in the main thread (`register-nyXW-TH3.mjs`); where it falls back to `module.register`, a hooks thread evaluates the module, a case not tested here. So the maps came with `sourcesContent: [null]`, and `ownSource` read the file from disk at map time and labelled the old run with those bytes.

**Choice: (b), keep the text.** The recorder now deletes `NODE_V8_COVERAGE` where its preload phase ends, in the resolve hook that already finds the entry (row 003-39). The project's preloads, tsx among them, have run then, and no test code has. `SQUEAL_NODE_TEST_COVERAGE` still goes at once, so a process a preload starts names no pid. In Node's internal threads (a hooks thread of an async loader) the recorder touches neither variable, so it cannot take the text from such a loader. Why (b), not (a):
- tsx's own text is the bytes it read, so the blob is exact, not a second read.
- It adds no work per loaded file: (a) needs a load hook that hashes each own module and writes a line for it, plus a file and its transport to the mapping thread.
- It reuses the entry the recorder already finds; no new hook.

**Safety net (the brief's last sentence).** `ownSource` reads an own map without a string `sourcesContent[0]` as `unread`, never from disk. That covers a loader that leaves the text out, Node without `module.registerHooks` (before 22.15: the recorder deletes the variable at once there), and a main thread whose entry the recorder cannot see. Decision 2 (no map: the file read at map time) is unchanged.

**What still sees the variable.** The project's own preloads, between the recorder and the entry. A process a preload starts writes its coverage into the directory under another pid, which the adapter deletes. The test file's code, its children and its threads never see it (the tests below).

**Tests (red first).**
- `test/runners/node-test/coverage.test.ts`, "keeps the blob of the text tsx ran when the source changes before mapping": a real tsx run, then `src/edited.ts` is overwritten, then the payload is mapped through the writer's mapping worker (`TS_WORKER`) and on the main thread. Both records hold the blob of the text that ran (`619c64d8…`), and `called` ran, `unused` did not. Red before the repair with the reviewer's hashes: `expected '2f833eed…' to be '619c64d8…'`. The same test file starts a worker thread that reads `3:unset` and whose modules are not in the record; "counts no line of a process the test spawns" keeps its child at `2:unset`.
- `test/code/coverage/own.test.ts`, "reads a script unread when its own map lacks the text the loader read": red on the old `own.ts` (`expected { v: 1, sources: [ { …(5) } ] … } to deeply equal { v: 1, sources: [] … }`).

**Node 22 and 24.** Node 24.21.0 is the host default, which Squeal's daemon uses. For Node 22.23.3, Vitest ran with that Node first on `PATH`, so the adapter's `node` is that Node too: `PATH=$HOME/.nvm/versions/node/v22.23.3/bin:$PATH npx vitest run test/runners/node-test/coverage.test.ts test/code/coverage/own.test.ts` gave `Test Files 2 passed (2)`, `Tests 13 passed (13)`. With the old recorder and `own.ts` put back, the same Node 22 run failed with `expected '2f833eed…' to be '619c64d8…'`.

**Cost (measured, `probes/r1-blob-cost.mts`).** One node:test file that imports 200 small tsx modules, run as Squeal runs it (`--enable-source-maps --require <recorder> --import tsx --test`), 6 rounds, the old and the repaired recorder in alternating order, medians. The old side's map time includes reading each own source from disk, as the old `ownSource` did; the new side reads none.

| Node, one-minute load | Recorder | Payload | CPU of the run (user + sys) | Map (parse and `ownRecord`) |
|---|---|---|---|---|
| 24.21.0, 8.9 | old | 1,056,425 B | 0.36 s | 17.5 ms |
| 24.21.0, 8.9 | repaired | 1,087,790 B (+3.0%) | 0.36 s | 15.4 ms |
| 22.23.3, 7.5 to 8.0 | old | 973,723 B | 0.38 s | 17.6 ms |
| 22.23.3, 7.5 to 8.0 | repaired | 1,004,986 B (+3.2%) | 0.37 s | 16.0 ms |

The added bytes are the source texts (about 157 B per module here). The run's CPU did not change beyond the spread between rounds. Each run left the same files on both recorders and both Nodes (`coverage-<pid>-<time>-0.json` and `own-<pid>`; no hooks-thread file). No work per loaded file is added in the test's process: the recorder's change is one comparison at the entry.

## Agreements outside the brief's files (the coordinator's reply to request `4b32eb13`, 2026-10-26)

1. `src/core/daemon/node-test-runners.ts` and `daemon.ts`: additive wiring, no other daemon change. Commit `c4f204c98`.
2. `src/core/code/crap/loaders.ts`: one condition, keyed on `IN_PROCESS_ENVIRONMENTS` beside `RECORDING_RUNNERS`; the no-record `unknown` stays keyed on `RECORDING_RUNNERS`; with the test the coordinator asked for. Commit `e45eccdd5`.
3. `test/code/crap/no-coverage.test.ts`, `not-measured.test.ts`: pytest as the runner without records, each test's meaning kept. `rig.ts` needed no change. Commit `1d7e8d642` (the moves) and `e45eccdd5` (the sentence and the new preload test, which depend on part 2).

4. `test/daemon/reload-projects.test.ts`, `reload-projects-kit.ts` (the coordinator's reply to request `21b4b0db`): the test "keeps the projects through a file that does not parse" failed, its rows re-keyed. The kit wrote coverage off; a file that does not parse reads as the defaults but for its projects (`daemon.ts` `#reloadPolicy`), and the defaults turn coverage on, so the node:test key's marker changed, as a Vitest key's does (`src/runners/vitest/adapter.ts:418`). The kit now takes extra config keys, and that test passes `{ coverage: { enabled: DEFAULT_POLICY.coverage.enabled } }`, so its settings equal the defaults. Commit `460f5ec9c`. Keeping the last coverage and complexity settings through a file that does not parse is a product change; the coordinator files it as a planned row.

`test/keys/validity/case.ts` (shared by every kind) gained two optional `NodeTestInput` fields; I read it as part of "a node:test case under `test/keys/validity/`".

## Decisions the brief did not settle

1. **Which payload is the test file's.** The research left it open (its open question 3: the `node --test` parent writes none, cause not read). The recorder names its pid (`own-<pid>`), and only that pid's main-thread file is read (Node names files `coverage-<pid>-<time>-<threadId>.json`, verified on 24.21.0: thread 0 is the main thread). So a parent's file from a later Node, a loader's hooks thread (thread 1 under tsx) and a child that escapes the delete are never read. Several main-thread files of that pid (a test's `v8.takeCoverage()`) give no record, not a wrong one.
2. **The blob without a map.** For a script V8 ran as it is (plain JS, type stripping), the file is read at map time; no stamp of the bytes Node read exists. An edit after the run re-keys the test file, so no result at its current key names the run and the writer keeps no record (`mainStoreResultKey`). The remaining window is an edit and a revert between the run and the map, which node:test results have too. Under a loader the blob is exact (`sourcesContent`), or the source is `unread` (repair R1).
3. **`--test-isolation=none` runs with coverage off**, with one note, as Vitest's `isolate: false` (D8). There the tests run in the `node --test` process, where `NODE_TEST_CONTEXT` is unset, so nothing deletes the variable and a spawned child's coverage would join (research open question 2). Its key holds no marker.
4. **A timed-out run keeps the records of the files that completed before the deadline.** Each file is its own process, so a completed file's payload is whole; its result is kept (001 D12), and the writer stores its record only while that result is current. This differs from D8's Vitest wording "in a run that did not hang".
5. **A map of another file is not the script's.** A compiled `.js` whose own map points at a `.ts` source maps as the `.js` file it is (no map), so lines are never credited to the wrong path.
6. **A file the graph does not list** (a race between listing and run) runs without coverage and without a note.
7. **No `catch` in the new code paths that no validity case runs.** The alarm needs every changed line of the node:test bundle and runtime to run in a case. So `run/coverage.ts` checks `existsSync` instead of catching, `reads()` checks the listing instead of catching, the recorder writes `own-<pid>` with `fs.writeFile` and an empty callback (a failed write leaves no pid named, so no record), and `runNodeTest`'s return lines stay byte-identical (the adapter reads the payloads from the log directory). Moving the return lines had made `run.ts:219` a changed baseline line no baseline case ran.

## Type changes (all additive)

- `ExecutedSource.lineLengths?`, `CoveredFile.ownRoot?`, `SourceMapLike.sources?`; new `CachedSourceMap`, `V8Payload` (`src/core/code/coverage/types.ts`).
- `ToWorker` job `ownRoot?` (`mapper.ts`).
- `PositionMap.segments` yields `[column, sourceLine, sourceColumn]` (was `[column, sourceLine]`; every caller destructures the first two).
- New exports: `ownRecord` (`own.ts`), `sourceEntry`, `recordOf` (`record.ts`), `IN_PROCESS_ENVIRONMENTS` (`runtime.ts`).
- `NodeTestAdapterOptions.coverage?: NodeTestCoverage`, `NodeTestRunnersOptions.coverage?`, `NodeTestRunOptions.covered?`; new `src/runners/node-test/coverage.ts` (`NodeTestCoverage`, `ProjectCoverage`, `sharesProcess`) and `run/coverage.ts` (`coverageDir`, `coverageEnv`, `coveragePayloads`).
- `projectEnvironment(..., packages?, coverage = false)`.
- `NodeTestInput.argv?`, `NodeTestInput.coverage?` (validity harness).

## Proposed spec text (the coordinator amends)

**Non-goals**, replace "Coverage under node:test and pytest. The research found both feasible (`coverage-collection.md` Q3); they are later rows." (keep the sentence on Python complexity) with:

> Coverage under pytest. The research found it feasible (`coverage-collection.md` Q3); it is a later row. Coverage under node:test is built (D8, row 015-86).

**D8**, add after the Vitest paragraphs, before **Keys**:

> **node:test** (amended 2026-10-26, 015-86, the human's "node:test: A. Build, same switch"; `research/node-test-coverage.md`). With `coverage.enabled`, each node:test file's run sets `NODE_V8_COVERAGE` to `<logDir>/cov-<i>`, made before the spawn. The recorder, the test file process's first `--require`, deletes it from `process.env` where the runner set `NODE_TEST_CONTEXT`, at the test file's entry, after the project's preloads: that process keeps its own coverage, a loader that reads the variable as it starts keeps the text it read in its maps (tsx does), a process the test spawns or a thread it starts writes none, and a test cannot read it; a project's own `NODE_V8_COVERAGE` is never deleted (amended 2026-10-26, review 0.1.358 B1). The recorder names its pid in the directory, and the record is read from that pid's main-thread file alone. Each script under the worktree and outside `node_modules` is a source: under a loader, mapped through Node's `source-map-cache` map over its line lengths, closing punctuation read at the mapped source, and its blob that of the map's `sourcesContent`, or `unread` when the map lacks that text, since the file on disk can be a later edit; without a map of its own, the file as V8 ran it, read when mapped. A file whose closure or whose project's preloads import `node:inspector` or `inspector` runs without coverage, with a note; so does a project under `--test-isolation=none`, as an `isolate: false` project, since its tests run in the `node --test` process. A file that completed before a deadline keeps its record, as it keeps its result. The cost measured +18% CPU per node:test file at loads 15 to 23, and about 20 ms of one thread per file to map.

**D8 Keys**, add: "A coverage-on node:test project's `resolvedConfig` holds the same marker, so turning coverage on or off re-keys its checks once; a project under `--test-isolation=none` holds none (015-86)."

**D9, Pending and unknown**, replace "node:test and pytest today (`RECORDING_RUNNERS` names the others)" with "pytest today (`RECORDING_RUNNERS` names the others: Vitest, and node:test from 015-86)", and replace "Its project's environment files, a node:test preload's closure or pytest's plugins, run in each of its test files' processes, so each counts as loaded by each of them" with:

> A project's environment files that run in each of its test files' processes, a node:test preload's closure or pytest's plugins (`IN_PROCESS_ENVIRONMENTS`), count as loaded by each of its test files, whether or not its runner gives records; a Vitest environment holds its config, which runs outside the workers (amended 2026-10-26, 015-75, 015-86).

**D6, Registration**, change the example sentence to `Coverage comes from Vitest and node:test runs only; functions that only pytest tests run read not measured.`, and **Details on demand** to `not measured: pytest gives no coverage` and `1 file not measured: pytest gives no coverage` (015-86).

## What the next worker must know

- **Bundles.** `plugins/*/dist` drift from these sources, the recorder's copy in `dist/node-test/` included. Squeal shows `test/harness/pi/package.test.ts` and `test/harness/opencode/package.test.ts` failing on `cli/coverage-map.mjs`; the Claude Code and Codex bundle tests drift the same way (015-75 listed four). The brief said not to build them.
- **`run.ts` is 327 lines** (306 at the baseline) and `adapter-project.ts` 309 (297). The additions there are a few lines each; the payload logic is in `run/coverage.ts` and the rules in `coverage.ts`.
- **Open from the research.** The line rule under tsx is checked on fixtures (here and the research's one), not at scale (its open question 1). The type-stripping case reads the `.ts` file as V8 ran it, so a line that holds only types inside a function counts as a line that can run; `module.stripTypeScriptTypes` at map time would remove that, at a cost per source not measured. Node's own `node:` scripts (about 220 of 723 per file in the research) are parsed and skipped; filtering them before the parse was not tried (its open question 5).
- **`squeal status`** still words a pytest-only file `N files unknown (N from a test file with no coverage record)` (015-75's note); unchanged here.
- **The session-start sentence** follows `RECORDING_RUNNERS` and the configured runners, so a project under `--test-isolation=none` reads as recorded there although its files give no records. They read `unknown` after D9's 36 s wait, as Vitest `isolate: false` files do.
