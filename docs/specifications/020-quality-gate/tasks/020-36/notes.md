# 020-36 worker notes (2026-11-12)

What the slice changed so that the daemon records what a node:test child
process loads (spec 020 D12.6 as amended 2026-11-12, `research/issue-194-gaps.md`
G6), the choice the spec did not settle, and what a next worker needs.

## Flow after the change

1. `childEnv` (`src/runners/node-test/run/run.ts`) now puts the module
   recorder first in the `NODE_OPTIONS` of every node:test project. Before,
   it did so only for a slow project or when the project's `NODE_OPTIONS`
   held a `--require`; otherwise the recorder was only in argv, which no
   child inherits.
2. A spawned Node inherits `NODE_OPTIONS`, loads the recorder, and writes
   `graph-<index>-<pid>.ndjson` beside the test file's own graph. The
   recorder's `SQUEAL_NODE_TEST_STARTED` mark (row 003-40) makes the child
   mark no preload phase, so `observedClosure` gives its loads to the test
   file and puts them in `direct` (016 D4, row 007-56). The core keys them,
   and `squeal reach` shows them as "child process".
3. The test file's own process and the `node --test` parent still get the
   recorder as the first argv `--require`. Node loads the same file once per
   process (checked on Node 22.19, 24.21 and 26.13: `--require` and
   `--import` of one `.cjs` print one load).
4. `signed` now passes `inNodeOptions: true`, because every run puts a
   recorder in `NODE_OPTIONS`.

## The option form: a decision the spec did not settle

D12.6 says "through `NODE_OPTIONS`, as Vitest's does". The first edit used a
`--require` for every project. It broke the cezar-shaped fidelity case
(`run-reads-fidelity.test.ts`): a `--require` in `NODE_OPTIONS` makes a
spawned Node parse the nearest `package.json` from its cwd, and one that is
not JSON stops the child (task 001-390). The slice therefore uses Vitest's
rule, `recorderOption` (`src/runners/observe/runtime.ts`):

| Project | Recorder in `NODE_OPTIONS` | A child's own argv `--require` loads |
|---|---|---|
| not slow, no `--require` in its `NODE_OPTIONS` | `--import file:<recorder>` (new) | not recorded: they run before an `--import` |
| its `NODE_OPTIONS` holds a `--require` | `--require <recorder>` (as before) | recorded |
| slow | `--require <recorder>` (as before) | recorded |

Costs of the `--import` form, both as for Vitest's recorder:

- A test that spawns a Node before 18.18 fails, because that Node rejects
  `--import` in `NODE_OPTIONS`. The failure carries the recorder signature
  "Node before 18.18 rejects its --import" in its summary.
- What a child's own argv `--require` preload loads is not keyed. Board row
  001-402 (planned) proposes a spawn patch in the node:test recorder that
  chooses the form per child, as `src/runners/observe/spawn.cjs` does.

A slow project keeps its `--require`, so nothing changes for it. Making slow
projects use the same rule would fix the `package.json` case for them and
lose the child's own `--require` loads; that is 001-402's question.

## Coverage links (row 018-38, from the 018 coordinator 3739e45a)

Nothing changed in `coverage.ts`. In the test file's process the recorder
deletes `SQUEAL_NODE_TEST_COVERAGE` and either deletes `NODE_V8_COVERAGE` or
points it at `<link>/children` before any test code runs, so a child sees
only the link's path. `run-children.test.ts` checks this: with
`coverage.children` the child's `NODE_V8_COVERAGE` is
`<tmpdir>/squeal-coverage-*/cov-0/children` and its file lands in the log
folder through the link; without it the child sees no coverage variable; a
child that removes the store as its last act leaves no store made again, and
the run stores nothing (the run mark check in `run.ts` is unchanged).

## Tests

- `test/runners/node-test/adapter-attribution.test.ts`: the fast-project
  spawn case now expects the CLI's loads keyed and no bare-file note (it
  replaces "observes nothing past the spawn").
- `test/runners/node-test/child-daemon.test.ts` (new): G6 under a real
  daemon with `coverage.children`; `reach` names the test file through a
  "child process" route.
- `test/runners/node-test/run-children.test.ts` (new): the coverage-link
  checks above.
- `test/runners/node-test/run-reads-fidelity.test.ts`: the cezar-shaped case
  still passes, now with the child's module load keyed; the old-Node case
  now fails with the signature in both runs.
- `test/kit/packs/node-test.ts`: the listed K10 gap for fast projects closed
  (UNEXPECTED PASS), so it is unlisted.
- `test/keys/validity/cases/adapter/node-test.ts`: the case that stands for
  `NODE_TEST_ADAPTER_VERSION` 12. Its test reads its child's own graph file.
  The child runs a module that the test file also imports, so the keys stay
  equal at both trees and the stored outcome differs (fail at 0.1.451, pass
  now), which the verdict requires of a raise. A case where only the child
  loads a module would change the keys, and a case with different keys does
  not count as a differing case.

## For the next worker

- `plugins/claude-code/dist` was not rebuilt (not this row's). The bundle
  tests fail until the coordinator rebuilds it. The e2e test
  `test/e2e/slow-node-test.test.ts` is unaffected (a slow project);
  `test/e2e/node-test.test.ts`'s fixture spawns no process.
- The bare-file note's wording ("what they reach through a spawned process
  … enters no key") is still true for a non-Node child and for file reads;
  it was not changed.
