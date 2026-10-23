# Research brief 015-01: coverage from Squeal's own runs

Use /researcher. Shape: research. Outcome: whether Squeal can collect coverage per test file from the runs it already makes, at what cost, without changing a verdict, and store it by key so that other worktrees reuse it. Follow the rules in `README.md`.

Read first: 011 C3 (keys and closures), C4 (result validity), C7 (shared store), C10's **Fidelity** paragraph, C12 (the runtime-input recorder), and 011-23 on the board (adoption of another worktree's result); `src/runners/vitest/adapter.ts` (`#start`, the `createVitest` options), `src/runners/vitest/reporter.ts`, `src/runners/observe/recorder.cjs`; 003 D5 and 007's runner sections for node:test and pytest.

Questions:

1. **Vitest.** At this repository's Vitest (5.0.x), can the warm instance collect coverage with the v8 and the istanbul providers, both when the project config has no `coverage` section and when it has one (enabled, `thresholds`, `include`)? Can a threshold change the state Squeal reads? Can coverage be had per test file, not merged per run: the provider API, `takeCoverage`, or the recorder starting `node:inspector` precise coverage in each process? Verify on a fixture.
2. **Mapping.** From v8 ranges on transformed code to source lines and functions of a TypeScript file: what a per-function record holds (name, range, hits, branches), and whether its paths are stable across worktrees.
3. **node:test and pytest.** Per-test-file coverage as Squeal drives them (`NODE_V8_COVERAGE`, `--experimental-test-coverage`; coverage.py contexts). Docs and source; an experiment only if cheap.
4. **Cost.** Wall time, CPU and memory, off against v8 and against istanbul, on 20 to 40 of this repository's test files; bytes of one test file's record, and an estimate for about 950 files.
5. **Fidelity.** Can a test tell coverage is on (instrumented code, `globalThis.__coverage__`, an inspector a test uses itself, timing)? Known cases where coverage changes a verdict.
6. **Sharing.** Is a test file's coverage a function of the closure its key hashes, so it can be stored at that key and adopted? How a source's coverage is assembled from current test files, and how to state it when some of them are stale or unknown.
7. **Selection** (secondary). With per-test-file line coverage, how many runs over a few recent commits of this repository would a line-level selection skip against the file closure? Estimate only if cheap; else name the method.

Own `coverage-collection.md` and `probes/coverage-collection/`.
