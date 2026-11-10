# Spec 020 wave 4: the counter fix and two design surveys

Approved by the human on 2026-11-10: "More rows: 020-14 counter fix, gh-172 server-only selection, gh-174 build-wrapper helpers". gh-172 becomes row 020-15 and gh-174 becomes row 020-16.
- 020-14 builds now.
- 020-15 and 020-16 start with a read-mostly design survey each. Their build rows follow from the surveys.

Every build row:
- Read `docs/specifications/020-quality-gate/spec.md`.
- Do not run `pnpm run build` or a full suite.
- Before you finish, read `squeal status --wait 60000 <changed paths>`, and run `pnpm run lint` and `pnpm run typecheck`. The four bundle-drift packaging tests are expected to fail.

## 020-14 the counter reads an `import("x")` type followed by `[]`

Use /worker. Shape: repair.

Outcome: `src/core/lint/provider/oxlint/configs.ts` counts with no error range, because `let entries: import("node:fs").Dirent[]` parses.

Read: spec 015 D3; `src/core/code/count/parser.ts` (`withTypeImports`, the 015-29 rewrite, and 020-12's template-escape pass); `src/core/code/count/README.md` ("Gaps of 0.23.2").

Starting seam: a failing test in `test/code/count/` with the smallest `let x: import("m").T[]`, plus the real `configs.ts`. Lead: extend the type-import rewrite so it covers an `import("x")` type in any type position, including before `[]`, `<…>` and `.`. Keep every offset.

Done when:
- comparing this repository's 3,000+ JS/TS files counted before and after shows that only the targeted error ranges go away, and every other function keeps its CC, body hash and range;
- `COUNTER_VERSION` is raised only if counts change, and your final message says so.

Owns: `src/core/code/count/`, `test/code/count/`.

## Surveys

Use /researcher. Shape: survey. Read-mostly on the product. Each survey owns only its findings file and `probes/<topic>/` under `docs/specifications/020-quality-gate/research/`. The budget is about 90 minutes. Skip any live probe while the one-minute load is above 24, and record the load beside every timing. Write nothing in `~/projects/cezar`; probe there only in a scratch copy under `/tmp`. Each survey ends with a design proposal for a new spec section and a row split: files, an order, and tests per row.

### survey-020-15 server-only selection and pre-setup visibility (#172)

Start from `015-coverage-complexity/research/issue-172.md`. Questions:
1. What selection contract should `squeal code --base` support? Explicit scope, for example `--project`, `--group` or `--only-tests`. Replacing automatic selection rather than adding to it. Manual groups (019 D1/D6).
2. How does the report state its scope, so it never claims global completeness from selected evidence (spec 015 D9, 020 D5)?
3. Can the selection be printed before any setup starts? Cover Vitest's `initializeGlobalSetup`, which includes the root project.
4. Can a server-only selection avoid starting browser setup? When it cannot, should it explain the shared setup before starting it?
5. Reproduce #172's cezar case in a scratch copy, if the load allows.

### survey-020-16 measuring helpers behind a build wrapper (#174)

Start from `research/issue-174.md`. Questions:
1. Can the gate collect coverage through a project's own wrapper command (`npm run test:package -- <file>`) with Squeal's provider? Look at `ci record`'s hook (020-08a), which already wraps a project command.
2. How is the coverage attributed to the changed test functions and helpers?
3. What should the gate say, before collecting, when a helper's only loader is a wrapper it cannot drive?
4. How is a wrapper declared in `squeal.config.json`, read at the base?
5. What does it cost, for example on cezar's `binary-names.test.ts` in a scratch copy, if the load allows?

The answers must not turn a wrapper's pass into coverage, and must not require deleting assertions.
