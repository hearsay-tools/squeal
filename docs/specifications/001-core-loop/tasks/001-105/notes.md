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
