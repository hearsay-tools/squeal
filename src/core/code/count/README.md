# Vendored tree-sitter-tsx grammar

`tree-sitter-tsx.wasm` is copied unchanged from the published npm package, as the Python grammar is (`src/runners/pytest/graph/README.md`), so that Squeal does not depend on the package and no install script runs on `npm ci` (spec 015 D3). It parses `.ts`, `.tsx`, `.js` and the other extensions of `CODE_EXTENSIONS` to the same counts as the TypeScript grammar (`docs/specifications/015-coverage-complexity/research/complexity-and-crap.md` 2). `web-tree-sitter`, which loads it, stays a dependency; its runtime and the Python grammar are the pytest graph's.

| | |
| --- | --- |
| Package | `tree-sitter-typescript` 0.23.2 (MIT) |
| Tarball | https://registry.npmjs.org/tree-sitter-typescript/-/tree-sitter-typescript-0.23.2.tgz |
| File in the tarball | `package/tree-sitter-tsx.wasm` |
| sha256 | `79e5da75ea62855a0cd67177685f0164eac87d5f630b3cbe1e0a099751ad30f8` |

`test/code/count/wasm.test.ts` fails when the file's hash differs from the one above. To update: download the new tarball, copy the file, change the version, URL and hash here together, and raise `COUNTER_VERSION` in `index.ts`, since a new grammar can change a count.

The build copies this file into each plugin's `dist/code/`, where `wasm.ts` finds it from the bundled CLI.

## Gaps of 0.23.2

0.23.2 is the latest release (2024-11-11; checked 2026-10-24). Three inputs it misreads are valid code, so the counter reads them as no parse error (rows 015-23 and 015-29). Each change to the parse input keeps every UTF-16 offset and line; names and body hashes are read from the file's own text.

- **`export type * from` and `export type * as N from`** (TypeScript 5.0). The grammar leaves `type` alone in an `ERROR` and parses the rest. `TYPESCRIPT_RULES.grammarGap` reads that one shape as no error. The upstream fixes, tree-sitter-typescript pull requests 358 and 360, are open. When a release has one, update the file as above and drop the rule.
- **A raw NUL** in a string, a template or a comment. tree-sitter reads a NUL as the end of the input. `withCodeTree` parses the text with a space in place of each NUL. Python is parsed as written: CPython refuses a NUL anywhere in a source file.
- **`import("x")` in a type argument**, as in `importOriginal<typeof import("./x.js")>()` (`vi.mock`) and `React.createRef<import("./c").H>()`. The grammar reads the call as the comparisons `f < typeof import(…) > ()`, so the tree is wrong, not only flagged; without semicolons the error can grow over the whole file. `withCodeTree` parses each `import("x")` with one plain string that follows `typeof `, `<` or `,` as an identifier of underscores, `typeof ____`, `____.T`. The same text in a string, a template or a comment stays a string, a template or a comment. Upstream issue 367 is open; pull request 375 fixes only the `typeof` shapes (`docs/specifications/015-coverage-complexity/research/typeof-import.md`). When a release fixes both, update the file as above and drop the rewrite.
