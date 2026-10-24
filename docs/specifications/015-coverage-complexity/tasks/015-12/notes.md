# 015-12 notes: CRAP and "no in-process test that Squeal runs reaches it"

Row 015-12, spec 015 wave 2b, brief "W4: 015-12" in `../wave-2.md`. Spec sections: goal 11, D5 to D7, D8 (the record), D9 with its 2026-10-24 amendments. Starts from main at 0.1.295 (`0aff41b56`), beside wave 1d (rows 015-34 to 015-37).

## What changed

While `coverage.enabled` and `complexity.enabled` hold, the daemon's code pass runs a coverage step after the complexity pass. For each counted source, it finds the test files whose stored closure holds the source (the loaders). The source is judged only when every loader has a current result with a coverage record. Then each function gets two more states, `crap` and `uncovered`:

- `crap` = CC² × (1 − cov)³ + CC, where cov is the share of the function's own lines that ran in the loaders that ran it. From 95% the score is CC. `fail` above `crap.threshold` (30).
- `uncovered` = `fail` when no loader ran the function in its own process.

A source is `pending` while a loader waits for a run or for its record. It is `unknown` while a loader cannot have a record. A pending or unknown source keeps its last judged states. Deliveries tell `crap` and `uncovered` transitions as they tell complexity's (D5, D6). Status gets a `Coverage:` line and `code.coverage`. `squeal code` shows CRAP and who runs each function. With coverage off, none of this runs, and every delivery, status and report is the 0.1.295 one.

## Seam map

| Piece | File | What it does |
| --- | --- | --- |
| Formula | `src/core/code/crap/score.ts` | `crapScore(cc, cov)`, PHPUnit's 95% rule. |
| Join | `src/core/code/crap/join.ts` | `joinCoverage(functions, sources)`: each counted function to a record's V8 functions by end position, a fallback to its own lines, the union of every loader. |
| Loaders | `src/core/code/crap/loaders.ts` | `readLoaders`: main store `testFileKeys` (current key, pending), `testFiles` (closures), `results.byKey` (a current result, skips), code store `coverage.has`. One condition per loader: `ready`, `pending` (`run` or `record`), `unknown` (cause). Conditions that cannot change at a key are cached by the pass. |
| File condition | `src/core/code/crap/file.ts` | `fileCondition` (ready, pending, unknown from the loaders), `coverageOf` (each function's lines, covered, coverage, test files from the ready loaders' records; `unread` when a record cannot vouch for the bytes). |
| Step | `src/core/code/crap/step.ts` | `runCoverageStep`: seeds `pending` states when coverage starts or a recount brings functions, judges the ready sources in 50 ms slices, writes states, transitions, evidence and the summary in one transaction. |
| Judge | `src/core/code/crap/judge.ts` | `judgeFiles`: the two states per function and D5's transitions; `kindOf`; `evidenceOf`. |
| Meta | `src/core/code/crap/summary.ts` | Code meta `coverage:<worktreeId>` (each file's condition at its blob, a hash of what its judgement read) and `coverage:<worktreeId>:<path>` (each function's lines, covered, test file count, first 3 test files). Every access goes through its functions: `test/store/worktree-meta.test.ts` (001-254) fails a direct `.meta.get/set/delete(` call with another key. |
| Removal, off | `src/core/code/crap/removed.ts` | `removedFailures` (a removed failing function's `removed` transitions, called from `pass.ts` before the states go); `clearCoverage` (coverage off: the D9 states, evidence and summary go). |
| Nudges | `src/core/code/crap/sink.ts`, `src/core/code/pass/index.ts` | `afterResults` wraps the daemon's state sink; `CodePass.soon()` coalesces a burst into one pass within 100 ms and does nothing while coverage is off; a pass with no revision, result, record or wake since the last step skips it. |
| Daemon | `src/core/daemon/daemon.ts` | The sink wrapped, the writer's `onStored` and `busy()`, the main store, given to the pass. Agreement (a). |
| Writer, store | `src/core/code/coverage/writer.ts`, `src/core/code/store/coverage.ts` | `onStored` (caught, logged), `busy()`, `CodeCoverageRepo.has`. Agreement (b). |
| States repo | `src/core/code/store/states.ts`, `types.ts` | `removeMeasure`. |
| Prune | `src/core/code/store/prune.ts` | Deletes the coverage meta of worktrees no longer live. |
| Delivery | `src/core/delivery/code-coverage.ts` (new), `code-deliver.ts`, `code-format.ts` | The measures beside complexity while a summary exists; the failing states in the plan and the seed; each entry's evidence; the FAIL, PASS and RESOLVED lines; "code changes" in the title and the overflow line when a coverage change is among them. |
| Status | `src/core/code/crap/status.ts` (reader), `src/core/status/code-status.ts`, `format-status.ts` | `code.coverage` and the `Coverage:` line. |
| CLI | `src/cli/code-coverage.ts` (new), `code-report.ts`, `code.ts` | `functions[].coverage` with paths; `coverage` without paths; `--changed` lists changed CRAP and uncovered states. |

### Edits in files wave 1d also edits

All are additions or one-line changes; no function of wave 1d's was restructured.

- `src/core/delivery/code-deliver.ts`: one import; `seed()` adds the failing coverage states to the seed (3 lines); `statesFor()` takes `measures` (default complexity) and lists states by path, then filters by measure; `codeStep()` builds `measures`, reads the view and the plan's states over them, adds each entry's evidence and the `coverage` flag. `failingIn`, `registerCode`, the recount branch and `newTooBig` are untouched.
- `src/core/delivery/code-format.ts`: one import; `codeEntryLine` returns `coverageEntryLine` for a coverage entry (2 lines); `changesWord` for the overflow line and the title.
- `src/core/status/code-status.ts`: `codeStatusOf` reads the policy once into `policy` and adds `...coverageOf(code)`; `coverageStatusLines` is new at the end.
- `src/core/code/pass/head.ts`: not touched.

## Decisions the spec did not settle

1. **The join** (D9 "by position"). The transform's source map moves an arrow's mapped start to the name before it (`const twice = (xs) =>` maps to `twice`), so a start match fails for every arrow. A V8 function joins the counted function that ends on the same line within 2 columns, with a start on the same line or the one before, nearest end first, one to one. Measured on a record Squeal's provider made on Node 24 (`test/code/crap/fixture.ts`): every function of the fixture joins, and the class field initializer joins none.
2. **cov is a share of lines, not statements.** The record holds lines (D8). A function's own lines are its range's lines minus the lines strictly inside a function nested in it; a line a nested function starts or ends on counts for both. A function with a V8 entry that was never called has cov 0 even when a shared line ran (`twice([])`'s callback). A function with no V8 entry (never compiled) ran when one of its own body lines ran.
3. **Loaders are the main store's stored closures** (`test_files`, the newest closure per test file). The worktree's in-memory key index is not reachable from the code pass without a scheduler change; the stored closure is the one the next daemon keys from. A test file with no stored closure loads nothing Squeal knows of.
4. **Unknown causes** (coordinator's answer to question 2, option A): `no-record` (a current result with no record once the writer is idle and 36.25 s have passed since the result: a run before coverage was on, a file D8's inspector rule or an `isolate: false` project runs without coverage, a node:test or pytest file, which has no provider yet), `skipped` (a skip at the loader's key), `unkeyed` (no key), `unread` (the record lists the source as unread, or holds it at another blob). An excluded suite makes nothing unknown: Squeal reads none of its closures. Status names `squeal.config.json`'s `vitest.exclude` globs (here `test/e2e/**`) and `vitest.excludeProjects` as not read.
5. **Pending** reads `run` (a loader is queued or running, or has no result at its key: under `lookup-only` until `squeal run --all`) or `record` (every loader ran, a record is being mapped or waits for its result). The step wakes when the record window ends.
6. **Quiet first judgement.** When coverage starts (or the provider version changes), every counted function gets a `pending` state, so its first judgement records no transition. A recount or first count of complexity seeds the functions it brings the same way. A function an edit added has no state, so its first judgement is a first-seen fail. Coverage starts only after the first count of complexity is done.
7. **A change of `crap.threshold`** re-judges at the next judgement of each file and tells no crossing that only the threshold made (as 015-31 for complexity). There is no summary line for it.
8. **A source no test file loads** is judged at once, run by none: `uncovered` fail, CRAP CC² + CC. Before the worktree has any test file listed, every source is pending.
9. **Where the extra data lives.** Conditions and evidence are in code meta, so the code store schema stays at version 1 and an older daemon of the repository keeps opening it. The `crap` state's value is the score; `uncovered`'s is `null` (the type's existing contract).
10. **Wording** (coordinator): the `uncovered` FAIL line says "no in-process test that Squeal runs reaches it". Lines:
    - `FAIL CRAP: f (src/a.ts:4) is 72, over 30 (CC 8); no in-process test that Squeal runs reaches it`
    - `FAIL CRAP: hot (src/a.ts:1) is 31, over 30: CC 31, 100% of its lines ran in test/a.test.ts`
    - `FAIL uncovered: f (src/a.ts:4): no in-process test that Squeal runs reaches it (CC 8)`
    - `PASS CRAP: cold (src/a.ts:2) is 6, at or under 30`; `PASS uncovered: cold (src/a.ts:2): test/a.test.ts runs it in process`
    - `RESOLVED CRAP: f (src/a.ts) is no longer in the code`
    The test files named are the first 3 by path, then `and N more test files`.
11. **The registration line is unchanged.** Goal 4 counts complexity; the seed holds the failing coverage states, so none is told later.
12. **Coverage off** removes the D9 states, evidence and summary at the next pass, so a later switch on seeds afresh.

## Proposed amendment lines for `status.md` and D9

- D9 Joining: "A V8 function joins the counted function that ends where it ends (same line, within 2 columns) and starts on its line or the one before; the source map moves an arrow's start to its name. cov is the share of the function's own lines that ran: its lines minus those strictly inside a nested function."
- D9 Pending and unknown (coordinator, option A): "A Squeal-excluded suite makes no state `unknown`: Squeal reads none of its closures, so no source is known to be loaded by one. The `uncovered` lines say 'no in-process test that Squeal runs reaches it', and status names the `vitest.exclude` globs and `vitest.excludeProjects` projects of `squeal.config.json`, whose test files are not read. A loader is `unknown` when its current result has no record once the writer is idle and 36 s have passed, when a test at its key was skipped, when it has no key, or when its record cannot vouch for the source's bytes."
- D9 States: "The first judgement of a function present when coverage starts, or brought by a complexity recount, records no transition; a function an edit added is a first-seen fail. A pending or unknown source keeps its last judged states."

## Tests

- `test/code/crap/join.test.ts` (6): the join on the Node 24 fixture record, the union of two loaders, the fallback to lines, no loader; the formula and the 95% rule against Savoia's table.
- `test/code/crap/step.test.ts` (12): goal 11, pending until every loader has a record, then the formula; a source no test loads; nothing before test files are listed; the record wait, then `unknown: no-record`; `unknown` for `skipped`, `unkeyed`, `unread` and a record of other bytes; a pending source keeps its states, then pass-to-fail, fail-to-pass and first-seen fail; a removed failing function resolved; no crossing from a threshold change; prune drops dead worktrees' meta.
- `test/code/crap/delivery.test.ts` (6): nothing told of states at registration; a new function's two FAIL lines, told once; the evidence line with CC, share and test file; a recovery; a removal told as RESOLVED; coverage never judged, complexity's delivery as before.
- `test/code/crap/status.test.ts` (2), `code-command.test.ts` (3): the coverage line and JSON; nothing with coverage off.
- `test/code/crap/pass.test.ts` (4), the coordinator's conditions: coverage off makes no pass and keeps no D9 state; a burst of 50 gives one pass; coverage off drops the states; the sink's nudge never fails the sink.
- `test/code/crap/daemon.test.ts` (1): a real daemon judges `crap` and `uncovered` after its runs, with no edit: `unused` CC 3 never ran, CRAP 12, uncovered fail; `used` ran 2 of 3 lines.
- `test/code/coverage/writer-stored.test.ts` (1): `onStored` after each record, `busy()`, a throw logged, `has`.

A mutation check: with `fileCondition` ignoring pending loaders, 3 of the step tests fail.

## Cost

Synthetic, 1,040 test files with 35-path closures by 650 sources of 12 functions (a throwaway bench, not committed): a step with nothing to judge takes 21 to 27 ms (27 to 45 ms before the perf commit); the first judgement of every source takes 0.9 to 1.0 s, which the daemon spreads over 50 ms steps. A pass with no revision, result, record or wake skips the step. With coverage off the step costs one meta read per pass, and only when complexity is on.

## Type changes (all additive)

- `CodeCoverageRepo.has(key)`; `CodeStateRepo.removeMeasure(worktreeId, measure)`.
- `CoverageWriterOptions.onStored?`; `CoverageWriter.busy()`.
- `CodePassOptions.coverage?: { main, writing }`; `CodePass.soon()`; `COVERAGE_COALESCE_MS`.
- `CodeDeltaEntry.evidence?: CodeCoverageEvidence` (new type); `CodeNews.coverage?: true`.
- `CodeStatus.coverage?: CodeCoverageStatus` (new type).
- `CodeReportFunction.coverage?: CodeReportCoverageOf`; `CodeReport.coverage?: CodeReportCoverage` (new types in `src/cli/code-coverage.ts`).
- New module `src/core/code/crap/` (`index.ts` lists its exports).

## Residue for the next worker

- **No `STILL FAIL` for `crap` or `uncovered`.** The step marks no edit, so D6's first-edit rule tells nothing for these measures. Adding it: in `judgeFiles`, compare the body hash at the state's blob with the current one and `markEdited` for the measure.
- **`complexity.blocking` counts complexity only** (`wentOverSince`). D7's Stop count for CRAP is not wired.
- **`--told` and the told-over line** (015-27) count complexity only.
- **A `crap.threshold` change has no summary line**; its crossings are quiet.
- **Per-pass cost**: about 20 ms with coverage on at this repository's size, mostly `readLoaders` (the closures list and the map by path) and the summary's JSON. A cache by the closures' `updatedAt` would cut it.
- **Skipped tests make sources `unknown`** (D9). Files with `it.skip`, `it.todo` or a runtime skip make every source they load `unknown` while the skip stands; the dogfood should count how many functions that hides here.
- **Records from another worktree's daemon** do not nudge this one; a lookup's adopted result nudges, and the record window's wake re-reads.
- **The closure is the newest stored one**, which another worktree may have written; a test file whose imports differ between branches can be read with the other branch's closure.
- **Bundles not built** (the brief): `plugins/*/dist` drift is expected in the bundle tests.
