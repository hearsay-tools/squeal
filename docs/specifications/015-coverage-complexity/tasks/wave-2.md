# Wave 2: coverage and CRAP

Wave 2a dispatches after 0.1.293 (013-07, 015-18) is on main: W1, W2 and R3 run in parallel on disjoint seams. W1 and W2 are bundle changes and land as one candidate after a review. Wave 2b (015-12, CRAP and "no test runs it") is briefed once W1's record shape and R3's answer are in.

## W1: 015-11, Squeal's coverage provider and the records

Use /worker. Shape: slice. Outcome: with `coverage.enabled`, each Vitest run Squeal makes anyway leaves one coverage record per test file in the code store, keyed with the test file's result, with no extra run, no project package and no report.
- Read spec D1 (`coverage.enabled`), D4, D8 and D10, goals 9 and 10, `research/coverage-collection.md` (Q1, Q4, Q5 and the recommendation) and its probes, and 013-07's notes.
- **Seam.** `#start` in `src/runners/vitest/adapter.ts`, where 013-07 passes `coverage: { enabled: false }`: with the policy on, pass D8's `provider: "custom"` options instead. The provider's worker side takes V8 precise coverage through `node:inspector`; its main side keeps each test file's payload. Map it through the transform's source map to lines and function ranges outside the scheduler's path, and store D8's record in the code store (a new table) at the result key plus a provider version, adopted with the result (011-23) and pruned with it (C7).
- **Fidelity.** A test file whose closure imports `node:inspector` or `inspector` runs with coverage off, and status names it. `isolate: false` projects run with coverage off, with one note.
- **Owns.** `src/runners/vitest/**`, a new `src/core/code/coverage/**`, the code store schema for the record, the policy key, and their tests. Leave `src/core/code/count/**` to W2.
- **Done when.** Goal 9's cost on the research's 30-file sample, five alternated off/on pairs with the one-minute load beside each; goal 10 (the research's `self-coverage.test.ts` passes with coverage on, and status names it); a second worktree adopts a record with its result; policy off is byte-identical and opens no code store. Lint, typecheck and `squeal run --all --wait` pass (bundle drift expected); paste the output. Do not build bundles or raise the version.

## W2: 015-29, `import(...)` in a type argument parses

Use /worker. Shape: slice. Outcome: the counter parses `typeof import("x")` and `import("x").T` in a type argument, and every function in such a file counts as ESLint counts it.
- Read the row 015-29, `research/typeof-import.md` (r2) and its probes, spec D3, and `tasks/015-23/notes.md` (the NUL rewrite that keeps offsets).
- **Seam.** Before the TSX parse in `src/core/code/count/parser.ts` or `typescript.ts`: replace each `import("x")` that follows `typeof `, `<` or `,` with underscores of the same length. The walk and the body hashes read the file's own text. Raise `COUNTER_VERSION` to 3.
- **Owns.** `src/core/code/count/**` and `test/code/count/**`. Leave `src/runners/**` and the store to W1.
- **Done when.** The row's fixtures: the two misparses count like ESLint, and the same text in a string, a comment and a template literal is untouched. Lint, typecheck and `squeal run --all --wait` pass; paste the output. Do not build bundles or raise the version.

## R3: open question 3, code that tests reach only through child processes

Use /researcher, with the rules in `research/README.md`. Outcome: how many of this repository's `src/` functions no in-process Vitest test runs while a test that spawns a child process does, so that they would read "no test runs it" under D9.
- Questions: (1) the functions in `src/` that in-process coverage never runs, from one coverage run of the whole suite in a scratch copy under `/tmp` with `@vitest/coverage-v8` added there only; (2) of those, the ones that a child-process test reaches (the CLI, the daemon, hooks; `test/e2e/**` and tests that spawn `squeal`), and how that can be known without coverage of the child; (3) what D9 should do with them: `unknown`, a project setting, or child coverage through `NODE_V8_COVERAGE`, with its cost.
- Own `research/child-processes.md` and `probes/child-processes/`. One full-suite run in the scratch copy is allowed, under `flock /run/user/$(id -u)/squeal-full-run.lock`, at `--maxWorkers=4`.
