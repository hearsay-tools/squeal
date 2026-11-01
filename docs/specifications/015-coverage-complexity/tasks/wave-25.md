# Wave 25: the untested line says which tests Squeal runs (row 015-103)

Coordinator 6e3bce1c, 2026-11-01. The human chose "A: fix the line" (decision card in task 6e3bce1c, 2026-11-01) after an eval alarm: in long baseline run `20261101T092538Z-135e02` on 0.1.387, cell `t2-weekend.p0.claude-claude-sonnet-5-5.e-medium.r3` claimed "TESTS: pass" from Vitest alone while the uncovered node:test file `scripts/changelog.test.mjs` failed. After the agent edited `scripts/changelog.mjs`, Squeal said "No result for scripts/changelog.mjs: no test Squeal runs reads it. Run whatever tests it yourself." and also "FAIL untested: renderRelease … no test file loads this file", which is false there: a node:test file loads it; Squeal does not run that file. Version 0.1.390 claimed. Host policy as in `011-core/tasks/wave-60.md`: no local full suite, no `squeal run --all`, no `pnpm run build`; private `/tmp` fixtures.

## 015-103

Use /worker. Shape: slice.

Outcome: an `untested` line whose file no Squeal-run test loads says so as a fact about the tests Squeal runs, never as a claim that no test exists.

Read: spec 015 D9 "Delivery" (as amended 2026-10-26, 015-58) and rows 015-65, 015-80, 015-81.

Seam and lead: `src/core/delivery/code-coverage.ts:63`, `NOT_LOADED`. Lead: `no test Squeal runs loads this file`. Check every composed form that uses it, the `STILL FAIL … after the edit, nor did one before it` form included, so each still reads as a sentence. Leave `NOT_RUN`, the counted form and `UNMEASURED` as they are.

Owns: `src/core/delivery/code-coverage.ts`, its tests (`test/code/crap/untested.test.ts`, `test/code/crap/not-measured.test.ts`, `test/code/delivery/loader-consistency.test.ts` and any other that pins the text), and plugin skill references that quote the line, if any. Leave alone: `spec.md`, `status.md`, the board, bundles, version (the coordinator's).

Done when: the tests pin the new text in each composed form; `squeal status --wait 60000` on the changed paths is current with no failure; lint and typecheck pass.

## R1: review of cand/0.1.390

Use /reviewer. Shape: review. Candidate `cand/0.1.390` at `69002a6b89f836cf619a71b36faa52e722b5d44c`, range `e5ee2e43a..69002a6b8`: `e3b904084` and `0a8b26ed8` (worker a5135603: `NOT_LOADED` text, tests, new `test/code/delivery/not-loaded.test.ts`), `09d6c6afb` (spec 015 D9 Delivery and `status.md`), `69002a6b8` (version 0.1.390 and rebuilt bundles). CI run 41297962927.

Check: (1) every composed form of the untested line reads as a true sentence where a test outside Squeal's runners loads the file and where none does; (2) the text changes nowhere else (`NOT_RUN`, the counted form, `UNMEASURED`, keys and stored records unchanged; `test/keys/key-format.test.ts` passes without a key-format raise); (3) the bundles match the source and the version is raised in every place (`pnpm run check:version origin/main`); (4) the spec amendment and `status.md` line say what the code does. No full suite, no `pnpm run build` in your tree. Write `reviews/0.1.390.md` with PASS or FAIL and commit it alone.
