# Research brief 015-25: `typeof import` in a type argument

Use /researcher. Shape: research. Outcome: a measured fix for the grammar misparse of `typeof import(...)` in a type argument, or a measured reason to accept it. Follow the rules in `README.md`.

Read first: row 015-25 on the board; spec D3 (the counter, `COUNTER_VERSION`) and its 2026-10-24 amendment for 015-23; `tasks/015-23/notes.md` (why no newer grammar exists, how `export type *` was accepted by an exact error shape); `src/core/code/count/{parser,typescript,walk}.ts`.

Questions:

1. **The grammar.** In tree-sitter-tsx 0.23.2, which constructs around `importOriginal<typeof import("./x.js")>()` misparse, and how (the tree, not only the error flag)? Is there an upstream issue, a fix on the default branch, or a release after 0.23.2 that parses it?
2. **A narrow rewrite.** Can a replacement before parsing that keeps every byte offset (as 015-23 does for NUL) make the tree right without changing any function's count? Name the rewrite, the cases it must not touch (strings, comments, template literals, JSX text), and its cost per file.
3. **Measure.** Functions in a parse error or misparsed, before and after the fix, in this repository and in cezar (a read-only copy at its current main), each compared with ESLint's `complexity` rule on the same files.
4. **The two counts.** Why `lessons.md` saw 1 function in a parse error in cezar and the 015-23 probe 70. And the cause of the whole-file error in cezar's `composer.test.tsx`.

Own `typeof-import.md` and `probes/typeof-import/`.
