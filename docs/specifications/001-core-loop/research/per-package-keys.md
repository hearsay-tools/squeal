# Research: per-package-keys

Date: 2026-10-07. Researcher task 001-102, from `lessons.md` defect 20. Probes: `probes/per-package-keys/` (raw output in `output.txt`).

Evidence tags: **[exp]** verified by experiment, **[docs]** read in official docs, **[src]** read in source code, **[inf]** inferred. Versions: Vitest 5.0.3 and Vite 8.3.3 on the fixture; `cezar` `origin/main` `c7fa7178` runs Vitest 4.1.10 and Vite 8.1.4; Node 24.21.0; npm 11; pnpm 10.34.6.

## Questions answered

| # | Question | Answer |
|---|---|---|
| 1 | Which installed packages a result can depend on, and what Squeal can observe | The transform graph shows the first file of every package a project file imports, inlined or externalized, and nothing an externalized package loads itself. Setup files, `globalSetup` and config plugins are environment-wide. Undeclared requires, child processes, worker threads and files read through `require.resolve` are invisible statically; a Node resolve hook sees all but threads and children whose environment is cleared. **[exp]** |
| 2 | Can a per-file package set be built cheaply and kept sound | Cheaply, yes: 0.16 to 0.29 ms a file on top of today's walk. Sound, no: the lockfile closure of the first-hop packages misses undeclared requires (`phantom`) and worker threads in the fixture, and child processes (8 files) and a `require.resolve` read (1 file) on `cezar`. Falling back to the whole lockfile for files that reach `child_process`, `worker_threads` or `module` leaves in-process undeclared requires and hand-built `fs` paths, neither seen on `cezar`. Both today's hash and a per-package one trust a hidden lockfile that can be stale. **[exp]** |
| 3 | On `cezar`, how many of 632 files keep their key between the main checkout's install and `origin/main`'s | Today 0. Per-package graph keys: 0 as specified, because `@types/node` is in every key through Vitest's optional peer; 630 when types-only packages key as constants; 324 with the fallback above. Keying all 632 costs 99 to 181 ms. **[exp]** |
| 4 | How Nx, Turborepo and Bazel hash external dependencies | Nx: per project, the npm nodes its imports reach plus their transitive closure, each by lockfile integrity; all externals for a command it cannot vouch for. Turborepo: per workspace, the lockfile closure of its declared dependencies as `(key, version)`. Bazel `rules_js`: per target, declared npm targets fetched by integrity; refuses phantom hoisting. None keys per test file. **[src][docs]** |

## Findings

### F1. What a test file's result can depend on, and what is observable (Q1) **[exp]**

Fixture: 13 packed packages (`probes/per-package-keys/pkgsrc/`), one test file per case. `observe.mjs` prints the transform graph Squeal's closure walk reads (`transformResult.deps`, `dynamicDeps`) and Vitest's `TestModule.diagnostic().importDurations`.

| Dependency of the test | Transform graph (static) | `importDurations` (runtime) | Node resolve hook (runtime) |
|---|---|---|---|
| Externalized package imported by a project file (`ext-esm`, `ext-cjs`, `dyn`) | its entry file, `/node_modules/ext-esm/index.js` (root-relative under the root, `/@fs/...` outside) | entry, `external: true` | entry |
| Its declared dependency (`ext-trans`) | no | no | yes |
| Its undeclared dependency (`phantom`, required by `ext-cjs` without a manifest entry, hoisted because the root depends on it) | no | no | yes |
| A computed `import(name)` inside it (`computed-target`) | no | no | yes |
| Inlined package (`server.deps.inline`) and what it imports (`inl`, `inl-trans`) | entry; its own imports if the walk continues into it | both, `inlined` | no: Vite loads them, not Node |
| Package of a setup file (`setup-pkg`) | through the setup file's closure | yes, in every file | yes, in every file |
| Package of a `globalSetup` file (`gs-pkg`) | through the `globalSetup` closure | no | main process only |
| Config plugin package (`plugin-pkg`) | no; `configFileDependencies` is `['/vitest.config.js']` only | no | main process only |
| Package a child process loads (`node -e "require('child-pkg')"`) | no | no | yes, with `NODE_OPTIONS` inherited |
| File found by `require.resolve` and read with `fs` (`data-pkg/data.json`) | no | no | yes (the resolve, not the read) |
| Package loaded in a `worker_threads` Worker | no | no | **no** |
| Package loaded by a child spawned with `env: {}` | no | no | **no** |

Vitest 5's `importDurations` is documented as "every non-externalized dependency that Vitest has processed" and records an externalized entry with `external: true` (`ImportDuration`, `config.d.BxjInJat.d.ts`) **[src]**; it never sees below that entry. Under the default `forks` pool with isolation each test file ran in its own process (8 files, 8 pids, at most one file per pid), so a per-process trace attributes cleanly; `__vitest_worker__.filepath` names the file in the worker **[exp][src]**.

### F2. Building the per-file set, and its soundness (Q2)

The set: for each test file, the packages its closure imports directly, resolved from the importer's workspace the way Node does (`<from>/node_modules/<name>`, then the root), closed over `dependencies`, `optionalDependencies` and `peerDependencies` in `node_modules/.package-lock.json`, each as `location@version#integrity`; a name that does not resolve keys as absent. Workspace packages are project files already in the closure and are not expanded. Environment-wide: the closure of `vitest` (with its peers, so `vite`), of the packages the setup and `globalSetup` closures import, and of the bare imports of every config file. `lockgraph.mjs`, `perfile.mjs` **[exp]**.

Fixture, one package bumped at a time (`scenarios.sh`, `scenarios.md`): "outcome" is the tests that failed after the bump; "re-keyed" is what each scheme would rerun **[exp]**.

| Bumped | Outcome changed | First hop only | Graph closure | Missed by graph | Missed by graph plus trace |
|---|---|---|---|---|---|
| `ext-trans` (declared, under an external) | `ext-esm` | missed | re-keyed | none | none |
| `inl-trans` (declared, under an inlined) | `inl` | missed | re-keyed | none | none |
| `computed-target` (declared, computed `import()`) | `dyn` | missed | re-keyed | none | none |
| `phantom` (undeclared) | `ext-cjs` | missed | missed | **`ext-cjs`** | none |
| `child-pkg` (child process) | `child`, `thread` | missed | missed | **`child`, `thread`** | **`thread`** |
| `data-pkg` (`require.resolve` plus `fs`) | `data` | missed | missed | **`data`** | none |
| `setup-pkg`, `gs-pkg`, `plugin-pkg` | `setup` | all (environment-wide) | all | none | none |

The bumps of `dyn`, `ext-cjs`, `ext-esm` and `inl` change no outcome (no version string in their output) and re-key only their own test under every scheme; the full table is `probes/per-package-keys/scenarios.md`. `child-noenv` loads `data-pkg` in a child spawned with `env: {}` and asserts only that it loads, so it shows what the trace cannot see without changing outcome.

So the first hop alone is unsound for any transitive change, and the graph closure is sound only for dependencies that are declared and loaded in the test's own thread.

On `cezar` (`trace.mjs` over a full run of `origin/main`, 14,593 tests, 2 failing; `soundness.mjs` against the graph closure) **[exp]**: every one of the 632 files was attributed. 30 loaded an installed package outside their key.

- 21 only outside the worktree: child processes running globally installed CLIs (`@openai/codex` in 21 files, `cursor-agent`'s `tree-sitter`, `@earendil-works/pi-coding-agent`, npm itself). Today's D3 covers none of these either.
- 8 in child processes, inside the worktree: tests that spawn the project's own CLI (`artifacts/cli.test.ts` loads `hono`, `ws`, `smol-toml`, `zod`) or Vite with the web config (`server-install/platforms/ubuntu-vps.test.ts` loads `@tailwindcss/vite`, `@vitejs/plugin-react` and their trees). The project files those children run are not in the closure either (D3's `complete: false`).
- 1 in-process: `packages/web/src/design-guardian.test.ts` calls `createRequire(...).resolve('@fontsource/poppins/package.json')` and checks for its `LICENSE`. No module imports `@fontsource/poppins`, so no static key holds it, and it is one of the 89 packages the two installs differ by. Under the graph scheme this file keeps its key between them (F3).
- No in-process undeclared module load was seen. 5 optional requires failed by design (`canvas` from `jsdom` in 173 files, `bufferutil` from `ws`, `supports-color` from `debug`, `fsevents`); a key built from a trace must record absences too.

That last file passes with both installs: the main checkout has `@fontsource/poppins` 5.3.0 on disk while its `node_modules/.package-lock.json` does not list it. The folder is dated 2026-09-14, the hidden lockfile 2026-09-12. npm itself trusts that file only if "no package folders exist in the `node_modules` hierarchy that are not listed in the lockfile" and "the modified time of the file is at least as recent as all of the package folders it references" **[docs]**. So today's D3 hash and any per-package key read from it miss an install that bypassed the hidden lockfile. `freshness.mjs` applies npm's rule in 10 to 19 ms on `cezar` and flags the main checkout (one unlisted top-level folder, `@fontsource/poppins`), not `origin/main`'s install **[exp]**; workspace links must be compared with `lstat`, since their targets are live project directories.

What must stay environment-wide **[exp][inf]**: the runner's own closure (`vitest`, its peers, `vite`); packages of setup and `globalSetup` files, already in D3 through their closures; config plugins, which only the config file's bare imports name; Node version, platform and arch; `patches/`. Types-only packages (55 of 563 on `cezar`: no runtime file, only declarations) change what `tsc` reads, never what Node loads; a test that spawns `tsc` is the exception (`cezar` has one, `web-typecheck.test.ts`, with `types: []`).

Lockfile formats **[exp]**: npm's `node_modules/.package-lock.json` has locations, versions, integrity and declared edges, enough for Node-style lookup. pnpm 10's `node_modules/.pnpm/lock.yaml` has `packages:` with integrity and `snapshots:` with resolved edges; an undeclared require still resolves under pnpm when the package is a root dependency (`ext-cjs` printed `cjs+phantom-v1`). Yarn's `.yarn-state.yml` and `.pnp.cjs` were not examined.

### F3. `cezar`, main checkout install against `origin/main`'s (Q3) **[exp]**

The main checkout's `node_modules/.package-lock.json` (installed 2026-09-12, workspaces at 0.12.2) against a fresh `npm ci` of `origin/main` (`c7fa7178`); the latter is byte-identical to the install of the worktree in defect 20 (`5062d7f6`). 474 against 563 entries, 95 differ: `@types/node` 20.19.43 to 24.19.1, `undici-types` 6.21.0 to 7.24.6, four workspace versions 0.12.2 to 0.15.1, and 89 added (`@modelcontextprotocol/sdk` and its `express` tree, `@fontsource/poppins`). Closures computed once on the `origin/main` tree, so only the install varies.

| Scheme | Files keeping their key (of 632) | What re-keys the rest |
|---|---|---|
| Today (D3, whole installed lockfile) | 0 | any byte of the lockfile |
| First hop or graph closure, as specified in F2 | 0 | `@types/node`, an optional peer of `vitest`, is in every environment-wide closure |
| Graph closure, types-only packages as constants | 630 | `ci-wait/controller.test.ts`, `ci-wait/mcp.test.ts` import `@modelcontextprotocol/sdk`, absent from the main checkout |
| As above, whole-lockfile key for a file whose closure reaches `child_process` or `worker_threads` | 326 | 306 files reach `child_process`; none reaches `worker_threads` |
| As above, `node:module` added to the fallback | 324 | 66 files reach `node:module`; `design-guardian.test.ts` is among them |

Cost on `cezar` (`cost.mjs`, six runs, machine shared with other agents' test runs): parsing the 563-entry lockfile 5.9 to 9.4 ms; the types-only scan of every installed package 25 to 69 ms; resolving, closing, sorting and hashing the set for all 632 files 99 to 181 ms with single-package closures memoized. A set is 159 environment-wide packages plus a median of 4 of the file's own (max 309, the web project). The first hops come out of the walk Squeal already does (`perfile.mjs` walked all 632 in 8.5 s cold, unloaded); today `importClosure` already reaches each package entry and stops there, so collecting them adds string work, not transforms.

### F4. Prior art (Q4)

- **Nx** (`nrwl/nx` `0fb5683`, 2026-10-07) **[src]**: each npm external node is hashed by `hash(external.hash)` or, without one, its version (`native/tasks/hashers/hash_external.rs`); `external.hash` is the lockfile `integrity`, else a hash of `resolved` or name and version (`plugins/js/lock-file/npm-parser.ts`). A task gets the external nodes in its project's dependencies plus each node's transitive closure (`compute_external_deps`, `self_and_deps_inputs` in `native/tasks/hash_planner.rs`); project edges come from the JS plugin's import analysis. For a target whose executor is not `@nx/*` and that names no `externalDependencies` input, Nx hashes `AllExternalDependencies` (`target_input`): "if it's 'run commands' or third-party we skip traversing since we have no info what this command depends on". That is the child-process fallback, per target.
- **Turborepo** (`vercel/turborepo` `1926e2e`, 2026-10-07) **[src]**: per workspace, `transitive_closure` of its declared dependencies in the lockfile (`turborepo-lockfiles/src/lib.rs`), serialized as sorted `(key, version)` pairs (`turborepo-lockfile-hash`), enters the task hash as `external_deps_hash` (`turborepo-task-hash/src/lib.rs`); the root workspace's closure goes into the global hash (`global_hash.rs`). Declared dependencies, not imports, so a phantom is covered only when the root declares it.
- **Bazel `rules_js`** (`aspect-build/rules_js` `ec3724a`) **[docs]**: each package is fetched individually with "the integrity hash, as calculated by the package manager" and only "packages which are required for the requested targets" (`docs/pnpm.md`); "`rules_js` does not and will not support pnpm 'phantom' hoisting ... All dependencies between packages must be declared" (same file). The README lists "ESM imports escape the runfiles tree and the sandbox" (issue 362) as a known hole.

None of the three keys finer than a project or workspace target, and all three trust declared edges. Nx alone widens to everything for commands it cannot see into.

## Recommendation for Squeal

**Verdict.** No per-package key is sound by construction: a test's run can load a package no static analysis names (F1, F2). As the outcome asks, "without ever reusing a result its dependencies could change", only a scheme that falls back to today's whole-lockfile key wherever Squeal cannot see qualifies, and then about half of `cezar` inherits, not most. The tradeoff that decides it is how much of the suite spawns processes or resolves packages by hand: on `cezar`, 306 of 632 files reach `child_process`.

Three schemes, measured on the defect 20 pair (F3) and checked against the trace (F2):

| Scheme | Kept on `cezar` | Known misses |
|---|---|---|
| A. Graph closure of first-hop packages, types-only as constants | 630 | child processes (8 files on `cezar`), `require.resolve` reads (1), undeclared requires and worker threads (fixture) |
| B. A, with the whole-lockfile key for a file whose closure reaches `child_process`, `worker_threads` or `module` | 324 | an undeclared require or a computed `import()` of an undeclared package in-process (fixture only; none on `cezar`), a node_modules path built by hand and read with `fs` |
| C. A as the lookup key, plus a run-time trace (F1's hook) that lets a result be stored under its per-package key only if every package the run resolved is inside it, else under the whole-lockfile key | up to 630 | worker threads and children spawned without the environment; a path read with `fs` without resolving; needs `NODE_OPTIONS` injected into the user's processes |

**Recommendation for Squeal: build B, not A or C, and fix the stale-lockfile hole first.** B is no weaker than today's D3 for every case observed on `cezar` (the 21 files that run global CLIs fall back to today's key, which never covered those CLIs) and halves defect 20's second suite there. A would keep `design-guardian.test.ts`'s key across exactly this pair although the package it checks is one of the 89 that differ (its outcome held only because the folder was on disk in both, F2), and 8 more files whose children load packages outside their key. C's coverage is the best, but it changes the environment of every test process, and the probe's version cost about 13 percent more CPU and 23 percent more wall time on `cezar` (below), and two tests failed only under it. Revisit C if B's fallback rate proves high in dogfooding.

What D3 would say: the installed-dependency fingerprint moves out of the environment hash. The environment hash keeps the closure, in the installed lockfile, of the runner (`vitest` with its peers), of the packages the setup and `globalSetup` closures import and of every bare import of the config files, plus `patches/`. Each test file's key adds the sorted `location@version#integrity` set of the lockfile closure, over `dependencies`, `optionalDependencies` and `peerDependencies`, of the installed packages its closure imports directly, with unresolved names as absent. A package with no runtime file keys as a constant. A file whose closure reaches `node:child_process`, `node:worker_threads` or `node:module` keys by the whole fingerprint, as today. The installed lockfile counts only while npm itself would trust it (every listed folder present and not newer than it, no unlisted folder); otherwise it is treated as changed on every revision, so nothing is inherited, and the header says so. pnpm's `lock.yaml` `snapshots` give the same graph; yarn and the other formats keep the whole fingerprint until examined.

Board row, if built: *001-1xx per-package dependency keys.* Done when: on `cezar`, between the main checkout's install and a fresh `npm ci` of `origin/main`, at least 300 of 632 test files keep their key and none of the 306 that reach `child_process` does; in a fixture, bumping a declared transitive dependency of an externalized package, an inlined package's dependency, a setup file's package and a config plugin each re-keys exactly the tests that use them, and bumping `@types/node` re-keys none; a package folder added without rewriting `node_modules/.package-lock.json` re-keys every file; keying all 632 files adds under 300 ms to a full closure pass. A smaller row stands alone and should land either way: the stale hidden-lockfile check, because today's D3 has the same hole.

## Open questions

1. The trace's real overhead (C). On `cezar`, the traced run took 10 min 27 s (41 min 25 s user, 23 min 3 s sys) and the untraced one 8 min 28 s (37 min 0 s user, 20 min 13 s sys), one run each on a machine shared with other agents' suites (load average 9 to 31). The probe writes each of its 1.1 million lines synchronously, so a production hook would cost less; not measured. Two tests in `runs/retention-enforce.test.ts` failed with `STACK_TRACE_ERROR` only in the traced run (0 failures untraced). Not determined whether the hook or the load caused it, because neither was re-run alone.
2. How often B falls back on other repositories. Squeal's own suite spawns its CLI and daemon widely, so it may sit near `cezar`'s half; not measured.
3. Undeclared in-process requires were absent from `cezar` but are common in older CommonJS trees; not measured on such a repository.
4. Whether a types-only package can matter in-process: Vitest's `typecheck` mode runs `tsc` in the main process (not examined).
5. Yarn's `.yarn-state.yml`, `.pnp.cjs` and Bun's `bun.lock` were not examined; not determined whether they carry a per-package graph.
6. Whether a test should be able to declare its child-process dependencies (a policy `inputs`-like list of packages) to escape B's fallback, as Nx's `externalDependencies` does.

## Sources

- Fixture and probes: `probes/per-package-keys/` (README, `scenarios.md`, `output.txt`).
- `cezar`: `/home/agent/projects/cezar` at `13351da8` (main checkout install, `node_modules/.package-lock.json` 2026-09-12) and `origin/main` `c7fa7178` exported to `/tmp/ppk/cezar-origin` with `npm ci`; equal to `.ai/cezar/worktrees/5062d7f6-…/node_modules/.package-lock.json`.
- Vitest 5.0.3 types: `node_modules/vitest/dist/chunks/config.d.BxjInJat.d.ts` (`ImportDuration`), `plugin.d.BsjqSb4-.d.ts` (`TestModule.diagnostic`, `experimental.importDurations`); Vitest 4.1.10 `chunks/worker.d.ZpHpO4yb.d.ts` (`WorkerGlobalState.filepath`).
- Node `module.registerHooks`: Node 24.21.0, by experiment.
- npm hidden lockfiles and `packages` fields: https://docs.npmjs.com/cli/v11/configuring-npm/package-lock-json
- Nx `0fb5683`: https://github.com/nrwl/nx/blob/0fb5683/packages/nx/src/native/tasks/hashers/hash_external.rs, `…/native/tasks/hash_planner.rs`, `…/native/tasks/task_hasher.rs`, `…/plugins/js/lock-file/npm-parser.ts`
- Turborepo `1926e2e`: https://github.com/vercel/turborepo/blob/1926e2e/crates/turborepo-task-hash/src/lib.rs, `crates/turborepo-task-hash/src/global_hash.rs`, `crates/turborepo-lockfiles/src/lib.rs`, `crates/turborepo-lockfile-hash/src/lib.rs`
- rules_js `ec3724a`: https://github.com/aspect-build/rules_js/blob/ec3724a/docs/pnpm.md, `README.md`
- Prior Squeal research: `result-fingerprinting-prior-art.md` (F1), `vitest-internals.md`.
