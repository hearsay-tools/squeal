# Probes for 015-76: coverage under node:test

Throwaway. Written for `../../node-test-coverage.md` (row 015-76) and not maintained. Every run used `HOME=/tmp/r-015-76/home`, wrote only under `/tmp/r-015-76/`, and started no daemon and no agent session. `/tmp/r-015-76/node_modules` was a symlink to this worktree's `node_modules`, so `tsx` resolves for the copied fixtures. Versions: Node 24.21.0 and 22.23.3, tsx 4.23.15 (esbuild 0.28.2) from this repository's lockfile, this repository at b062c9832.

| File | What it is |
| --- | --- |
| `fixture/` | A node:test package: `src/shapes.ts` needs a transform (an `enum`, a class with `#private` and an arrow field), `src/plain.ts` only stripping; `test/shapes.test.ts` also spawns `src/child-main.ts` with an explicit `env` that holds no `NODE_V8_COVERAGE`; `test/env.test.ts` prints what a test sees of the variable. Copied to `/tmp/r-015-76/work/fixture` before each run. |
| `run-file.mjs` | Runs one test file with Squeal's own command line (`src/runners/node-test/run/run.ts`): `--enable-source-maps`, the recorder as first `--require`, the project's argv, `--test`, Squeal's reporter. Mode `raw` sets `NODE_V8_COVERAGE`; mode `event` adds `--experimental-test-coverage`. `NTC_NODE` picks another Node. |
| `drop-env.cjs` | A `--require` that deletes `NODE_V8_COVERAGE` from `process.env` in the test file's own process (where the runner set `NODE_TEST_CONTEXT`). |
| `map.ts` | Maps one run's raw files through Squeal's `mapScript` and joins them to Squeal's counted functions with `joinCoverage`, four ways: A the file on disk as the executed code; B the payload's `source-map-cache` map over blank lines of its `lineLengths`; D as B with `mapScript`'s closing-punctuation rule read in the source. Prints the `test:coverage` event of an `event` run beside them. Its "test pid" guess (the graph file with an unmarked parentless edge) is wrong when a `--require` is an absolute path, as in the `drop` runs: the recorder ends its preload marking early there. |
| `sample.tsv` | Q4's 34 files: 30 of `gen-big.mjs`'s 200 test files (every sixth), the 3 of `reference/packages/demo`, and `spawn-cli/test/cli.test.mjs`. |
| `bench.mjs`, `bench-loop.sh`, `summarize-bench.mjs` | Q4: runs the sample at 4 processes at once in mode `off`, `raw`, `drop` or `event`; the loop rotates the modes over 5 rounds and starts a run only while the one-minute load is at most 24. |
| `map-cost.ts` | Q4: per test file, bytes, parse and map time on one thread, and the compact record's size. |
| `join-rate.ts` | Q2 at scale: how many (test file, function) pairs of a `drop` run join as ran, not run, or unknown. |
| `cross-check.ts` | Q2 at scale: the join of a `drop` run against the `test:coverage` event of an `event` run, per function by path and start line. |
| `out/` | The outputs the findings quote. Paths in them are under `/tmp/r-015-76/`. |

Reproduce (from the worktree root, with `export HOME=/tmp/r-015-76/home`):

```sh
P=docs/specifications/015-coverage-complexity/research/probes/node-test-coverage
mkdir -p /tmp/r-015-76/work && ln -sfn "$PWD/node_modules" /tmp/r-015-76/node_modules
cp -a $P/fixture /tmp/r-015-76/work/fixture
node test/fixtures/node-test/gen-big.mjs /tmp/r-015-76/work/big
cp -a test/fixtures/node-test/reference test/fixtures/node-test/spawn-cli /tmp/r-015-76/work/
F=/tmp/r-015-76/work/fixture
node $P/run-file.mjs raw $F test/shapes.test.ts /tmp/r-015-76/out/shapes-raw --import tsx
node $P/run-file.mjs event $F test/shapes.test.ts /tmp/r-015-76/out/shapes-event --import tsx
node --import tsx $P/map.ts /tmp/r-015-76/out/shapes-raw $F /tmp/r-015-76/out/shapes-event
node $P/run-file.mjs raw $F test/shapes.test.ts /tmp/r-015-76/out/shapes-drop --require "$PWD/$P/drop-env.cjs" --import tsx
$P/bench-loop.sh /tmp/r-015-76/work /tmp/r-015-76/bench /tmp/r-015-76/bench.txt 5 4
node --import tsx $P/map-cost.ts /tmp/r-015-76/bench/drop-0 /tmp/r-015-76/work drop
node --import tsx $P/join-rate.ts /tmp/r-015-76/bench/drop-1 /tmp/r-015-76/work
node --import tsx $P/cross-check.ts /tmp/r-015-76/bench/drop-1 /tmp/r-015-76/bench/event-1 /tmp/r-015-76/work
node $P/summarize-bench.mjs /tmp/r-015-76/bench.txt
```
