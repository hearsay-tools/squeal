# 018-54 notes: no part for a run a test starts, across runners

Repair after cezar merge-group run 44805319389 (spec 018 D24, D26; row 018-27 is the same rule for Vitest inside Vitest).

## Seam map

- **Vitest below a node:test test** (`src/runners/vitest/ci-runtime/vitest-ci.cjs`): a Vitest CLI process whose env has `SQUEAL_CI_NODE_TEST_FILE` does not `install` its run reporter, as with `settings.nested`. It still calls `markNested`, so its workers and children get `nested`. The variable is set by `node-test-ci.cjs` in a test file's process and carried by `children.cjs` (inherited env or an env of the caller's own). Its loads still go to that node:test file's graph, as in the daemon's run.
- **node:test below a Vitest run** (`src/runners/node-test/ci-runtime/node-test-ci.cjs`): with `nested` in the settings, no process is a test file's process. So no `<graph>/<pid>.json`, no part, and no "names no Squeal reporter" line. The evidence hook is still installed: its loads stay in the Vitest run's evidence.
- **Squeal's reporter** (`node-test-reporter.mjs`): writes nothing when the settings say `nested` or `SQUEAL_CI_NODE_TEST_FILE` is set, so a nested `node --test` that names the reporter pair gives no part either.

## Decisions the brief did not settle

1. **A `node --test` started by a node:test test** writes no part too (reporter check on `SQUEAL_CI_NODE_TEST_FILE`). Its test file processes already joined the outer file (they inherit the variable); before, with the reporter pair, it wrote an extra empty part.
2. **`ci record` does not clear an inherited `SQUEAL_CI_NODE_TEST_FILE`.** A `ci record` started from inside a recorded node:test test would now record no Vitest run either. This was already true for its node:test runs. Not changed: the Vitest env is built in `src/runners/vitest/ci-record.ts`, outside this row.

## Test

`test/runners/node-test/ci-record-nested.test.ts`: one recorded `sh -c` command runs the project's Vitest, then `node --test` with the reporter pair. A node:test test starts `vitest run` without `CI` (snapshot update "new"); a Vitest test starts `node --test` with and without the reporter pair. Two parts only, no "no reporter" line, and the export keeps all four files. Before the fix: five parts and the line.
