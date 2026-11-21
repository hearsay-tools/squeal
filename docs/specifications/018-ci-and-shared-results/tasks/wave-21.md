# Wave 21: follow-ups of the node:test and unread-input slices

The human, 2026-11-21: "Next: Build all 018-60 to 64" (board rows 018-60 to 018-64, proposed by coordinator fe95a218). The five rows run in parallel on disjoint files. One candidate, one review, one release. After release, cezar's next merge run shows the effect. cezar's pin moves only with Dependabot or a later PR.

Every row: test first; `squeal status --wait 60000 <changed-path>...` before finishing; no full suite; no `pnpm run build` in a worker tree; any direct vitest run gets `timeout 600`. A new test file that runs node:test or reads the Node version goes into `test/version-sensitive.txt` per its header. Final message: commits, the tests that prove the row, decisions the spec did not settle, type changes.

## 018-60 `ci record` ignores an inherited `SQUEAL_CI_NODE_TEST_FILE`

Shape: repair. Review `reviews/0.1.580.md` S1. When the CI job's own environment already holds `SQUEAL_CI_NODE_TEST_FILE` (or `SQUEAL_CI_NODE_TEST_PROCESS`), every run of the recorded command reads as nested, and no part is written. `ci record` removes both from the environment of the command it starts. Only processes inside a node:test test set them. Starting seam: the env each runner's recording builds (`commandEnv` in `src/runners/vitest/ci-record.ts`, and its counterpart in `src/runners/node-test/ci-record.ts`). Owns those two files and their tests. Leaves alone: `src/cli/ci.ts` (018-61) and `src/runners/*/ci-runtime/`. Done when a test records both runners' parts with both variables set in the outer env, and the nested-run tests of rows 018-27 and 018-54 still pass. Use /worker.

## 018-61 a deadline on `ci record`'s endpoint hashing

Shape: slice. Spec D30, D20.2; review `reviews/0.1.582.md` S1. Hashing before the command has no time limit, so a stalled read can let an outer CI timeout stop the step before the test command starts. Bound the start hashing. Past the bound, give up, print one note, start the command, and write parts without endpoint hashes, so the export keeps D9 alone. Do the same for the end hashing. The bound must not be tuned to this host; derive it from the work, for example a multiple of the measured rate with a floor. State the rule in D30's terms in your notes. Starting seam: `src/core/ci/endpoints.ts` and its call in `src/cli/ci.ts`. Owns those two, `src/cli/ci-parts.ts` and their tests. Done when a test with a stalled read starts the command within the bound and writes a part without endpoint hashes plus the note, and the normal case is unchanged. Use /worker.

## 018-62 node:test graph keying matches what Node loads

Shape: slice. `research/node-test-left-out.md` finding b and recommendation 2, four faults:
- b1: key the tsconfig tsx loads (`TSX_TSCONFIG_PATH`, or the one found from the cwd), not each importer's nearest;
- b2: drop a value import whose every binding is used only as a type, when the TS compile settings elide it (no `verbatimModuleSyntax` or `preserveValueImports`);
- b3: scan `require(...)` only in code, not in strings or comments;
- b4: strip `?query` and `#hash` from a resolved specifier.

These move node:test keys, so every stored node:test result runs once again per store. The human accepted that on 2026-11-21. Let the key-format alarm decide: an adapter version raise needs a validity case whose outputs differ (`test/keys/key-format.test.ts`, `test/keys/validity/`). Starting seam: `src/runners/node-test/graph/` (`resolver.ts` `tsconfigFor`, `tsconfig.ts`, `parse.ts`). Owns `src/runners/node-test/graph/**`, `src/runners/node-test/version.ts`, the node:test validity cases and their tests. Done when each fault has a test that fails before and passes after. For b2, the test must also show that a dropped import never hides a module that Node does load. The alarm must agree. Use /worker.

## 018-63 `ci export --parts` takes a part file

Shape: repair, small. `squeal ci export --parts <file.json>` crashes with an `ENOTDIR` stack trace, because `readPartsIn` (`src/core/ci/parts.ts`) reads only directories. Accept a part file as itself, and refuse a path that is neither a directory nor a part file with one line and exit 2. Starting seam: `readPartsIn`. Owns that function, `src/cli/ci-export.ts` and their tests. Done when a test exports from a file path, and a missing path gives the one-line refusal with exit 2. Use /worker.

## 018-64 `squeal code --base --parts` uses the D33 rule

Shape: slice, small. Spec D33 and open question 2 of the fourth slice. The gate builds `FileReuse` without the commit tree, so it keeps D9 alone. Pass `atCommit` (`src/core/ci/inputs.ts`), as `ci export` does through `ReuseOptions.atCommit`. Starting seam: `src/core/code/gate/parts.ts` (spec 020's code, row 020-52; this row's change was approved by the human). Owns that file and its tests. Done when a gate test with an input nothing touched, equal at both ends and here, certifies the file. The same test with the input changed here refuses it. Close open question 2 in your notes. Use /worker.
