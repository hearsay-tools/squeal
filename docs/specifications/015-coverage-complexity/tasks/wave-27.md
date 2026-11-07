# Wave 27: Squeal's own global test setup stops putting `src/` in every test's key (row 015-106)

Coordinator 0341ef3c, 2026-11-07. The human approved this repo-local fix in task 7d611fc4. Tests only: no bundle change, no version raise; candidate `cand/015-106`. Host policy: no local full suite, no `squeal run --all`, no `pnpm run build` in a worker tree.

## 015-106

Use /worker. Shape: slice.

Outcome: `test/global-teardown.ts` and everything it imports reach no file under `src/`, so an edit to `src/core/daemon/paths.ts`, `src/core/delivery/harness-process.ts`, `src/core/fs/**` or `src/core/types/**` no longer re-keys every test file through the global setup.

Read: `research/edit-reach.md` sections 1 and 3 (the global teardown file: 25 source files at 100% reach, 0.9% of pair-seconds) and `research/probes/edit-reach/README.md`; `src/runners/vitest/environment.ts` `environmentFiles` (how the setup closure enters every environment).

Contract (the coordinator's choice):
- `test/daemon/strays.ts` gets its own `currentUid`, `userTmpDir` and `pidNamespace`, node built-ins only, each with a comment naming the product function it mirrors. `test/global-teardown.ts` imports them from there and imports nothing from `src/`.
- A test in `test/daemon/strays.test.ts` imports the product functions and asserts each copy gives the same result (`userTmpDir` for this uid and at least one other uid).
- Behaviour unchanged: teardown still kills strays and removes the run's temp parents as its header comment says.

Seam and lead: `test/global-teardown.ts` lines 13 and 14, the two `../src/` imports.

Owns: `test/global-teardown.ts`, `test/daemon/strays.ts`, `test/daemon/strays.test.ts`. Leave alone: `src/`, `vitest.config.ts`, bundles, `package.json`, the board, `spec.md`, `status.md`.

Done when: the global setup's import closure is listed before and after (file count and the `src/` files in it), from an import-graph walk or the research probes, read only, in the worker's final note; `git grep -n "src/" test/global-teardown.ts test/daemon/strays.ts` shows no import; `squeal status --wait 60000 test/global-teardown.ts test/daemon/strays.ts test/daemon/strays.test.ts` is current with no failure; lint and typecheck pass. Editing the global setup re-keys the whole suite once; that is expected; do not wait for it beyond the named files.

## 015-107: review of cand/015-106

Use /reviewer. Shape: review. The candidate SHA and range are given at dispatch. Check: (1) the global setup's closure holds no `src/` file; (2) each copy equals its product function, and the parity test would fail if one changed; (3) teardown still kills strays, fails the run naming the files, and removes temp parents of its own PID namespace only; (4) no file outside the row's ownership changed. No full suite, no `pnpm run build`. Write `reviews/015-106.md` with PASS or FAIL and commit it alone.
