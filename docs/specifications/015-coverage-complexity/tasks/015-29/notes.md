# 015-29 notes: `import(…)` in a type argument parses

Worker e2116809, 2026-10-24. From `main` at `5b7c15914`. Brief: `tasks/wave-2.md` W2. Research: `research/typeof-import.md` (r2).

## Seam map

| Piece | Where | Test |
|---|---|---|
| The rewrite | `tsxInput` in `src/core/code/count/parser.ts`, called by `withCodeTree` for the TSX parse only, after the NUL replacement | `test/code/count/type-import.test.ts` |
| Names from the file's own text | `CountRules.nameOf(node, text)` (`walk.ts`); `source` in `typescript.ts` | the same file, third test |
| `COUNTER_VERSION` 2 -> 3 | `src/core/code/count/index.ts` | none pins the number |
| The gap, documented | `src/core/code/count/README.md`, "Gaps of 0.23.2" | |

## The rule as built

- **r2 as measured.** The regex is the probe's (`probes/typeof-import/measure.mjs`): `import`, optional spaces or tabs, `(`, one `'…'` or `"…"` string with no line break, backslash, `$` or backtick, `)`, after `typeof ` and whitespace, or after `<` or `,` and optional whitespace. Each match becomes underscores of the same length. An `includes("import")` guard skips the regex in most files.
- **Cost.** V8 finds `import` first and then checks the lookbehind, so the regex is linear: 2 to 5 ms on 1 MB of whitespace or of repeated `a<import('x' ` (my probe, not committed). The research measured 0.012 ms per real file.

## Decision the brief did not settle: names read the file's own text

The brief says the walk and the body hashes read the file's own text. Before this row, names read the parse input (`node.text`). With r2 alone, a quoted key that holds the matched text, `{ "f<typeof import('./x.js')>()": () => 1 }`, would be named `f<typeof ________________>()`. The research accepted that. The row's done-when says the same text in a string, a comment and a template literal is untouched, and a name is the only place a string's or a template's text shows in a count.

So `CountRules.nameOf` takes the file's text as a second parameter, and every name in `typescript.ts` is `text.slice(node.startIndex, node.endIndex)`. This is safe because every change to the parse input keeps every UTF-16 offset. It is also cheaper: web-tree-sitter's `node.text` slices the rest of the input and then truncates. The Python rules ignore the parameter; their parse input is the file's text.

A side effect: a NUL in a quoted key's name now reads as the NUL, not as a space (row 015-23 had documented the space). `node:sqlite` stores and reads a NUL inside a text value whole (checked: `"a\0b"` round-trips with length 3). The README no longer names the space.

The third test fails when `source` returns `node.text` (mutation checked): the quoted key and the template key read the underscores. Its hash check fails when the body hash reads the parse input.

## Measured here

Every git-listed JS and TS file outside `docs/`, `fixtures/` and `dist/` (1,972 files), counted by the counter at `5b7c15914` and by this row's, with 015-23's probe:

| Counter | Files with errors | Functions | Files whose functions changed (name, occurrence, CC, start, body hash) |
|---|---|---|---|
| `5b7c15914` | 16 | 31,063 | |
| this row | 0 | 31,063 | 0 |

The 16 were all test files with `<typeof import(`. In this repository the misparse only marked functions `unknown`; it changed no count or name, as the research found. The fixtures in `type-import.test.ts` do change: `vi.importActual<typeof import('x')>('x', (m) => …)` names its arrow `<anonymous>` before and `<importActual>` after.

ESLint 10.13.0 `complexity` on `@typescript-eslint/parser` 8.72.0 (the researcher's scratch install in `/tmp/tir-015-25/js`) gives the CCs the tests expect: 1, 2, 2, 2; 1, 1, 2, 3; and 2, 2, 2.

## Residue

- `countTree` (`walk.ts`) stays at CC 24, as 015-23 left it. This row adds no decision to it.
- The small no-semicolon fixture gives three small `ERROR` ranges before the fix, not the whole-file `ERROR` of cezar's `composer.test.tsx`. Its done-when line (parses, counts like ESLint) holds either way.
- r2 also rewrites a dynamic `import("x")` in code after `,` or `<`, for example `Promise.all([a, import("./b.js")])`. It becomes an identifier: no function or decision point is lost, and `import("x").then(cb)` still names `cb` `<then>`. The research measured 0 changed functions over 3,880 files.
