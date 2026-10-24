# Probes for R3, code that tests reach only through child processes (throwaway)

Throwaway. Nothing here is product code or a test of the product. Findings: `../../child-processes.md`.

Every run happened in `/tmp/sq015-r3`: a `git archive` copy of this repository at 2e36f1ed2 in `repo/`, with `npm ci` and `@vitest/coverage-v8@5.0.3`, `c8@12.0.0` and `v8-to-istanbul@9.3.0` added there with `--no-save`. `HOME`, `TMPDIR`, `XDG_RUNTIME_DIR` and `XDG_CONFIG_HOME` pointed under `/tmp/sq015-r3`. Before run 2 the copy got this repository's history and tags (a `--shared` clone's `.git`, reset to 2e36f1ed2), so the key tests found their `squeal--v*` tag. Node 24.21.0, Vitest 5.0.3, tsx 4.23.15.

Runs, all at `--maxWorkers=4`:

1. **Full suite, child coverage** (`vitest.r3.config.ts`, under the full-run lock, 16:36 to 16:58, load 5 to 27). In-process v8 coverage was on too, but Vitest wrote no report because 8 files failed (`coverage.reportOnFailure` is false by default). Its output is the child coverage only.
2. **Full suite, in-process coverage only** (`vitest.r3-inproc.config.ts`, under the lock, 17:21 to 17:42, load 8 to 43). 1038 files passed, 2 skipped, 0 failed.
3. **The 36 pytest-related test files** (`test/runners/pytest/**`, `test/integration/pytest*`, `test/e2e/pytest.test.ts`, `test/keys/validity/pytest.test.ts`) with `vitest.r3.config.ts` and `--coverage.reportOnFailure`. Runs 1 and 2 skipped them, because the scratch `HOME` hid uv's managed Pythons. Here `UV_PYTHON_INSTALL_DIR` named the real directory (read only) and `UV_CACHE_DIR` a scratch one. 317 passed, 0 skipped.

Files:

- `child-env.setup.ts`: a Vitest setup file that sets `NODE_V8_COVERAGE=<root>/<test file>` inside the worker after it started. The worker writes nothing; each child it spawns, and theirs, writes one raw V8 file into that test file's directory.
- `vitest.r3.config.ts`, `vitest.r3-inproc.config.ts`, `vitest.r3-child.config.ts`: the repository's `vitest.config.ts` plus, in turn, in-process coverage and the setup file, in-process coverage alone, and the setup file alone (timing).
- `static-scan.mjs` → `static-scan.out.json`: per test file, its test-side import closure and whether it uses `node:child_process`, names a `src/*.ts` entry, tsx, a `dist/*.mjs` bundle or a bundle build. No coverage.
- `map-bundles.mts` → `map-bundles.out.txt`: rebuilds the four plugins' bundles with the shipped options plus `sourcemap: "external"`; all 41 `.mjs` files are byte-identical to the committed ones (OpenCode's hook bundles sit under `dist/hooks/`), so the maps apply to committed bundles.
- `convert-children.cjs`: maps each test file's raw child files to `src/` with v8-to-istanbul, as c8 does: tsx-loaded sources through Node's `source-map-cache`, bundles through the rebuilt maps when the script length equals a rebuilt bundle's. The 122 scripts it could not map are stub CLIs of tests (all under 5 KB).
- `analyze.mjs` → `analyze.out.json`, `analyze.summary.txt`, `child-only.out.tsv`, `uncovered-anywhere.out.tsv`: joins in-process coverage (runs 2 and 3, a union) with child coverage (runs 1 and 3) by function position, and the static closure of the shipped entries (every `src/` file a bundle map names).
- `cc-join.mts` → `cc-join.out.json`: Squeal's counter (version 2) over the same files, for CC and CRAP at coverage 0.
- `signals.sh` → `signals.out.txt`: whether a Node process writes its coverage file when SIGTERM, SIGKILL or SIGINT ends it, with and without a handler.
- `timing.sh`, `timing-sample.txt` → `timing.out.txt`: child coverage off and on, alternated, five pairs, on 12 test files whose children ran `src/` in run 1.

The raw child coverage (4.3 GB from run 1, 0.6 GB from run 3) was deleted after conversion.
