# Probes for row 011-415 (fast parser): throwaway

Throwaway research probes. Nothing here is product code, nothing imports it, and it may be deleted after the spec decision. `node_modules` stays out of git.

- `elision.mjs`: what Vite 8's TypeScript transform keeps of each import form, with `verbatimModuleSyntax` on and off. It calls rolldown's `transformSync`, the function Vite's oxc plugin calls (`vite/dist/node/chunks/node.js`, `transformWithOxc`). Run: `node elision.mjs <dir of the vite package>`. Output: `elision.txt`.
- `probe.ts`: builds every test file's import closure in two ways on one repository and compares them per test file.
  - `vite`: Squeal's own `importClosure` (`src/runners/vitest/graph.ts`), as the daemon walks it.
  - `fast`: one parser per file, then Vite's own resolver (`environment.pluginContainer.resolveId`) for each specifier. Literal `require` and unnamed loads come from Squeal's `sourceLoads`, as in `importClosure`. Three parsers: `oxc-strip` (rolldown `transformSync` with the project's `oxc` options, then es-module-lexer on its output), `oxc-parse` (rolldown `parseSync` AST, then the elision rule `elision.mjs` measured), `babel` (`@babel/parser` with `estree`, then the same rule).
  - It times the cold and warm `importClosure` rounds, each parser's cold graph build, its warm closure walk, a re-parse of every file, Vitest's related walk (`relatedSpecifications`) for a sample of source files, and the reverse lookup on the fast graph for the same sample. With `--adapter` it also times the real adapter's `closure` loop and `affected`.
  - Run from this directory, on a `git archive` copy of the repository with its dependencies linked in: `timeout 1500 nice -n 10 ../../../../../../node_modules/.bin/tsx probe.ts <copy> <out-dir> --related 6 [--adapter]`. It opens Vitest with `watch: false`, `cache: false`, no reporter and no coverage, and runs no test.
- `results/<repo>/summary.json` and `results/<repo>/diffs.json`: the runs the findings cite. Absolute paths are replaced by `<root>`; files are relative to the repository root.
