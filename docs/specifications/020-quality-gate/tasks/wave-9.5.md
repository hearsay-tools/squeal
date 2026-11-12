# Spec 020 wave 9.5: repair of review 0.1.443

## 020-26ab R1: an inspector-use fact that does not depend on coverage mapping

Use /worker. Shape: repair, on the candidate branch `w9/int`.

Outcome: B1 of `reviews/0.1.443.md` is fixed: whenever any coverage provider ran (D19.6), `ci export` leaves out every test file that used `node:inspector`, including `process.getBuiltinModule("node:inspector")` and a helper module that imports it, also when Squeal yielded to the project's provider.

Read: `reviews/0.1.443.md` (B1, its reproduction and its one-worker fix); spec D13.4, D19.6; `tasks/020-26ab/notes.md`.

Starting seam: the review's clean reproduction (a custom provider that re-exports `@vitest/coverage-v8`, so `ci record` yields; four fixture tests) as a failing test. Then record an inspector-use fact per test file in the part independently of coverage mapping, in the `ci record` runtime, and have `ci export` read it before it treats a file's results as reusable. Keep the static closure check as extra evidence.

Owns: `src/runners/vitest/ci-runtime/*`, `src/runners/vitest/ci-coverage.ts`, `src/core/ci/{parts,export-check,export}.ts`, their tests.

Rules: the part format changes only additively, and readers of older parts behave as today. If complete attribution cannot be proved on a yielded part, the part says so and `ci export` refuses the uncertain files rather than exporting them. Keys unchanged. Do not run `pnpm run build` or a full suite.

Done when: the reproduction passes with all four forms left out, the literal `import()` and `require()` controls stay left out, the wrap-active case keeps its `noRecord` marks; `test/core/ci`, `test/runners/vitest/ci-record*`, `test/keys/key-format.test.ts` pass; lint and typecheck are clean.
