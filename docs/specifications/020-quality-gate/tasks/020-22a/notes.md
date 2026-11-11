# 020-22a worker notes: the gate's own files

Brief: `tasks/wave-8.md`, section "020-22a". Findings: `quality/2026-11.md`, row `proposed-collect-split` and slices 3, 4, 5, 6, 7, 12, 13, 14, 15, 19. No behavior change. Branch `cez/dfe5e059`, from `995cc0a9b`.

## Where each part lives now

| File | Lines | Holds |
|---|---|---|
| `src/core/code/gate/collect.ts` | 263 | `CollectOptions`, `GateRun`, `StoredEvidence`, `CollectUsageError`, `collectEvidence`, `select`, the sort helpers |
| `src/core/code/gate/runners.ts` (new) | 121 | `GateAdapters`, `Runner`, `openRunners` |
| `src/core/code/gate/evidence.ts` (new) | 83 | `FILE_ERROR`, `loadsOf`, `evidenceOf`, `leftOutFiles` |
| `src/core/code/gate/steps.ts` (new) | 113 | `storedOf`, `preparedBefore`, `tellEstimates`, `tellRan` |
| `src/core/code/gate/runs.ts` (new) | 82 | `runsOf` and its helpers (slice 14) |
| `src/core/code/gate/command.ts` (new) | 171 | `runCommand`, `Ended`, `CancelSignals` (slice 13) |
| `src/core/code/gate/report.ts` | 293 | the report types, `verdictOf`, `countStates`, `byPosition` |
| `src/core/code/gate/prepare.ts` | 153 | `prepareEntry` and the `prepare` types |

`loadsOf(adapter: RunnerAdapter, ref: TestFileRef): Promise<RelativePath[] | null>` in `gate/evidence.ts`: the closure's paths, sorted; `null` when the runner cannot give the closure. `evidenceOf`, `leftOutFiles` and `plan.ts`'s `inLoaderOrder` call it. `adapter.closure(ref).then(` appears once in `src/core/code/gate`.

## Decisions the quality file did not settle

- **The row's "keep `openRunners` in `collect.ts`" could not reach 300 lines.** 020-19 had already moved `plan` to `plan.ts`; after the named moves `collect.ts` was 370 lines. `GateAdapters`, `Runner` and `openRunners` went to `gate/runners.ts`. The done-when (under 300) governed.
- **`FILE_ERROR` moved to `gate/evidence.ts`.** A re-export from `collect.ts` fails lint (`noBarrelFile`); importing it back would make a value cycle. The parent agreed to change one import line each in 020-22b's `stored.ts` and `parts.ts` (and `parts.test.ts`): commit `b35806332`, which typechecks alone.
- **`loadsOf` does not fit `stored.ts` or `parts.ts`.** `stored.ts` needs the closure itself (`keys.setClosure`), and `parts.ts` no longer reads closures this way after 020-20. Nothing to switch at integration.
- **Slice 19's types live in `src/core/code/coverage/types.ts`**, not `src/core/types/runner.ts`: they need `CoverageRun`, and no file of `src/core/types` imports `src/core/code`. `RunnerCoverageOptions` and `VitestCoverageOptions` (adds `provider`, `tempDir`); `VitestCoverage` and `NodeTestCoverage` are now type aliases of them. `GateAdapters` uses both. Its `children` became optional, as in the runners' types; the collector always passes it.
- **Slice 5:** `UNRUN_GAPS` (ordered, `rule.ts`) is the one list; `rule.ts` builds its set from it, and `evaluate.ts` takes the first gap from it.
- **Slice 6:** `GATE_RUNNERS` and `RUNNER_NAMES` in `gate/types.ts`. `scope.ts` sorts by `GATE_RUNNERS.indexOf`.
- **Slice 7:** `loadsChangedText(selected, add)` in `src/cli/code-gate-text.ts` returns the words after the subject ("loads changed code; add --group x to run it"), because the two sentences count the files differently ("3 test files" and "3 of its 5 test files").
- **Slice 12:** the `describe` in `test/code/gate/policy.test.ts` is renamed from `readBasePolicy` to `loadBasePolicy`, so 9 test full names change. The tests are the same.
- **Slice 15:** `src/core/delivery/code-coverage.ts:81` is 020-22b's (parent's decision).

## Seen, not mine

- `test/runners/vitest/harness.test.ts` fails here and in two other worktrees: Node 26 rejects `--experimental-transform-types` ("bad option") in the child it starts. Not caused by this row.
- `evaluate.ts` is 313 lines and `stored.ts` 339; the quality file found no clean seam for either.
