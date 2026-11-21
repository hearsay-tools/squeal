# Wave 24: node:test keying against real runs, a bounded `ci record` process, no empty inner part

The human, 2026-11-21: "Next: Build 018-66, 67, 68". The three rows run in parallel on disjoint files. One candidate, one review, one release. Rows 018-69 to 018-72 and `wave-22.md`, `wave-23.md` belong to coordinator 27f5bf0c (gh-261). Leave alone `src/core/shared/**`, the shared policy keys, the `ci export` code in `src/core/ci/` and `src/cli/ci-export.ts`.

Every row: test first; `squeal status --wait 60000 <changed-path>...` before finishing; no full suite; no `pnpm run build` in a worker tree; any direct vitest run gets `timeout 600`. A new test file that runs node:test or reads the Node version goes into `test/version-sensitive.txt` per its header. Final message: commits, the tests that prove the row, decisions the spec did not settle, type changes.

## 018-66 node:test keying matches what Node loads, checked against real runs

Shape: slice, two steps. This row replaces 018-62, which was dropped after two failing reviews (`reviews/0.1.585.md`, `-r2.md`). Every one of its faults keyed less than Node loads, which gives a wrong pass. Read both reviews and `tasks/018-62/notes.md` first.
1. **The guard first, as its own commit.** Write a differential test. It generates small tsx projects and runs each with `node --import tsx --test`. It records the modules the run loads, through a `module.registerHooks` load hook in a preload or the existing recorder. It asserts that Squeal's closure for the test file holds every one of them. The generated projects cover at least:
   - every case of both reviews: `{ type as Value }`, `/` division before a value import or a literal `require`, and tsconfig path aliases used from an importer outside the tsconfig's folder, with cwd and with `TSX_TSCONFIG_PATH`;
   - re-exports, enums, side-effect imports, `import type` mixed with values, `?query` imports, and `.tsx`.

   It must pass on today's graph, which over-approximates.
2. **Narrow the key only where the differential stays green.** Allowed: key the tsconfig tsx loads, applying its path aliases to every importer as tsx does (the r2 B4 case), and strip `?query` and `#hash` from resolved paths. Do not drop value imports by reading code text. That was b2 and b3; they are out.

Every change moves node:test keys once, and the key-format alarm decides about the version. Starting seam: `src/runners/node-test/graph/` (`resolver.ts`, `tsconfig.ts`) and `adapter-project.ts` for `TSX_TSCONFIG_PATH` from the project env. Owns those, the node:test validity cases and the new tests. Done when the differential passes on every generated project, both reviews' cases are pinned, and the alarm agrees. Use /worker.

## 018-67 the hashing limit also bounds the `ci record` process

Shape: slice. Review `reviews/0.1.585.md` S1. Past the D30 limit, a file read stuck in the OS stays in flight. It can hold the `ci record` process open after the command and the parts are done. Do the endpoint hashing where it can be abandoned, for example a worker thread that is terminated, or a child process that is killed. Prove it with a test of the outer process exit, not only the return of `ciCommand`. D20.2 holds: the exit code is the command's. Starting seam: `src/core/ci/endpoints.ts` and its call in `src/cli/ci.ts`. Owns those two and their tests; `src/cli/index.ts` only if the exit needs it. Done when a test with a read that never returns shows the `ci record` process exiting with the command's code soon after the limit, and the normal case is unchanged. Use /worker.

## 018-68 an inner `ci record` inside a node:test test writes no empty node:test part

Shape: repair, small. `tasks/018-60/notes.md`: Node skips an inner `node --test` started by a node:test test, because `NODE_TEST_CONTEXT` is inherited. The inner recording still writes one empty node:test part. Write no part for a `node --test` process that ran no test file, and print no "names no Squeal reporter" line for it. A real empty run, a `node --test` with no matching files, keeps today's behaviour; tell the two apart by `NODE_TEST_CONTEXT` in that process. Starting seam: `src/runners/node-test/ci-runtime/node-test-ci.cjs` and `src/runners/node-test/ci-runs.ts`. Owns `src/runners/node-test/ci-runtime/**`, `src/runners/node-test/ci-*.ts` and their tests. Done when the 018-60 inner-recording test sees no node:test part from the skipped inner run, and the 018-54 and 018-60 tests still pass. Use /worker.

## 018-73 repair of review 0.1.587 (B1, S1)

Shape: repair, on the candidate. Read `reviews/0.1.587.md` whole.
1. **B1.** An exact tsconfig alias with a query (`@dep?q=1`) loads `dep.ts` under tsx, but the closure omits it. Strip `?query` and `#hash` from the specifier before alias matching (and before any other lookup that reads the specifier text), as tsx does. Add the review's case and its wildcard twin to `graph-differential.test.ts` as real-run cases; each fails on the candidate. Re-run the key-format alarm.
2. **S1.** Past the hashing limit, `ci record` kills its hashing child but the child's `git ls-tree` keeps running. Start the child in its own process group, and end the whole group past the limit; on a platform without groups, kill the grandchildren the child started. The review's fake-stalled-git test proves no process is left; the command's exit code stays the test's.

Owns `src/runners/node-test/graph/**`, `src/core/ci/endpoints*.ts`, `src/cli/ci.ts` and their tests. Do not run `pnpm run build`. Any direct vitest run gets `timeout 600`. Use /worker.
