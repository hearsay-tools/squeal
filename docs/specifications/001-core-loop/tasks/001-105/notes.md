# 001-105 per-package dependency keys: notes

Worker notes for whoever continues or reviews 001-105 (scheme B of `research/per-package-keys.md`). Date: 2026-10-07.

## Seam map

- `src/core/keys/packages.ts`, `InstalledGraph`: npm's hidden lockfile as a graph. `identities(imports, exclude)` resolves each `{ from, name }` as Node does (every parent directory, skipping `…/node_modules` itself), closes over `dependencies`, `optionalDependencies`, `peerDependencies`, and returns sorted `location@version#integrity`, `absent:<from>><name>`, `workspace:<location>` or `<location>@types-only`. Closures are memoized per start location per graph; the types-only scan is memoized by identity in a map `Lockfiles` keeps across reads.
- `src/core/keys/environment.ts`, `installedDependencies(projectRoot, worktreeRoot, typesOnly?)`: now also returns `graph` (only for a trusted hidden lockfile) and `patches` (hash of the patches directory alone). `fingerprint` is unchanged.
- `src/core/keys/dependencies.ts`, `dependencyKeys(installed, environmentPackages)`: `{ environment, of(packages) }`. `environment` replaces the whole fingerprint in the environment hash; `of` is the per-file segment.
- `src/core/keys/check-key.ts`: `KEY_ENCODING` is `squeal-check-key/2`; the segment sits in the JSON header with the env hash and test path. `KeyIndex.setClosure(closure, dependencies)` and `KeyIndex.setInstalled(environments, dependenciesOf)` (sets env hashes and segments, re-keys each changed file once, so no key passes through a mix).
- `src/core/scheduler/lockfiles.ts`, `Lockfiles.set` returns `Map<ProjectName, DependencyKeys>`, reads a shared lockfile once per call, and calls its `note` once per change of a lockfile's stale note. The note callback comes from `KeyingOptions.note`, set in `scheduler.ts` (one line, agreed).
- `src/core/scheduler/keying.ts` (agreed with the coordinator): `WorktreeKeys` keeps the runner closures it already kept and asks `DependencyKeys.of(runner.packages)` in `setClosure` and in `setEnvironments`.
- `src/runners/vitest/graph.ts`: `importClosure` and `directImports` also return `bare` (importer -> package names Vite left bare) and `builtins`. `builtinOf`, `packageName` exported.
- `src/runners/vitest/packages.ts`: `closurePackages(graph, paths)` turns package entry files (`<dir>/node_modules/<name>/…`, from `<dir>`) and bare names (from the importer's directory) into `PackageImport`s; entries outside the worktree are dropped. `environmentPackages` adds `vitest` from the project root, the setup and `globalSetup` closures' packages, and es-module-lexer imports plus literal `require`s of every project-file config.

## Measurements

`measure-cezar.mts` here, run against `/tmp/ppk/cezar-origin` (the research's `origin/main` export with `npm ci`, `c7fa7178`) and the main checkout `/home/agent/projects/cezar` (`13351da8`), Vitest 4.1.10, machine load 12 to 28:

| | |
|---|---|
| Test files | 632 (projects `api-client`, `contract`, `server`, `web`) |
| Reach `child_process` | 306; any of the four opaque builtins: 308 |
| Kept, main checkout's lockfile read as-is (research F3's pair) | 323, none of them reaching `child_process` or any opaque builtin |
| Kept, main checkout under npm's rule | 0: its lockfile does not list `node_modules/@fontsource/poppins`, so every file keys by the whole fingerprint (001-104, as decided) |
| Kept, `origin/main` against itself | 632 |
| Keying all 632 (dependency keys for 4 projects plus 632 segments) | 52 ms, cold graph and types-only cache included |
| Reading the lockfile (staleness check, parse) | 19 ms |
| Closure walk of all 632 through the adapter (Vitest start included) | 13.6 s |

Real bootstrap (the coordinator asked for it): `/tmp/sq105/A`, a clone of the `origin/main` export with its `npm ci` install copied in, ran under a Squeal daemon built from this branch (`tsc` into `node_modules/.cache/squeal-105`, not `dist`). `/tmp/sq105/B`, a `git worktree add` of it with the main checkout's `node_modules` (root, `packages/cezar`, `packages/web`) copied in and the one unlisted folder `@fontsource/poppins` removed, so npm, and Squeal, trust its hidden lockfile, started fresh with `baseline.onStart: "lookup-only"` while A's baseline was still running. `compare-worktrees.mts` over the store: B keyed all 632 files, 323 share A's key, none of them reaching `child_process`; B's status showed 537 results already inherited from the part of the suite A had finished (A's baseline, 14,593 tests at load 25, was stopped there). The share equals the script's, since both go through the same adapter and keys.

The research counted 324; this run 323. Not traced; the environment set here also holds the config's bare imports for the `web` project (`@tailwindcss/vite`, `@vitejs/plugin-react`), which the research's `perfile.mjs` derived the same way, so the difference is likely one file's first hop. Both are above the 300 the board row asks for.

## Decisions the spec did not settle

- `cluster` joins `child_process`, `worker_threads` and `module` as a builtin that sends a file to the whole fingerprint: it forks processes. No `cezar` file is affected by the addition (306 reach `child_process`, 308 any of the four).
- The config files' builtins count like the setup files': a config that imports `module` can `require.resolve` a plugin no import names, so such a project keys every file by the whole fingerprint. None of `cezar`'s configs import one.
- A package entry or bare import outside the worktree (Vitest resolved from a parent directory, as in Squeal's own fixtures) is left out of the key. The whole fingerprint of this worktree's install did not cover it either.
- A file the runner reports no packages for keys by the whole fingerprint; an empty report (`{ imports: [], builtins: [] }`) keys by the empty set. That is the line the 002/003 coordinator agreed for `node:test` until 003-22.
- The fixture bump of `@types/node` re-keys exactly one file, `spawn.test.ts`, which reaches `child_process` and so keys by the whole lockfile. The board row's "re-keys none" holds for every file that does not fall back.
- Restored closures (from `test_files` at bootstrap) carry no packages and key by the whole fingerprint; the bootstrap's recheck resolves them through the runner on a miss. A store column for the packages would save that runner call per file; left out by the coordinator's decision.

## Tests touched outside the row, by agreement

- `test/daemon/install-wait.test.ts`: its fake install was a stale hidden lockfile (`{}` beside an unlisted link), which the newly wired note named, tripping its `/vitest/i` filter. It now lists the link.
- `test/scheduler/validity.test.ts`, `test/scheduler/runs.test.ts`: their lockfile edit (`"left-pad":"1.3.0"`, no package entry) changed nothing a test loads, so no key moved under scheme B. They now list a package with no folder (stale, so every key moves). The nested-project case is covered the scheme B way in `test/keys/packages.test.ts`.

## Not done, for a later row

- pnpm (`node_modules/.pnpm/lock.yaml` `snapshots`) and yarn keep the whole fingerprint.
- An externalized package that itself spawns (`execa`) or calls `require.resolve` is not seen: scheme B checks only the project files' imports, as the research's 324 did.
- `plugins/claude-code/dist` and `plugins/codex/dist` are not rebuilt (the row does not own them), so the two committed-bundle tests fail until the coordinator rebuilds.

## 001-109 repair (review wave-11b B1 to B3, S1 to S3, N1 to N4)

Worker notes, 2026-10-07.

### Seam map additions

- `src/runners/vitest/loads.ts` (new): `sourceLoads(source)` finds literal `require("x")` specifiers, a load no specifier names (`require.resolve`, `createRequire`, `import.meta.resolve`, `require(` with anything but one string literal) and the docblock environment (Vitest's own regex). `moduleLoads(file, transform)` caches it per transform object, like `dynamic.ts`. `environmentPackage(name)` maps an environment name to the package Vitest loads.
- `src/runners/vitest/graph.ts`: `importTargets` adds the scan's literal requires as bare names or builtins, and `module` for an unnamed load. `ImportClosure` gains `rooted` (packages looked up from the project root: the entry's docblock environment) and `root`.
- `src/runners/vitest/packages.ts`: `installedEntry` turns a `node_modules` path into a `PackageImport`, `"unnamed"` (no package, such as `.vite/deps_ssr`: reported as `module`) or `null`, and marks an import of `<name>/package.json` as `manifest`. `environmentPackages` adds `namedByConfig` (environment, reporters) and `configModules` (`snapshotSerializers`, `runner`, `snapshotEnvironment`, `diff`, which Vitest resolves to paths), and reports `runner`: `vitest` and the config files' imports.
- `src/core/keys/package-scans.ts` (new): `PackageScans`, the types-only and opaque scans by identity. `Lockfiles` keeps one per daemon (in memory; a restart scans again).
- `src/core/keys/packages.ts`: `InstalledGraph.opaque(identities)`; a `manifest` import adds the package's identity without its closure, even for a types-only package.
- `src/core/keys/dependencies.ts`: a segment holding an opaque identity is `whole:`; an opaque environment identity outside the runner's closure (`RunnerPackages.runner`) puts the whole fingerprint in the environment hash.
- `src/core/scheduler/install-stamp.ts`: `InstallStamps.takeChange` and `refreshInstall`; `scheduler.ts#pump` calls them before selecting a tier (by agreement with the coordinator). `lockfiles.ts` takes a `persisted` predicate, wired in `keying.ts` from `persistedNoteTexts`.

### Measurements

`measure-cezar.mts` (extended) on `/tmp/rv106/cezar` (fresh `npm ci` of `c7fa7178`) against the main checkout `/home/agent/projects/cezar` (`13351da8`), load average 7 to 42:

| | |
|---|---|
| Kept, main checkout's lockfile read as-is | 265 of 632 (was 323), none keyed by the whole fingerprint |
| Whole fingerprint | 367: 310 through builtins or an unnamed load (306 `child_process`; B2 adds two, `import.meta.resolve('tsx')` in `packages/cezar/src/artifacts/lifecycle.ts` and `delegation/provision.ts`), 57 through opaque packages |
| Opaque packages behind the 57 | 56 `web` files: `commander`, `es-toolkit` (`dist/server/exec.js`), `import-meta-resolve`, `marked` (`bin/main.js`), `katex`'s and `mermaid`'s nested copies; 1 `server` file: `cross-spawn` |
| Environment hashes | scoped in all four projects; with the config plugins checked, `@tailwindcss/vite`'s closure (`@tailwindcss/node`, `@tailwindcss/oxide`, `enhanced-resolve`) is opaque and all 632 files fell back |
| Opaque scan of all 555 installed packages, cold | 0.75 to 0.84 s; 26 opaque |
| A daemon's first keying (632 files, scans included) | 0.39 s, of which 0.29 s scanning the 177 packages segments reach; 97 ms with the config plugins checked (13 scans) |
| Keying again, warm scan cache, fresh graph | 64 ms (5 ms in a quieter run) |
| Lockfile read | 22 to 27 ms |

### Decisions the spec did not settle

- **The config file's imports are exempt from the opaque check, like `vitest`.** They are plugins: they run in Vitest's own process and no test file imports them, which is the human's wording for B3. Checking them sent every `cezar` file to the whole fingerprint. Setup and `globalSetup` packages, the environment's package and serializers stay checked; one that is opaque puts the whole fingerprint in the environment hash.
- **A docblock environment keys its test file, not the environment hash.** The brief said environment-wide. The docblock is in the test file, whose edit re-resolves its closure but does not re-read the environments, so only a per-file key follows an added or changed docblock. The package is looked up from the project root, as Vitest does.
- **`import.meta.resolve` counts as an unnamed load**, as the review's fix step said, even with a literal argument; so does `require.resolve` with one (the brief).
- **Unreadable is opaque.** A package folder the scan cannot read, or a project file gone since its transform, falls back. A test that deletes its install before asking for a segment now gets `whole:` (`test/keys/packages.test.ts` keeps its scratch installs until `afterEach`).
- **The opaque scan matches specifiers, not uses.** `"child_process"` and `"worker_threads"` in any string literal, `module` and `cluster` only as `node:` strings or arguments of `require`, `import`, `from`, `getBuiltinModule`; `require` without a word boundary, for bundlers' `__require`. A package is opaque when any of its code files matches, whether or not the test reaches that file (`es-toolkit`, `marked`).
- **S2's refresh runs whenever the stamp moved**, also after a lockfile rewrite whose revision reads the environments anyway; the second read re-keys nothing.

### Not done, for a later row

- Persisting the opaque scans in the store, so a restart does not pay 0.3 s again.
- Per-file opacity (only the files a package's entry reaches, or leaving `bin` files out) would keep the 56 `web` files; not decided.
- A relative `require("./x.cjs")` loads a project file that is in no closure; it is a closure gap, not a package one, and is not scanned.
- `node:test` (003-22) should report the same: `require` targets, unnamed loads as `module`, and `runner` for its own packages.
