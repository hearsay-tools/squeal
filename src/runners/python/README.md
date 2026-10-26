# Vendored tree-sitter-python grammar

`tree-sitter-python.wasm` is copied unchanged from the published npm package, so that Squeal does not depend on the package and no install script runs on `npm ci` (spec 007 D4, coordinator decision for 007-12). `web-tree-sitter`, which loads it, stays a dependency.

| | |
| --- | --- |
| Package | `tree-sitter-python` 0.25.0 |
| Tarball | https://registry.npmjs.org/tree-sitter-python/-/tree-sitter-python-0.25.0.tgz |
| File in the tarball | `package/tree-sitter-python.wasm` |
| sha256 | `16108b50df4ee9a30168794252ab55e7c93bfc5765d7fa0aa3e335752c515f47` |

`test/runners/python/wasm.test.ts` fails when the file's hash differs from the one above. To update: download the new tarball, copy the file, and change the version, URL and hash here together.

The pytest graph and the code counter both load it through `parser.ts` (row 016-36). The build copies this file and `web-tree-sitter`'s own `web-tree-sitter.wasm` into each plugin's `dist/pytest/`, where `wasm.ts` finds them from the bundled CLI.
