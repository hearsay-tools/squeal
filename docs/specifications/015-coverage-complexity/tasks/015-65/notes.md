# 015-65 notes: coverage lines lead with their reason, say `untested`, and share one block per function

Worker 50124af4, wave 12 W2, 2026-10-26. Brief: `../wave-12.md`, section "W2: 015-65". Starts from main `1ddf0eaf4`.

## What changed

- **Blocks** (D6 **One function, several changes**). `code-format.ts` `functionLines` groups a delivery's listed entries by function, in the order the delivery lists them. One change keeps one line. Two or more give a head line, `name (path:line):`, then `- <status> <label>: …` per changed check, ordered complexity, untested, CRAP. A line in a block leaves out what another line of the block says: the CRAP line drops `no test runs it in its own process` when the block has an untested line, and its complexity when the block has a complexity line; the untested line drops the complexity when a complexity line or a failing CRAP line states it, and the CRAP when the block has a CRAP line. That gives D6's example exactly. `CODE_LISTED_MAX` still counts entries, not blocks.
- **Texts** (D9 **Delivery**). `code-coverage.ts`: `labelOf` gives `untested` for `uncovered`; the store keeps `uncovered`. FAIL untested: `no test runs it in its own process; N test files load this file (complexity C, CRAP S)`, or `no test file loads this file (…)`. FAIL CRAP: `name (path:line): 51, over 30 (complexity 9; 40% of its lines ran in rows.test.ts)`. PASS untested: `X runs it in its own process` (`run it in their own processes` for several). STILL FAIL untested: `no test runs it in its own process after the edit[, nor did one before it]; N test files load this file …; Squeal stays quiet about it until a test runs it in its own process, and squeal code <path> shows its coverage.` Complexity's own single lines are unchanged; in a block they read `FAIL complexity: 23, over 20 (ESLint rule)`.
- **The process sentence.** `They may run it in a process they start, which Squeal does not measure.` (`The test file may run it in a process it starts, …` for one loader.) Condition, the coordinator's reply to request `68616271` (2026-10-26): at least one test file loads the source and no function of that source ran in any test, read from the file's evidence (`evidence.functions`, every entry with 0 test files). No closure text scan: at R3's 10% precision the sentence would come on almost every untested line here.
- **The pointer.** The first line in a consumer's life that carries the process sentence also says `To stop checking such files, add them to coverage.exclude in squeal.config.json.` The told mark is the code meta key `excludeTold:<worktree>:<session>:<agent>`, written in the delivery's code transaction, like `tooBigTold`. `dropCode` keeps it, so a resumed session is not told again. A subagent is its own consumer and is told once, as for the too-big line.
- **Loader count** (the coordinator's option (a)). `closure.ts` `loaderCounts`: one `testFiles.list()` read, each record trusted as `closureFor` trusts it (both now share `closureTrust`), counting the listed test files whose closure holds the path. `delivery.ts` passes it to `tellCode` as `loaders`; `code-untested.ts` `withUntested` calls it only inside the write transaction and only when a listed entry is an untested FAIL or STILL FAIL with evidence. Measured on this host's store, read-only, at load 14: 54 ms for 1,338 rows and 12 MB of closures. D9's loaders are closures, so `assemble.ts` reads 7, not the research's 5 records.
- **Types** (additive, `src/core/types/code-delivery.ts`). `CodeCoverageEvidence.loaders?`, `.processes?`, `.crap?`; `CodeNews.excludeHint?`.

## Evals

`evals/lib/regrade.mjs` does not exist (a brief defect; the regrade is `evals/bin/regrade.mjs`). No eval file reads 015's code lines: `own-run-uncovered` in `behaviours.mjs`, `judge.mjs` and `rubric.mjs`, and atomic case `a5-uncovered`, are spec 001's "tests Squeal cannot answer", graded from runs and transcripts. The only eval code that sees these lines is `squeal-text.mjs` `checksOf`, which reads the code tail as the last test block's body. `test/evals/code-lines.test.ts` round-trips the real formatter: a delivery with a failing test and the new block, the same with 0.1.335's lines in its place, and with no code lines, all give the same `squealEvidence`. No eval file changed; no eval ran.

## Decisions the spec did not settle

- Block order: complexity, untested, CRAP (D6's example puts untested before CRAP).
- The process sentence and the pointer go on untested FAIL and STILL FAIL lines, not on CRAP lines whose evidence says no test runs the function (D9 names "the line" of the untested measure).
- The told line of D6 **The other side** (`1 no in-process test reaches`) and Stop's D7 text keep their words: neither was amended on 2026-10-26.
- `NOT_REACHED` stays exported: `src/cli/code-coverage.ts` (W1's) still imports it on this branch. Once W1's change lands it has no reader and can go.

## Checks

See the final report of this row for the commands and their output. New tests: `test/code/crap/untested.test.ts` (loader counts, no loader, the process sentence and its condition, the pointer per session, D9's CRAP line and D6's block from `codeLines`) and `test/evals/code-lines.test.ts`. Changed tests: the delivered lines in `test/code/crap/{delivery,early,early-bound,still-fail,still-fail-pulled,threshold,told}.test.ts` and `test/code/delivery/pulled-coverage.test.ts`.
