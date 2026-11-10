# 020-07a notes: one rule, no loader reads unknown

Worker e7435c73, 2026-11-10. For 020-07b, 020-07c, 020-10b and a reviewer.

## Seam map

- `src/core/code/gate/rule.ts` `judgeFunction(input, policy)` is the one rule (D11.1). It is generic over the missing gaps a caller passes: the gate passes `not-finished` | `no-record`, the daemon `pending` | `unknown`. Output: `state`/`gap` (CC rule applied), `evidence` (D5 without the CC rule, for D8's exceptions), `crap`, and `measures.crap`/`measures.uncovered`.
- Gate: `evaluate.ts` `judge()` builds the input from `pathEvidence()`; `skipped` is true when any loader that is not `none` for the path skipped a test. The excluded branch calls the rule with `excluded: true`.
- Daemon: `crap/judge.ts` `measuresOf()` calls the rule. `Judged` gained `loaders` (ready loaders, required) and `missing` (with `early`, the file's `pending`/`unknown`). The daemon passes `complexityThreshold: Infinity`: the complexity pass judges CC (015 D5), and it reads only `measures`. Early-judgement filtering (015-57, 015-78) and `kindOf` are unchanged; a subset now gives `unknown` instead of `fail`, which the early filter dropped anyway.
- No loader: `crap/file.ts` `fileCondition([], true)` is `unknown`, cause `no-loader`; `loaderSet([])` is the marker `NO_LOADER_SET` (`"no-loader"`), so `walk.ts`'s existing 015-75 drop (`kept.loaders !== before.loaders`) drops states judged at the old empty hash once. No change in `walk.ts` was needed for the drop itself. A file seen for the first time at no loader also passes through the drop, with nothing to drop.
- `squeal code`: `cli/code-coverage.ts` reads a no-loader file's function as `{ notLoaded: true }`, text `not measured: no test Squeal runs loads this file`. The summary's `notLoaded` counts only no-loader files that hold a counted function (configs and empty files stay quiet); all no-loader files leave `notJudged`.

## Not settled by the spec, and the choice made

- The skipped test file's own record proves a pass in the gate (bound of 015 D9). The daemon still reads a loader with a skipped test as `unknown (skipped)` and does not read its record (`loaders.ts` `conditionAt`), so only other loaders' records prove a pass there. The parity table gives both paths the same records in hand.
- Gate gap order: `no-loader`, `not-finished`, `no-record`, `not-joined`, `test-failed`, then `skipped`. A missing record or a skip still lets the records in hand prove a pass.
- `squeal status` counts no-loader files in its unknown part: `N because no test Squeal runs loads them` (parent's words). It counts all such files, functions or not (`crap/status.ts`, not this row's file). In this repository that is about 11 files with no function.

## For 020-07b

- `crap/loaders.ts:199` still skips a test file as its own loader. Until 07b, a counted test file reads `no-loader`.
- `test/code/pass/unlisted.test.ts` expectations were changed here (no coverage state for a file no test loads); 07b removes the listing hold it pins.

## For 020-07c

- `TestFileEvidence.skipped` is required. A stored result with an outcome `skip` at the key must set it.
