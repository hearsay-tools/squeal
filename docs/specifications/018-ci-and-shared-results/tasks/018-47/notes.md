# 018-47 notes: `ci record` records node:test

Worker notes for spec 018 D22 to D25 (wave 19). What the code does and why, for whoever continues (018-48 reads these parts).

## Seam map

- `src/core/ci/parts.ts`: format 5. `PartRunner`, `PartHeader.nodeTest` (`PartNodeTest`), `NODE_TEST_UNASSIGNED`. A node:test part has `projects: []`, no coverage, and each file's `project` is `""`: `ci export` assigns the entry (D26.1). `nodeTest.preloads` holds the files loaded before each test file's entry (the daemon's `environmentObserved`), agreed with the coordinator.
- `src/cli/ci.ts`: `startFor` starts node:test's recording when the config has a `nodeTest` entry and Vitest's when Vitest resolves. With both, Vitest's `startRecording` takes node:test's hooks and settings (`also`) and takes the evidence for both; alone, node:test's `alone()` builds the env and its own evidence directory. `src/cli/ci-parts.ts` writes one part per Vitest process and per `node --test` process.
- `src/runners/ci-runtime/`: the evidence hooks both runners share (moved from `src/runners/vitest/ci-runtime/`). In `dist/ci/` all CI files sit flat; in the sources Vitest's and node:test's hooks load them two folders up (`vitest/ci-runtime/shared.cjs`, `node-test-ci.cjs` `shared`). `children.cjs` puts back every hook the settings name in `hooks` and carries the process's other `SQUEAL_CI_` variables into an env of the caller's own.
- `src/runners/node-test/ci-runtime/node-test-ci.cjs`: first in `NODE_OPTIONS`. Installs the evidence, then applies D24: a test file's process (NODE_TEST_CONTEXT, no SQUEAL_CI_NODE_TEST_FILE) sets `SQUEAL_CI_NODE_TEST_FILE` and `SQUEAL_CI_NODE_TEST_PROCESS` and writes `<graph>/<pid>.json` (file, ppid, raw probe); every process with the file variable gets `SQUEAL_NODE_TEST_GRAPH=<graph>/<test pid>` for the daemon's unchanged recorder, which follows it in `NODE_OPTIONS`.
- `src/runners/node-test/ci-runtime/node-test-reporter.mjs`: `dist/ci/node-test-reporter.mjs`. Writes `<events>/<pid>.ndjson`: a header line, then the daemon reporter's own lines (it runs `runtime/reporter.mjs` over the events). Without the settings it drains the events and writes nothing.
- `src/runners/node-test/ci-runs.ts` and `ci-files.ts`: per `node --test` process, the events split by `data.file` (absolute; Node 22's `test:stderr` relative), each read by `readFileStream` with the final summary, each file's closure by `observedClosure` over the graph files of its test file process. `ci-flags.ts`: refused flags, `--test-shard`.

## Decisions the spec did not settle

1. **`runtime/recorder.cjs` is unchanged.** The brief names "the recorder's CI mode (`runtime/recorder.cjs`)". That file is node:test validity-path text (`test/keys/validity/components.ts`): a CI branch there would need its lines run by a validity case. The CI mode is `node-test-ci.cjs` before it, which sets the variables the recorder already reads. Same behaviour; no key path change.
2. **A file without a closure is left out of the part**, with a note, not written without `observed`: never keyed without its loads (D24.2). A Node without `module.registerHooks` (before 22.15) therefore records no file.
3. **An own-env child keeps its file**: `children.cjs` carries `SQUEAL_CI_NODE_TEST_FILE` and `SQUEAL_CI_NODE_TEST_PROCESS` and the hooks into it, so its loads join the file. The daemon's run does not see such a child's loads (its recorder rides only in the inherited `NODE_OPTIONS`), so for that file the CI closure can hold more than the daemon's: its key differs and the import does not make it current. Safe (no wrong key), a lost reuse in that rare case.
4. **`nodeTest.env` comes from the `node --test` process** (the reporter's header), which node:test passes unchanged to each test file's process. Values never leave the private directory; the part holds `configFieldHash(value)` or `null`.
5. **The file outcome** is `fail` with a failed check or a file-level error, `skip` when every check is skipped, else `pass`. The daemon keeps no file outcome for node:test.
6. **A missing reporter part** (D23.5) takes its `execArgv` as `[]` and its Node fields from a test file process's probe, since the `node --test` process wrote nothing.
7. **The end**: `completed` with the final `test:summary`, else `crashed` and no file.

## Tests

`test/runners/node-test/ci-record*.test.ts` (in `test/version-sensitive.txt` through `test/runners/node-test/`). The stdout test runs without `NODE_USE_ENV_PROXY`: on Node 22 any preload in `NODE_OPTIONS`, the daemon's recorder too, changes the experimental warning an async loader's thread prints under that variable.

## Not done here

- A test of one command running both Vitest and node:test processes. The mixed path is tested with Vitest resolving and only node:test running.
- `pnpm run build`: the committed bundles do not hold these changes; the coordinator builds at integration. `test/harness/*` bundle tests fail until then.
