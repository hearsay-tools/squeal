# 015-81 notes: one set of loader facts per file in a delivery

Worker 0e37f947, 2026-10-27, from `tasks/wave-21.md` W1 (coordinator 8b2a8995). Shape: repair. Spec D9 **Delivery** as amended 2026-10-27 (the 015-81 paragraph); `lessons.md` Round 2, C4.

## The cause

`withUntested` (`src/core/delivery/code-untested.ts`) put the loader count and the process flag inside the function's own evidence (`CodeCoverageEvidence.loaders`, `.processes`). It skipped an `untested` entry with no evidence, since there was no object to put them in. The formatter (`untestedWhy` in `code-coverage.ts`) then read `no test runs it in the test's own thread`, with no count, for that function. Its file's other function, with evidence and 0 loaders, read `no test file loads this file`. That is the cezar case (`readOwner` beside `createTestSandbox`, one file, one delivery).

A CRAP line had the same gap from a second cause: `crapEvidence` never read loaders. A CRAP line whose function no test ran said `no test runs it in the test's own thread` beside its file's `untested` lines that gave a count (`605ca21e`'s `startCoverage` in `provider.mjs`, `judged.tsv` line 237), or `no test file loads this file`.

A third, smaller fault: `count(path)` ran once per entry, not once per path.

## What changed

| Part | Before | After | Where |
|---|---|---|---|
| Carrier | `evidence.loaders`, `evidence.processes`, only on an `untested` entry with evidence | `CodeDeltaEntry.fileLoaders: CodeFileLoaders` (`count`, `processes?`), one object per path in a delivery, with or without evidence | `src/core/types/code-delivery.ts` (agreed, own commit) |
| Which entries get it | `untested` FAIL or STILL FAIL with evidence | also `untested` ones with no evidence, and CRAP FAIL or STILL FAIL whose evidence says no test ran it (`testFiles === 0`) | `saysWhy` in `code-untested.ts` |
| Reads | `count(path)` per entry; the file's evidence once per path, only when `n > 0` | count and evidence once per path (`fileOf`) | `withUntested` |
| Formatter source | `entry.evidence.loaders` | `entry.fileLoaders`, else an older release's `evidence.loaders`/`processes`, else no count claimed (`fileLoadersOf`) | `code-coverage.ts` |
| CRAP wording | `(complexity 7; no test runs it in the test's own thread). Squeal does not measure worker threads or child processes.` | with 2 loaders: `(complexity 7; no test runs it in the test's own thread; 2 test files load this file). Squeal does not measure …`; with 0: `(complexity 6; no test file loads this file). Squeal does not measure …` | `crapEvidence`, through `notRun` |
| `untested` with no evidence | `no test runs it in the test's own thread. Squeal does not measure …` | the file's facts: `no test file loads this file. Squeal does not measure …`, or `no test runs it in the test's own thread; 2 test files load this file. They may run it in a worker thread …` | `untestedWhy`, through `notRun` |

Unchanged: the thread limit sentence (015-80), the process sentences, `coverage.exclude` once per consumer, a block's CRAP line that leaves the reason to its `untested` line, PASS and RESOLVED lines. A function's complexity, hit share, test files and CRAP stay its own: a function with no evidence gets the file's loader facts and nothing else, so its line has no `(complexity …, CRAP …)`.

## Red first

`test/code/delivery/loader-consistency.test.ts`, before the source change, Squeal at revision 1 (`8da1c63f + 1`): 6 of 9 failed.

```text
FAIL … says no test file loads the file on each of its lines, the one with no evidence too
     + "FAIL untested: bare (src/b.ts:2): no test runs it in the test's own thread. Squeal does not measure worker threads or child processes.",
     - "FAIL untested: bare (src/b.ts:2): no test file loads this file. Squeal does n…
FAIL … gives a loaded file's count and process sentence to each of its lines, coverage.exclude once
FAIL … keeps each file's facts its own
FAIL … reads each file's loaders and evidence once, however many of its functions are listed
     expected [ 'src/c.ts', 'src/d.ts', 'src/c.ts' ] to deeply equal [ 'src/c.ts', 'src/d.ts' ]
FAIL … gives a CRAP line no test ran the file's facts, and keeps the function's own score
     - "FAIL CRAP: startCoverage (src/p.mjs:63): 56, over 30 (complexity 7; no test runs it in the test's own thread; 2 test files load this file). …"
FAIL … reads the file's facts before evidence an older Squeal wrote
Named test files at revision 1: 6 known failures: 6 tests; 1 test file
```

The other three passed before and after, as they should: the legacy fallback, no count claimed when neither field is there, and no loader read when no line says why. After the change all six went `FAIL -> PASS` at revisions 5 and 6. The first case then failed only on line order (the delivery lists `bare` before `lone`); the expectation was reordered. A STILL FAIL CRAP line was added to the CRAP case after.

The three rig cases go through the real delivery (`rig.told`). The missing evidence is made by removing one function from the file's stored evidence after the step judged it, as when its join found nothing. The read-once case wraps the code store's `meta` and the loader reader and counts calls per path.

`test/code/crap/untested.test.ts`: its four hand-built formatter cases now carry `fileLoaders` on the entry, the path a delivery takes. The legacy `evidence.loaders` path keeps two cases in the new file.

## Decisions the spec did not settle

1. **Carrier.** A new optional `CodeDeltaEntry.fileLoaders`, in its own agreement commit (coordinator's reply to request `87239eb1`, option a). Setting it on the entry keeps `code-format.ts` and `code-deliver.ts` untouched. A map on `CodeNews` would need `code-format.ts` to pass it through `BlockContext`.
2. **New deliveries write only `fileLoaders`.** `evidence.loaders` and `evidence.processes` are kept in the type and read when `fileLoaders` is absent (coordinator: older callers or stored data). With neither, the line claims no count (`no test runs it in the test's own thread`), never `no test file loads this file`.
3. **A CRAP line states the count too, not only the 0 case.** The board's done-when asks for the same loader wording on both functions. The 605ca21e line had a count missing, not a contradiction, but without the count the two lines still read differently. Cost: up to about 30 characters on such a CRAP line.
4. **A CRAP line keeps the thread limit sentence, not the process sentence.** The process sentence and its `coverage.exclude` hint stay on `untested` lines, so the hint's once-per-consumer rule did not change. A CRAP line with `processes` reads `Squeal does not measure worker threads or child processes.`, which agrees with its file's `They may run it in a worker thread …`.
5. **The process flag still needs some stored evidence.** `noneRan` is unchanged: with no stored evidence for the file, no process sentence. A function with no evidence does not count as one that did not run.

## Type changes

Additive, in `src/core/types/code-delivery.ts` (commit `3828b9136`): `export interface CodeFileLoaders { readonly count: number; readonly processes?: true }` and `CodeDeltaEntry.fileLoaders?: CodeFileLoaders`. No field removed or changed.

## Found, not changed (outside this slice)

- The doc comments of `CodeCoverageEvidence.loaders` and `.processes` (`code-delivery.ts`, 015-84's file) still describe them as written on each `untested` FAIL. This row no longer writes them; the new field's doc says so. A one-line pointer there can come at integration.
- Cost: a delivery now also reads the loaders when it lists a CRAP FAIL or STILL FAIL that no test ran, and no `untested` line. That is one closure read per such delivery (`loaderCounts`, about 54 ms on 1,338 test files, 015-65's measure). Not measured here.
- `spec.md` D9 **Delivery** shows no CRAP example with a loader count; the 015-81 paragraph states the rule.
- `plugins/claude-code/dist` and the other bundles hold the old wording until the release build (brief: no bundle build).

## Commits

- `3828b9136` feat(015-81 with 015-84): a delivery entry can carry its file's loader facts.
- `80f442823` fix(015-81): one set of loader facts per file in a delivery.
- This notes file.

## Checks run

- `squeal status --wait 90000 test/code/delivery/loader-consistency.test.ts` at revision 1 (`8da1c63f + 1`), before the source change: 6 known failures in 9 tests (the red output above).
- `squeal status --wait 120000 test/code/delivery/loader-consistency.test.ts test/code/crap/untested.test.ts` at revision 6 (`3828b913 + 3`): `Named test files at revision 6: no known failures; 2 test files, each with a current result, after 3.8 s.`
- `squeal status --wait 270000 test/code/crap/*.test.ts test/code/delivery/*.test.ts test/evals/code-lines.test.ts` at revision 9 (`3828b913 + 6`): `Named test files at revision 9: no known failures; 57 test files, each with a current result, after 93.3 s.` No other CRAP or delivery test changed its expectations, so no existing test held a CRAP line that no test ran beside a loader count.
- After the STILL FAIL CRAP case, `squeal status --wait 90000 test/code/delivery/loader-consistency.test.ts` at revision 10: no known failures, 1 test file current.
- `npm run lint` (`biome check .`): `Checked 2379 files in 1008ms. No fixes applied.`
- `npm run typecheck` (`tsc --noEmit`): clean.
- Affected checks of the three changed sources, `squeal status --wait 580000 src/core/delivery/code-coverage.ts src/core/delivery/code-untested.ts src/core/types/code-delivery.ts` at revision 11 (`80f44282 + 1`; each selects the same 746 test files): 543 pass, 4 fail, 203 pending at the deadline (exit 3). The 4 failures are bundle drift, `cli/squeal.mjs differs from the build`, in `test/harness/plugin.test.ts`, `test/harness/codex/plugin.test.ts`, `test/harness/opencode/package.test.ts` and `test/harness/pi/package.test.ts`. That is expected while this row builds no bundle (brief), and Squeal reads each as `no baseline result, may predate your edits`, as 015-80 saw for its base. The release build clears them.
- The 203 test files pending at that deadline have no verdict from me. A third wait at revision 11 started at about 01:00 UTC; I stopped it at 01:08 UTC on the coordinator's instruction, before it printed a result. Its 63 running files were mostly `test/cli/*` and `test/daemon/*` wait, update and daemon tests that select these sources through their closures. This is not a full-suite pass; the coordinator runs the combined gate and candidate CI after integration.
- Worktree: 27 test files never ran at their inputs (the baseline is lookup-only; nothing queued them, for example `test/code/pass/edits.test.ts`). They have no verdict from me.
- Not run: a full suite and a bundle build (brief).
