# Research brief 015-02: complexity and CRAP

Use /researcher. Shape: research. Outcome: how Squeal can count cyclomatic complexity per function for TypeScript, JavaScript and Python cheaply and correctly, and compute CRAP from it and a coverage map, with stable function identity across edits. Follow the rules in `README.md`.

Read first: 007 D4 and `src/runners/pytest/graph/README.md` (Squeal already ships `web-tree-sitter` and the Python grammar in every plugin), `src/harness/build.ts` (what goes into the bundles), `src/runners/node-test/enumerate.ts` (`acorn`), 011 C3 (content keys) and C7 (shared store).

Questions:

1. **Counting.** What each tool counts as a decision point (`if`, loops, `case`, `catch`, ternary, `&&`, `||`, `??`, `?.`, default parameters): ESLint `complexity`, typhonjs-escomplex, lizard, radon, mccabe, and Biome. Cognitive complexity (SonarSource) as an alternative, and why a peer chose it. Name versions.
2. **Engines.** web-tree-sitter with TypeScript, TSX, JavaScript and Python grammars, the TypeScript compiler API, acorn, oxc-parser, a CLI such as lizard: correctness on a sample, time per file on this repository's `src/`, bytes added to each plugin bundle, and native or wasm limits across the four plugins.
3. **CRAP.** The formula and threshold of Savoia and Evans (crap4j, 2007); which coverage it uses (statement, branch, path); later variants (PHPUnit's report, crap4n, any JavaScript or Python tool).
4. **The join.** How a counter's function matches a coverage record's function: name and range; anonymous and arrow functions, class methods, nested functions, decorators, generated code.
5. **Experiment.** CC for every function in `src/`, and CRAP for one directory with a real coverage map from its own tests (Vitest coverage-v8 in a scratch copy). Report the distribution, the top 20, and whether a reader would call those functions risky; read a few. Time each step.
6. **Identity and caching.** CC as a pure function of file content, cached by content hash and shared across worktrees. Function identity across edits, so that "CRAP of `parseX` went from 12 to 45" is well defined: qualified names, duplicates, renames, moves.
7. **Python.** radon or lizard against a tree-sitter count; per-function data in coverage.py 7.x reports.

Own `complexity-and-crap.md` and `probes/complexity-and-crap/`.
