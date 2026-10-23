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
