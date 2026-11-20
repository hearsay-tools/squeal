# Probes for `research/ci-other-runners.md` (throwaway)

These scripts are throwaway. They answered one research question on 2026-11-20 and are kept only as evidence. Run them only in a scratch directory under `$TMPDIR`, never in a checkout you care about.

- `attach/`: a three-file node:test fixture and two preloads. `probe.cjs` logs which processes load a `NODE_OPTIONS` preload, their `argv` and `NODE_TEST_CONTEXT`, and module loads. `hooks.cjs` registers root-level `beforeEach`/`afterEach` in each test file's process and names the file for processes the test spawns. `reporter.mjs` writes one line per `test:pass`/`test:fail`. Copy the folder to `$TMPDIR` and run `node --test` there with `NODE_OPTIONS` as the findings say.
- `port/run-node.sh`: two fresh clones of `port/node-fixture` (developer path; GitHub runner path with its own HOME and a Node copy at a tool-cache path; `CI_VARS=1` adds `CI` and `GITHUB_ACTIONS`). Each daemon runs the fixture and exports; B dry-runs and runs the import of A's export. Needs `BASE` (scratch dir) and `SQ_CLI` (a `squeal.mjs`).
- `port/run-pytest.sh`: the same for `test/fixtures/pytest/small` with one `pytest` entry, with B variants `same`, `copy`, `venv`.
- `port/run-cezar.sh`: cezar's 148 node:test files in two prepared clones (`$C/dev/cezar`, `$C/home/runner/work/cezar/cezar`); runs only those files, never the suite.
- `port/compare.py`: compares two `squeal-results/1` exports: per-file key equality and environment descriptor differences.

Every script stops the daemons it starts. Check `/proc/<pid>/cwd` under the scratch dir afterwards and remove it.
