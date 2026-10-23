# 015-05 notes: the counter

Worker a9b595a0, 2026-10-24. What 015-06 (the pass), 015-07 (delivery), 015-08 and wave 2 need from the counter, and the choices the spec left open.

## Seam map

| What | Where |
|---|---|
| `countFile(text, language, blob?)`, `COUNTER_VERSION` (1), `counterReady()` | `src/core/code/count/index.ts` |
| The walk: frames, scopes, occurrences, body hash, ranges, error ranges | `src/core/code/count/walk.ts` (`countTree`, `CountRules`) |
| ESLint's classic rules and D2's naming for TS and JS | `src/core/code/count/typescript.ts` |
| radon 6.0.1's rules for Python | `src/core/code/count/python.ts` |
| Grammars: one runtime per process | `src/core/code/count/parser.ts`; the TSX grammar is found by `wasm.ts` |
| The vendored grammar | `src/core/code/count/tree-sitter-tsx.wasm`, `README.md` (version, URL, sha256) |
| Build | `copyCodeGrammar(outdir)` in `src/harness/build.ts`, called by `buildDist` and by `buildOpencodeDist` (coordinator agreement): `<plugin>/dist/code/tree-sitter-tsx.wasm` |
| References | `test/fixtures/code/` (README: how to make them again), tests in `test/code/count/` |

## What the pass must know

- **Signature.** `countFile(text, language, blob?)`. The third argument is additive: `FileCount` needs a blob, and `(text, language)` cannot know the repository's object format. Pass the blob id the pass looked up. Without it, the count's blob is the SHA-1 git blob id of the text's UTF-8 bytes, which is right for a SHA-1 repository whose file is valid UTF-8 without a BOM.
- **One runtime.** `Parser.init` is not idempotent in web-tree-sitter 0.27.1: a second call replaces the runtime under every parser already made. `counterReady()` therefore calls the pytest graph's `pythonParserReady()`, which inits the runtime and loads the shipped Python grammar, and then loads the TSX grammar. Python is parsed through `withPythonTree`. Any new tree-sitter user in the daemon must go through `pythonParserReady()` too.
- **Errors.** `FileCount.errors` lists the outermost `ERROR` nodes and the `MISSING` nodes. Every function the parser found is still listed and counted; D3's `unknown` is the pass's to apply to a function whose range meets an error range. A missing node is zero-width (`start == end`).
- **Columns** are UTF-16 code units, 1-based, the end just after the last character: what V8's coverage ranges use for wave 2's join.
- **Range** is the function node's: an arrow from its parameters, a method from its name (decorators are outside), a Python `def` from `def` or `async`. Wave 2 joins on the body start (`complexity-and-crap.md` 4); `FunctionCount` has no body range yet, so wave 2 adds one (an additive field) and raises `COUNTER_VERSION`.
- **Cost**, this host, load 35 to 38 on 24 CPUs, warm, median of 5 passes per file: `src/` (605 files, 3.5 MB) median 1.62 ms, p90 5.08, p95 6.29, p99 10.07, max 24.7 (`scheduler.ts`, 49 KB). Every included file of the repository by D1's defaults (1,485 files, 6.0 MB, `docs/` probes included) median 1.06 ms, p95 5.11 ms, and the first count 3.1 s of CPU. Start: 36 to 57 ms for both grammars, then 24 to 47 ms for the first file. Python alone: 289 files, 0.6 s of CPU. Roughly half is the parse, half the walk.

## Decisions the spec left open

1. **ESLint's code paths that are no function.** A class field initializer (`x = a ?? b`) and a static block are code paths of their own in ESLint, reported as "Class field initializer" and "Class static block". They are no function here: their decision points are dropped, and a function inside them (`field = () => …`) is counted on its own, named by the field. The stored ESLint counts leave both out.
2. **radon's gaps are kept**, so the number is radon's: `except*` (a `TryStar`, which radon 6.0.1 does not match) adds nothing, nor does its `else`; an `assert` adds 1 and its operands nothing; a function's decorators, defaults and annotations add nothing, to it or to its parent; a class body's decisions outside its methods add nothing. A `match` counts its cases less one when any case is a bare name: `case _:` and also a capture `case x:`, guarded or not.
3. **Methods radon does not report.** radon drops every method of a class nested in a function or in a class. The counter counts them (`Outer.Inner.m`, `f.C.m`); the tests list them as the only extras.
4. **Naming (D2).** Classes and functions are the chain; a namespace and an object literal are not (`Space.inside` is `inside`, `{ m() {} }`'s method is `m`). An anonymous function or class is, in order: `<callee>` when it is a call's argument (`xs.map` gives `<map>`, `db.transaction` gives `<transaction>`, `new Promise` gives `<new Promise>`, any other callee `<anonymous>`); else the name receiving it, from a variable, a key, a class field, an assignment (`this.x = …` and `module.exports.x = …` give `x`), a default parameter or a destructuring default (`cb = () => {}` gives `cb`); else `<anonymous>`. `(f)`, `f as T`, `f satisfies T` and `f!` are looked through. A pattern or a subscript names nothing. A string key loses its quotes. Duplicates, anonymous ones included, are told apart by the occurrence alone: no `#k` in the name.
5. **Body hash.** SHA-1 of the text from the parameters to the function's end, every whitespace character removed, first 16 hex characters (64 bits; collisions matter only between one revision's removed and added functions). From the parameters, so a rename and a move between a function declaration and a method keep it. Whitespace removed, not collapsed, so a reindent or a reflow keeps it; a formatter's trailing comma does not. A Python function's decorators are outside its node, so they are not hashed either.
6. **Default parameters** count on the parameter's `=`, so a default whose value is itself a decision (`b = a ? 1 : 2`) adds 2, as in ESLint. The first draft counted the value node and missed one in `src/core/daemon/escaped.ts`.
7. **ESLint read TypeScript as written**, through `@typescript-eslint/parser` 8.72.0. The research stripped types with Node's `stripTypeScriptTypes`, which fails on 5 of 605 files (parameter properties); with the parser, all 605 are compared.
8. **Comparison keys.** ESLint's counts are keyed by a function's end (ESLint places an arrow at its `=>`), radon's by its start. Functions that end together (`a => b => …`) share a key and are compared as a sorted list.
9. **The pinned commit** is `e90e0030c`, the `squeal--v0.1.279` release on main, so that history rewrites on an integration branch cannot remove it. `corpus.test.ts` reads it with one `git cat-file --batch`; CI's Node 22 shards check out the full history.

## Results

- Constructs fixtures (`constructs.ts`, `view.tsx`, `plain.cjs`): 77 functions, every key equal to ESLint 10.13.0's classic counts. `constructs.py`: 44 of 44 equal radon 6.0.1, plus the 2 methods radon drops.
- `src/` at `e90e0030c`: 605 files, 7,042 functions, every file equal to ESLint's counts.
- Python at `e90e0030c`: 289 files, 488 functions, all equal to radon's.
- The research's Python corpus, checked once and not stored: coverage 7.17, radon 6.0.1, lizard 1.24.2 and mccabe 0.7.0 sources (192 files): 2,191 of 2,191 functions equal radon's, plus 2 methods of a class nested in a function in `lizard.py`.

## For the next rows

- **Bundles.** No bundle imports the counter yet, so `dist/*.mjs` is unchanged by this row; `dist/code/` appears at the next build. The drift tests compare `.mjs` files only, so a missing `dist/code/` does not fail them; the `cli/ps.mjs` drift seen on this branch is wave 0's policy change, before this row.
- **`test/harness/pytest-bundle.test.ts`** lists `dist/pytest/` exactly; the grammar is in `dist/code/`, so it stays as it is. A bundle test that the counter loads from a built `dist/` belongs with the first row whose CLI calls it (015-06 or 015-07).
- **Known limit**: the TSX grammar reads `<T>x` type assertions in a `.ts` file as JSX, so such a file has error ranges (`complexity-and-crap.md` 2). None in `src/` here.
