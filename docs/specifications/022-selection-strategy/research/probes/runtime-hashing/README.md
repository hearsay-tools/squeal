# Probes for `runtime-hashing.md` (row 022-11): throwaway

Everything here is throwaway research code. It is not product code, not tested, and not to be imported. It reads this worktree's `node_modules` and the vendored grammar; it writes nothing outside `$TMPDIR`.

| File | What it does |
| --- | --- |
| `ts.mjs` | Loads web-tree-sitter 0.27.1 and the vendored `tree-sitter-tsx.wasm`; `typescript()` loads `tree-sitter-typescript.wasm` from the 0.23.2 npm tarball at `$TS_GRAMMAR` (downloaded to `$TMPDIR`, not vendored). |
| `dump.mjs` | Prints the tree of a snippet. `node dump.mjs 'code'`. |
| `strip.mjs` | Candidate B: blanks TypeScript-only syntax and non-magic comments with spaces. Outputs `exact` (blanked), `trim` (also no spaces at line ends) and `norm` (also no indentation, other runs of spaces become one). Falls back on parse errors, magic comments, `const enum`, TS syntax in a JS file. `SQUEAL_PARSER=1` (with `node --import tsx`) parses through Squeal's own `src/core/code/count/parser.ts` and its gap rewrites. |
| `cand-a.mjs` | Candidate A: `node:module` `stripTypeScriptTypes` (`mode: "strip"`), then acorn's tokenizer blanks comments. |
| `cand-c.mjs` | Candidate C: sucrase 3.35.1, installed under `$TMPDIR` only (`SUCRASE_DIR`), then acorn. |
| `a-probe.mjs` | Candidate A per Node version: 26 constructs through `stripTypeScriptTypes` in `strip` and `transform` modes. |
| `torture.mjs` | 76 pairs that must hash the same, differently, or fall back. `node torture.mjs`. |
| `torture-c.mjs` | The same pairs through Candidate C. |
| `lines/` | Four variants of one module; `hash.mjs` prints their digests, `run-node.mjs` and `frames.test.ts` print a stack frame under Node and Vitest. |
| `corpus.mjs` | Runs a candidate (`a`, `b`, `c`) over the tracked JS/TS files under `src/` and `test/`: fallback reasons, cold start, per-file ms. |
| `history.mjs` | Replays the last N commits' modified JS/TS files through Candidate B and two oracles (esbuild 0.28.2, rolldown 1.2.16's oxc transform as Vite 8.3.2 calls it). |
| `blobs.mjs` | One `git cat-file --batch` for many blob ids. |
| `rekey.mjs` | Question 5: reads N committed blobs with one `git cat-file --batch`, normalizes them, then looks them up through a `(blob id, ext)` memo. |
