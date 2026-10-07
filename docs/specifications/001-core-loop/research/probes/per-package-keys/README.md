# per-package-keys probes (THROWAWAY)

Throwaway experiments for `../../per-package-keys.md` (task 001-102). Not product code. Do not import from here.

- Vitest 5.0.3, Vite 8.3.3, npm 11, pnpm 10.34.6, Node 24.21.0, Linux. `cezar` measured at `origin/main` `c7fa7178` (Vitest 4.1.10, Vite 8.1.4).
- `node_modules/`, `fixture/tarballs/` and `fixture/package-lock.json` are git-ignored. Rebuild with `./pack.sh && (cd fixture && npm install)`.

| File | What it does |
|---|---|
| `pkgsrc/` | 13 one-file packages, one per way a test can depend on an installed package: externalized ESM with a declared dependency (`ext-esm` -> `ext-trans`), CJS with an undeclared one (`ext-cjs` -> `phantom`), inlined (`inl` -> `inl-trans`), a computed `import()` (`dyn` -> `computed-target`), a setup file's, a `globalSetup`'s, a config plugin (`plugin-pkg`), a child process's (`child-pkg`), a file read through `require.resolve` (`data-pkg`). |
| `pack.sh` | Packs `pkgsrc/*` into `fixture/tarballs/`, so npm installs copies with an integrity, not links. |
| `fixture/` | The Vitest project; one test file per case, plus a worker thread and a child with a cleared environment. |
| `observe.mjs` | Per test file: the transform-graph deps Vite records (static) and Vitest's `importDurations` (runtime). Run from a project root. |
| `config-deps.mjs` | What Vite reports as the config file's dependencies and plugins. |
| `trace.mjs` | A `--import` preload using `module.registerHooks`: logs every installed module Node resolves, per process, with the Vitest test file (`__vitest_worker__.filepath`) and failed bare resolutions. Children inherit it through `NODE_OPTIONS`. |
| `mark.mjs`, `fixture/vitest.trace.config.js`, `summarize.mjs` | First version of the trace attribution (a setup file names the test file per process). |
| `lockgraph.mjs` | The installed npm graph from `node_modules/.package-lock.json`: Node-style lookup by name from a location, transitive closure over `dependencies`, `optionalDependencies`, `peerDependencies`, identity `location@version#integrity`, types-only detection. |
| `perfile.mjs` | Per test file, the installed packages its closure imports directly (first hop out of project files) and the builtins it reaches; per project, the environment-wide starts (setup files, `globalSetup`, config imports, `vitest`). Mirrors `src/runners/vitest/graph.ts`. |
| `compare.mjs` | Per test file, whether its per-package key differs between two installed lockfiles. `TYPES_ONLY=<rootA>,<rootB>` keys types-only packages as constants; `WHY=1` prints what re-keys each file. |
| `scenarios.sh` | Bumps one fixture package at a time in a scratch copy; records which tests change outcome and which keys change. Output in `scenarios.md`. |
| `cost.mjs` | Time to parse the lockfile, scan for types-only packages and key every test file. |
| `soundness.mjs` | From a `trace.mjs` log: installed packages a test file's run loaded that its static key would not cover. |
| `freshness.mjs` | npm's rule for trusting `node_modules/.package-lock.json` (mtime against listed folders, unlisted top-level folders). |
| `table.mjs` | Folds `scenarios.sh` output and a fixture trace into `scenarios.md`. |
| `output.txt` | Raw output of the runs the findings quote. |
