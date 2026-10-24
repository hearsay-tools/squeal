# 015-25: `typeof import` in a type argument

Brief: `typeof-import-brief.md`. Researcher, 2026-10-24. Evidence: tree-sitter-tsx 0.23.2 (the shipped WASM, and a build of `v0.23.2` with the same toolchain as the PR), a build of tree-sitter-typescript pull request 375, and four read-only checkouts: squeal at `55afb856a` and `d5018817a`, cezar at `cf9df51a9` (its `origin/main` today) and `03c905a00`. Each JS/TS file was counted by this worktree's counter, with three rewrites and over the PR's grammar, and compared with ESLint 10.13.0 `complexity` on `@typescript-eslint/parser` 8.72.0. Host load was 10 to 52. Probes and outputs: `probes/typeof-import/`.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | The grammar | 0.23.2 reads `f<typeof import("x")>(…)` as the comparisons `(f < typeof import("x")) > (…)`. With empty arguments the `>()` goes into an `ERROR`; with arguments there is no error at all. `f<import("x").T>()` fails the same way. Upstream issue 367 (open) reports it. Pull request 375 (open, no review) fixes the `typeof` shape only. No release after 0.23.2 (2024-11-11); master has no grammar change since. | verified by experiment, read in source code |
| 2 | A narrow rewrite | Yes. Before the TSX parse, replace each `import("x")` that follows `typeof `, `<` or `,` with underscores of the same length (r2). Every UTF-16 offset and line stays. It changes no function's count in 3,880 files. It costs 0.012 ms per file, 0.3% of a count. | verified by experiment |
| 3 | Measure | Functions in a parse error, shipped to r2: squeal 19 to 0, cezar 285 to 0. ESLint agreement per file: squeal 1,962 of 1,962 before and after; cezar 1,917 to 1,918 of 1,918. | verified by experiment |
| 4 | The two counts | `squeal code` never counts a test file a runner lists. Every misparse is in such a file. The dogfood's 1 function is cezar's NUL in `git-worktree.ts` (fixed in 0.1.292). The probe's 70 counted every file. `composer.test.tsx`: `React.createRef<import('./composer').ComposerHandle>()` with no semicolons. | verified by experiment, read in source code |

## Findings

### 1. The grammar

The trees are in `probes/typeof-import/snippets.out.txt`; the PR's trees are in `snippets.pr375.out.txt` (verified by experiment, 0.23.2 shipped WASM; my own 0.23.2 build gives the same tree on every snippet and on all 7,732 files).

- `await importOriginal<typeof import("./x.js")>()` gives `binary_expression(await importOriginal < unary_expression(typeof, call_expression(import, "./x.js")))`, then `ERROR(">", formal_parameters "()")`. The `()` is read as the start of an arrow function's parameters.
- With non-empty arguments the misparse is silent: `vi.importActual<typeof import("x")>("x")` is `binary_expression(binary_expression(… < typeof …) > parenthesized_expression)`, and `hasError` is false. Two cezar test files have it. Their counts still equal ESLint's.
- These fail too: `f<typeof import("x").Y>()`, `f<typeof import("x"), string>()`, `f<import("x").T>()`, `f<typeof import ("x")>()`. These parse: `f<Awaited<typeof import("x")>>()`, `new Foo<typeof import("x")>()`, `f<{ a: typeof import("x") }>()`, `f<typeof X>()`, and `typeof import("x")` in a type alias, an annotation, `as` and `satisfies`.
- Without semicolons, error recovery can grow. In `composer.test.tsx` the root itself becomes one `ERROR`. Issue 367 shows the same thing.

Upstream (read in source code, GitHub, 2026-10-24):

- Issue 367, "`typeof import('m')` fails as the first type argument of a call expression", opened 2026-08-29, open. A comment adds the silent case and the whole-file recovery.
- Pull request 375, "fixes #367", 2026-10-15, open, no review, no checks. It adds a precedence `type_query_call` above `call` to `_type_query_call_expression` (3 lines in `common/define-grammar.js`).
- `npm view tree-sitter-typescript`: latest 0.23.2. The GitHub releases list v0.23.2 as the latest. Master is `75b3874` (2025-01-30), with no grammar change after the tag.

Pull request 375, built and run (verified by experiment): it parses every `typeof import` shape above. Over 3,880 files at the two heads, its tree differs from 0.23.2 only in files that contain `typeof import`. It does not fix `f<import("x").T>()`, so `composer.test.tsx` still has one error over 215 functions.

### 2. A narrow rewrite

Three rewrites keep every UTF-16 offset and every line break. The walk gets the file's own text, as `withCodeTree` does for NUL, so body hashes are unchanged.

| Rewrite | What changes | Fixes |
|---|---|---|
| r1 | The `i` of `typeof import(` becomes `_`: a type query of a call of an identifier | The `typeof` shapes, not `import("x").T` |
| r2 | `import("x")` after `typeof `, `<` or `,` becomes one identifier of underscores: `typeof ____`, `____.T` | Both shapes |
| r3 | Every `import("x")` with a plain string becomes underscores | Both shapes |

`import("x")` here means `import`, optional spaces or tabs, `(`, one `'…'` or `"…"` string with no line break, backslash, `$` or backtick, `)`. With no line break in the match, line numbers stay. `"_".repeat(m.length)` keeps the UTF-16 length.

Cases the rewrite must not change, and what r2 does:

- **Strings.** A match inside a string stays inside that string. It cannot contain the string's own quote. The only effect: a quoted key that contains `<import("x")` gets another name, because `nameOf` reads the parse input. r2 changed 0 sites in strings, comments or templates in the four checkouts. r3 changed some in each repository (squeal: 1 string, 9 templates; cezar: 1 string, 3 comments, 2 templates). r1 changed 1 comment and 2 templates in cezar.
- **Comments, JSX text, regex literals.** These stay one token. The counter reads no text from them.
- **Template literals.** The match excludes `$` and backticks, so it cannot open or close a substitution.
- **Dynamic `import("x")` in code** (r3, and r2 after a `,`). This becomes an identifier. An `import()` call holds no function and no decision point, and `calleeName` reads `then` from `import("x").then(cb)` either way. Measured: 0 changed functions.

Measured over all four checkouts (verified by experiment, `out-*.md`): r2 and r3 change no function's name, occurrence, count or start line, except in `composer.test.tsx`. In that file, shipped and r1 lose 2 functions and misname 73 from line 792 on (they lose the `<describe>.` scope). r2 gives the 217 functions ESLint reports. Every site r2 changed is in code.

Cost (verified by experiment, `cost.out.txt`): 3,942 files from squeal and cezar, five alternated pairs at load 10 to 30. The median parse and walk is 3.77 ms per file without r2 and 3.88 ms with it; the noise between pairs is ±20%. r2 itself takes 0.012 ms per file (44 to 61 ms over all files), with an `includes("import")` guard first.

### 3. Measure

Each file was compared by the multiset of its function counts with ESLint's on the same file (`analyze.mjs`). The file set is 015-23's: git-listed JS/TS outside `docs/`, `fixtures/` and `dist/`, `build/`, `vendor/`.

| Checkout | Way | Files with errors | Functions in errors | Functions (ESLint) | Files equal to ESLint |
|---|---|---|---|---|---|
| squeal `55afb856a` | shipped | 14 | 19 | 30,848 (30,848) | 1,962 / 1,962 |
| | r1, r2, r3, PR 375 | 0 | 0 | 30,848 | 1,962 / 1,962 |
| cezar `cf9df51a9` | shipped | 66 | 285 | 55,888 (55,890) | 1,917 / 1,918 |
| | r1, PR 375 | 1 | 215 | 55,888 | 1,917 / 1,918 |
| | r2, r3 | 0 | 0 | 55,890 | 1,918 / 1,918 |

At `d5018817a` and `03c905a00` the numbers are the same shape (squeal 14 and 19 to 0; cezar 66 and 285 to 0, 1,913 to 1,914 of 1,914).

In squeal the misparse changes no count: the files equal ESLint before the fix. Its only effect is 19 functions marked `unknown`. In cezar the same holds for the 65 `typeof import` files. `composer.test.tsx` is the one file whose counts and names are wrong.

In the files `squeal code` counts (test-named files left out), there are 0 errors in every checkout and every way. The `typeof import` sites there (squeal `parcel-backend.ts` and `vitest/load.ts`) are type aliases, which parse.

### 4. The two counts

- `src/core/code/pass/included.ts` (read in source code, `55afb856a`): a path is not counted when it is one of the runners' test files.
- All 66 cezar error files are `packages/{cezar,web}/src/**/*.test.ts(x)`. The vitest projects list them (`include: ['src/**/*.test.ts']`, and `{ts,tsx}` for web). All 14 squeal error files are `test/**/*.test.ts`, inside `vitest.config.ts`'s `include` (verified by experiment, path match against the configs).
- The released 0.1.284 counter (`git archive squeal--v0.1.284 src`), over files that are not test-named (verified by experiment, `count-0.1.284.out.txt`): cezar `03c905a00` has 1 error file, `packages/cezar/src/git-worktree.ts`, with 1 function. That is `lessons.md`'s "1 function in a parse error", the NUL. squeal `d5018817a` has the 3 `export type *` barrels with 0 functions. `lessons.md`'s fourth file, `test/fixtures/node-test/edge/test/syntax.test.ts`, is test-named but no runner lists it.
- 015-23's probe counted every git-listed file, test files too. That gives 65 `typeof import` files with 70 functions, plus `composer.test.tsx` with 215.
- My counts of not-test-named files (927 cezar, 1,082 squeal) are under the dogfood's 944 and 1,204. The difference is test-named files that no runner lists, such as fixtures (66 in squeal's `fixtures/`). None of these fixtures holds `typeof import`.

## Recommendation for Squeal

1. **Use r2 in `withCodeTree`, for the TSX parse only, beside the NUL replacement.** It fixes both shapes: 285 functions in errors to 0 in cezar, 19 to 0 here. Every file then equals ESLint. It costs 0.3% of a count. (Q2, Q3.)
2. **Raise `COUNTER_VERSION` to 3.** `composer.test.tsx`'s names and counts change, so a stored count from version 2 is wrong. (D3.)
3. **Do not wait for upstream.** Pull request 375 is unreviewed. It does not fix `import("x").T`. No release has come since 2024-11. When a release fixes both shapes, update the WASM and drop r2, as the counter's README says for `export type *`. (Q1.)
4. **Tradeoff.** Today no file that `squeal code` counts in either repository has the misparse (Q4), so accepting it costs these two repositories nothing. Test files are left out by D1. A `vi.mock(…, importOriginal)` in a setup file, a `__mocks__` file or a test helper would be counted, and it would read as `unknown`. It is r2 (about ten lines and a regex per file) against that risk for other repositories. I recommend r2. The count gets right in every file measured, and the cost is small.

## Open questions

- A tree-guided rewrite (find the misparse in the first tree, rewrite only those `import` nodes, parse again) would leave quoted keys alone. It costs a second parse in each affected file. Not measured.
- Other repositories: how many non-test files hold this idiom (setup files, mocks, helpers)? Not measured. Only squeal and cezar were read.
- Python has no such gap; not examined beyond 015-23's notes.

## Sources

- tree-sitter-typescript: https://github.com/tree-sitter/tree-sitter-typescript, `v0.23.2` (`f975a62`), master `75b3874`; `common/define-grammar.js` (`call_expression`, `type_query`, `_type_query_call_expression`).
- Issue 367: https://github.com/tree-sitter/tree-sitter-typescript/issues/367. Pull request 375: https://github.com/tree-sitter/tree-sitter-typescript/pull/375 (`2890bf7`).
- npm: `npm view tree-sitter-typescript` (latest 0.23.2, 2024-11-11), 2026-10-24.
- tree-sitter-cli 0.27.1 (`tree-sitter build --wasm`). web-tree-sitter 0.27.1 (this worktree).
- ESLint 10.13.0 `complexity` rule, `@typescript-eslint/parser` 8.72.0, TypeScript 6.0.3.
- Squeal at `55afb856a`: `src/core/code/count/{parser,typescript,walk,index}.ts`, `src/core/code/pass/{included,judge}.ts`, `src/core/code/count/README.md`; `tasks/015-23/notes.md`; `lessons.md` "Setup" and "Parse errors"; release `squeal--v0.1.284`.
- cezar: `/home/agent/projects/cezar`, cloned read-only to `/tmp`, at `cf9df51a9` and `03c905a00`; `vitest.config.ts` and `packages/*/vitest.config.ts`.
