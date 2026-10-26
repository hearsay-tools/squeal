# 015-75 notes: tests without coverage leave no stale verdict, and the agent hears of them once

Worker 3d6d1a10, 2026-10-26, from `tasks/wave-16.md` W1 (issue #106, `research/issue-106.md`). Shape: repair, four parts.

## What changed

| Part | Change | Where | Test (red first) |
|---|---|---|---|
| 3, the wait | A nudge that found nothing to step set the record wait's wake to `null`, and `retryLater` then cleared its timer. The scheduler's `afterBatch` nudges after every batch, so in a live daemon the wake was lost and a source whose only loader had no record stayed `pending` until a restart (research Q5). The wake is now reset only when coverage goes off, and set by each step that runs. | `src/core/code/pass/index.ts` | `test/code/crap/wake.test.ts` (the second case was red) |
| 1, the stale verdict | An `unknown` source whose loader set differs from the one its states were judged with drops its `crap` and `uncovered` states to `unknown`, with no transition, and its evidence. A pass that the records in hand prove is still judged first, told as `FAIL -> PASS`, and kept. A `pending` source keeps its last judged states (the parent's Q2). The summary keeps the set as a 16-hex hash (`loaders`); an older summary has none, which counts as changed, so the reporter's stuck file clears on upgrade without an edit. | `src/core/code/crap/{file,walk,judge,summary}.ts` | `test/code/crap/no-coverage.test.ts` (e-order, the 36 s path, an older summary), with guards: same loaders turning unknown keep their states; a Vitest pending source still tells `FAIL -> PASS` |
| 2, preload-only modules | A test file whose runner gives no coverage records is `unknown` (`no-record`) at once, naming its runner, so there is no 36 s wait for it. Its project's environment files (a node:test preload's closure; pytest's plugin paths and config) count as loaded by it. Which runners give records is one set, `RECORDING_RUNNERS` in `src/core/code/coverage/runtime.ts` (Vitest only). Vitest environment files are not counted (its config runs outside the workers). | `src/core/code/crap/loaders.ts`; the key index's new `environment(project)` | `no-coverage.test.ts`, "a module only a node:test preload loads" |
| 4, words | The registration's code line ends with `Coverage comes from Vitest runs only; functions that only node:test tests run read not measured.` while coverage is on and squeal.config.json configures a runner without records (runners joined with `or`, names from each runner's `describe.ts`). It is in every variant of the line, the counting ones too, so a session that registers during the first count also hears it once. `squeal code <path>` prints `not measured: node:test gives no coverage` for each function of such a file, with no CRAP value; without paths it counts those files apart: `1 file not measured: node:test gives no coverage`. | `src/core/delivery/code-{runners,source,deliver,format}.ts`, `src/cli/code-coverage.ts` | `test/code/crap/not-measured.test.ts` |

No later hook message names or counts such a source: its states are `unknown`, so it makes no transition, no `STILL FAIL`, no count in the told line (`toldOver`), and no Stop blocking (`wentOverSince` reads `fail` only). The test drives the e-order: the helper is told `FAIL untested` while no test loads it, then its node:test test file is written, then the helper is edited; nothing more is told.

## Decisions the brief did not settle

1. **Ownership extended by the parent.** `src/core/types/scheduler.ts` (`ClosureIndex.environment?`) and `src/core/scheduler/scheduler.ts` (`keyIndex()`), commit `49e4e6ec3`, agreed with 011; `src/core/types/code-delivery.ts` (`CodeRegistration.notMeasured?`), commit `297b916b7`. No `src/runners/**` change.
2. **Drop on `unknown` only** (the parent's Q2). Dropping at `pending` too would lose the `PASS untested` line when the agent writes a Vitest test for a function it was told is untested: the new loader makes the source pending, the drop makes the state `pending`, and `pending -> pass` records no transition.
3. **A pass proven early stands through a drop** (worker's choice). `early.test.ts` "proves a pass while the source is unknown" adds a loader whose record proves `cold` passes beside one that is unknown; the set changes, and a plain drop would have hidden that `PASS`. The early judgement runs first, then every state it did not pass goes `unknown` at write time (`Judged.drop`).
4. **Seeded `pending` states of an unknown source also go `unknown`** (worker's choice). A source that never had a judgement read `CRAP pending` forever under node:test; `unknown` is what it is. Neither `pending` nor `unknown` records a transition, so no line changes.
5. **The sentence names configured runners from the policy**, not from the runners seen at run time: the registration reads no daemon state for it, and the fact is the configuration's.
6. **`test/version-sensitive.test.ts`** flags a test file whose text holds the word `nodeTest`. `not-measured.test.ts` runs no node:test, so the squeal.config.json it needs is written by the rig (`CoverageRig.configure`), which the rule reads only for running node:test. The other choice was an exemption line in `test/version-sensitive.txt`, outside this row's files.

## Type changes (all additive)

- `ClosureIndex.environment?(project): { runner; files } | undefined` (`src/core/types/scheduler.ts`).
- `CodeRegistration.notMeasured?: readonly string[]` (`src/core/types/code-delivery.ts`).
- `CodeSource.notMeasured?(): readonly string[]` (`src/core/delivery/code-source.ts`).
- `FileSummary`: `loaders?` on every state, `runners?` on `unknown` (`src/core/code/crap/summary.ts`); the summary stays `v: 1`, and an older daemon ignores both.
- `FileCondition`: `set` on `ready` and `unknown`, `runners?` on `unknown`; `LoaderCondition` `unknown` gains `runner?`; `Judged.drop?`.
- `CodeReportCoverageOf.notMeasured?` and `CodeReportCoverage.notMeasured?: { files; runners }` (`squeal code --json`; `notJudged` no longer counts not-measured files).
- New exports: `RECORDING_RUNNERS` (`src/core/code/coverage/runtime.ts`), `loaderSet` (`src/core/code/crap/file.ts`), `src/core/delivery/code-runners.ts` (`runnerName`, `recordingNames`, `notMeasuredNames`, `joined`, `noCoverageWords`).

## What the next worker must know

- **Bundles.** `plugins/*/dist` drift from these sources (4 bundle tests fail: `test/harness/plugin.test.ts`, `codex/plugin.test.ts`, `opencode/package.test.ts`, `pi/package.test.ts`); the brief said not to build them.
- **`squeal status`** (not a hook message, `src/core/status/code-status.ts`, not this row's) still words these files `N files unknown (N from a test file with no coverage record)`. A later row could say `not measured: node:test gives no coverage` there from the summary's `runners`.
- **Row 015-76.** Adding `node-test` to `RECORDING_RUNNERS` also stops counting its preload as a loader (part 2 applies only to runners without records). With per-process V8 coverage the preload would be in each test file's record, so the loader map would then need environment files as loaders for that runner too.
- **Vitest `setupFiles`** are unchanged: a source only a setup file imports still reads `no test file loads this file` (research Q3b, not probed).
- The summary grows by about 30 bytes per file (`"loaders":"<16 hex>"`).

## Proposed spec text (the coordinator amends)

**D9, Pending and unknown**, add after "... `unknown` while any of those files can have none: its current result has no record once the writer is idle and 36 s have passed (...)":

> A test file of a runner whose runs give no coverage records, node:test and pytest today, can have none at any key, so the sources it loads are `unknown` at once, with no wait, and the summary names the runner. Its project's environment files, a node:test preload's closure or pytest's plugins, run in each of its test files' processes, so each counts as loaded by each of them (amended 2026-10-26, 015-75).

**D9, First judgement**, replace "A pending or unknown source keeps its last judged states." with:

> A pending source keeps its last judged states. An unknown source keeps them only while its loaders are the test files its states were judged with; when that set differs, or an older summary has none, its `crap` and `uncovered` states go `unknown` with no transition, and its evidence goes, but a pass the records in hand prove (**A pass proven early**) is judged first and kept. So a source judged `untested` before its node:test test file existed reads `unknown`, never the old `fail` (amended 2026-10-26, 015-75, issue #106; drop on `unknown` only, so a Vitest test written for an untested function still tells `FAIL -> PASS`).

**D9, as built**, add: "A nudge that finds no revision, result or record to step keeps the record wait's wake (015-75: it was lost, so a node:test-only source stayed pending until a restart)."

**D6, Registration**, add after the first sentence:

> While coverage is on and squeal.config.json configures a project of a runner whose runs give no coverage records, the line ends with one sentence: `Complexity: 62 functions over 20; squeal code lists them. Coverage comes from Vitest runs only; functions that only node:test or pytest tests run read not measured.` It comes only at registration; no later delivery names or counts these sources (amended 2026-10-26, 015-75, the coordinator's decision after the human's "maybe it should say it once").

**D6, Details on demand**, add to the `squeal code` paths bullet:

> A function of a source that only such runners leave `unknown` reads `not measured: node:test gives no coverage`, with no CRAP value; without paths, `1 file not measured: node:test gives no coverage` (amended 2026-10-26, 015-75).
