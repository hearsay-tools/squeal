# Wave 1.5: repair of the wave 1 candidate (review `reviews/0.1.348.md`, FAIL)

Two resumed workers in parallel, on disjoint folders, both from `int/017-w1` at this file's commit. First step for each: `git status` must be clean, then `git reset --hard <this commit>` (your earlier commits are in it, cherry-picked, beside your sibling's and the integration commit `c63cd9a61`). Read the review first. D5 is amended at this commit: read it as written. No `npm run build`, no full suite, no `squeal run --all`; `squeal stop` before you finish. Commit everything; report commands and real results.

## R1 (worker 8f337351): B1, and B3 at the pass

Use /worker. Shape: repair. Owns `src/core/lint/pass/**`, `test/lint/pass/**`, and new `test/lint/integration/b1.test.ts`.

1. B1: build the program segment as D5 now says: the listing's paths, the blobs of every listed file with a module extension, independent of `lint.include`, `lint.exclude` and ESLint's ignores; the provider's program files outside the listing; tsconfigs; TypeScript's version. The policy selects checks and results only.
2. B3 at the pass: a report whose closure or program names an input the part's keys did not hold stores nothing under those keys; the part's files are keyed again with the report's environment and go back to pending (or stale), never `pass` at the old key.
3. Tests, red first: the review's B1 reproduction with the real provider (`test/lint/provider/helpers.ts` `project()`, read only), for `exclude` and `include`; an import target that ESLint ignores in a JavaScript project; the B3 store rule with a fake provider.

## R2 (worker 2e373245): B2, and B3 at the provider

Use /worker. Shape: repair. Owns `src/core/lint/provider/**`, `test/lint/provider/**`, `test/fixtures/lint/**`, and new `test/lint/integration/b3.test.ts`.

1. B2: report every file the TS config loader reads (jiti or Node's own type stripping) in `closure`, and always the declared config files themselves. If a load cannot be observed, return `{ off: <reason> }`, never a closure that omits it.
2. B3 at the provider: `refresh()` reports the complete program before any lint: root files plus the files their imports resolve to (TypeScript's module resolution, no type check). State its cost on this repository's own tsconfig in `tasks/017-04/notes.md`.
3. Raise `PROVIDER_VERSION` to 2 (the one key-version change of this wave).
4. Tests, red first: the review's B2 reproduction (a local TS rule edit with unchanged plugin metadata, then the root TS config's inline rule code); the review's B3 two-worktree reproduction in `test/lint/integration/b3.test.ts`, with the real provider and pass.

Done when the review's three reproductions are tests that pass, `test/lint/` passes, lint and typecheck are clean, and key-format passes.
