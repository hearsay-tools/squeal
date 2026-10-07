# node:test fixtures

Fixtures for spec 003 (node:test runner). `test/runners/node-test/fixtures.test.ts` runs each one in place with the Node running the suite and checks it behaves as described here. Run them in place or copy them inside the repository: `tsx` resolves from the repository's `node_modules`.

| Path | Purpose |
| --- | --- |
| `reference/` | Cezarion-shaped workspace. `packages/demo` has `test:unit` and `test:package` scripts of the form `node --import ../../scripts/preload.mjs --import tsx --test <glob>`; the preload imports `scripts/lib/marker.mjs` and sets `globalThis.fixturePreload` and `FIXTURE_PRELOAD`; two passing unit files, one e2e file; `packages/util` imported by name through the committed symlink `node_modules/@reference/util`. |
| `edge/` | One test file with every specifier form of spec 003 D3, plus the outcome cases. See `edge/README.md`. Run as `node --import tsx --test test/<file>` from `edge/`. |
| `monorepo/` | The review's three closure misses (tsconfig `paths` through `extends`, an `import` in a CommonJS-typed package, a bare workspace-package preload) and a computed `require`. See `monorepo/README.md`. |
| `gen-big.mjs` | Cost fixture: `node gen-big.mjs [outDir]` writes 1,000 modules (700 core, 300 util) and 200 test files, deterministic, in about 0.15 s. Default output `big/`, git-ignored. Running all 200 files takes about 13 s; tests run a few. |
| `reporter.mjs` | Writes every `TestsStream` event as one NDJSON line, error fields included, as D5's reporter will. Pass with `--test-reporter=<path> --test-reporter-destination=<file>`. |

The `node_modules/` symlinks are committed on purpose (`.gitignore` re-includes them): they are what `npm install` would make for the workspace.
