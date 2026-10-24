# R5 notes: repair of review 0.1.295 B2 to B4, the coverage boundary (015-11)

Brief: "R5" in `../wave-2.md` (on `origin/main`). Findings: `../../reviews/0.1.295.md` B2, B3 and B4. Spec: D8 with its 2026-10-24 amendments, B3's sentence corrected in `status.md`. The tree starts from `5e18ed2b0`, beside R4 (the counter); nothing under `src/core/code/count/**` changed.

## What changed

- **B2.** `inspectorFiles` (`src/runners/vitest/coverage.ts`) reads each project's setup closure once per run (`importClosure(project, project.config.setupFiles)`, the closure `ProjectInputs.setup` holds). When it imports `node:inspector` or `inspector`, every selected file of that project takes no coverage. Each file's note says why: `its project's setup files import node:inspector` or, as before, `its closure imports node:inspector`. The direct and transitive test-file cases and `isolate: false` are unchanged.
- **B3, no change to the rule.** The coordinator's decision stands: a file that completed whole before a cancel keeps its record, and the file the cancel stopped leaves none. The review's probe is now a test.
- **B3, a defect the new tests found.** A crashed or rejected run with coverage on made `run()` throw `TypeError: Cannot read properties of undefined (reading 'coverage')`. `closeBroken` and `closeRejected` call `closeEmptied`, which deletes the instance's own properties. `#collect` then read the provider's batches through Vitest's `coverageProvider` getter on the emptied object. The report was lost, and every payload stayed on disk until the adapter closed. The adapter now takes the batches as soon as `execute` settles. A clean run hands them to `#collect`; a hung, crashed or rejected run deletes them all (`dropPayloads`).
- **B4.** `own-provider.test.ts` names each V8 function by the declaration of `src/math.ts` that holds its range. Expected, on both engines: `add 1`, `clamp 1`, `arrow 0`, `Counter 0`. Every range's columns lie inside the file's lines. The line assertions (the early return) are unchanged.

## Engines' function lists (B4)

`[startLine, startColumn, endLine, endColumn, hit]` for `src/math.ts` after `test/math.test.ts`:

| Node | Functions |
| --- | --- |
| 22.23.3 | `[1,7,3,0,1] [5,7,9,0,1] [11,13,11,64,0] [13,21,19,0,0]` |
| 24.21.0 | `[1,7,3,0,1] [5,7,9,0,1] [11,13,11,64,0] [14,2,14,11,0] [15,2,18,2,0]` |

Node 22 gives one function over the uninstantiated class body. Node 24 gives one for the field initializer and one for `increment`. In neither does a class function have a hit. CI ran Node 22.19.0; this host has 22.23.3, which fails the old assertion the same way.

## Tests

| Test | What it pins | Red first |
| --- | --- | --- |
| `own-provider.test.ts` "takes none in a project whose setup file imports node:inspector" | B2: the review's probe (inspector import in `test/setup.ts`, the test reads `globalThis.probeInspector`); both files pass, both are named, no payload is handed over | Yes, revision 2: `self-coverage.test.ts` failed (count 2) |
| `own-provider.test.ts` first test, `test/through.test.ts` added | D8: a test file that reaches `node:inspector` through a source it imports | No, no product change |
| `own-provider-runs.test.ts` "a file that completed before a cancel keeps its record" | B3: two files, the held one started; cancel with cause `yield` after the other ended. Only `test/math.test.ts` is handed over, both payloads are gone afterwards, the real writer stores the record at its key, and no record exists for the held file, though the stub join would accept it | No, no product change (the coordinator's decision) |
| `own-provider-runs.test.ts` "a hung / crashed / rejected run hands no payload over and deletes every payload its workers wrote" | B3: a real run whose two files complete, with `execute` (hung, rejected) or `runnerFailure` (crashed) mocked to mark it. The adapter's own close paths run for real | Crashed and rejected: yes, revision 8 and again on `b70647572` in a scratch worktree: `TypeError ... at InstanceCoverage.take`. Hung: no (`abandon` does not empty the instance) |
| `test/keys/validity/cases/adapter/vitest.ts` "a run with coverage on whose global setup throws stores nothing" | The key-format alarm named `dropPayloads` and its branch as lines no case ran | The alarm was red at revisions 23 and 24 |

A test file's helper for coverage moved to `test/runners/vitest/coverage-helpers.ts`. Its provider wraps Squeal's and logs the path of each payload a worker writes, so a test can check that each one is gone.

## Decisions the brief did not settle

1. **The setup closure's note is its own text.** `coverage is off for <path>: its project's setup files import node:inspector, so its tests can see V8 coverage (spec 015 D8)`. Status can tell the two causes apart.
2. **`globalSetup` is not read.** A global setup runs in the main process, not in the test's worker, so it cannot read the worker's V8 coverage.
3. **A setup file's inspector import turns off a project's coverage, whatever the test file.** The brief's rule. One import in a shared setup file can turn coverage off for a whole project; the notes name each file.
4. **Mocks for hung, crashed and rejected.** No fixture makes a run hang on demand: a worker that ignores the forced cancel stays alive after the test. A real temp-directory crash writes no payload and, as the key-format alarm showed, does not reach the dropped-payload branch; a real global-setup rejection writes no payload either. Only a mock gives a run whose files completed and whose workers wrote payloads, judged as hung, crashed or rejected. The mocks wrap the real `execute` and `runnerFailure`; everything after them is the adapter's own code.
5. **The validity case is the rejected form, not the crashed one.** With the `removeTempDir` run the alarm still named `dropPayloads` and its branch. The global-setup rejection reaches `execute` and then `dropPayloads`. It stores nothing, so the mutations in `adapters.test.ts` find it equal.

## Type changes (all additive, inside `src/runners/vitest/`)

- `coverage.ts`: `Batch` is exported as `CoverageBatch` (it was module-private).
- `coverage.ts`: new `InspectorFile { ref, through: "closure" | "setup" }`; `inspectorFiles` returns `InspectorFile[]` in place of `TestFileRef[]` (one caller, `#uncovered`).
- `coverage.ts`: new `inspectorNote(file)` and `dropPayloads(batches)`.
- `adapter.ts`: `#collect` (private) takes the batches and a non-null `uncovered`.

## Residue for the next worker

- **A hung run's late payloads.** `abandon` closes the instance in the background. A worker of that run that finishes later writes its payload into the abandoned instance's reports directory, and nothing takes it. The directory goes when the adapter closes (`#coverageDirs`). Deleting the directory when the instance is dropped could race the writer, which may still read payloads of earlier clean runs from that directory.
- **The setup walk runs per run**, like the test-file walk (015-11 residue). One walk per project per run; cheap here.
- **Bundles.** `dist/coverage/provider.mjs` is not in the committed bundles at `5e18ed2b0`, so the bundle-drift tests fail as the brief expects. `provider.mjs` itself is unchanged by this row.
