# 018-66 notes: node:test keying checked against real runs

Row 018-66 replaces the dropped row 018-62. Brief: `tasks/wave-24.md`. Code: `src/runners/node-test/graph/resolver.ts`, `tsconfig.ts`, `index.ts`, and `src/runners/node-test/adapter-project.ts`.

## Step 1: the guard

`test/runners/node-test/graph-differential.test.ts` generates small projects under `test/fixtures/node-test/.tmp/`, so `--import tsx` finds the repository's tsx. Each runs as `node --import tsx --test` (or without tsx) under the `module.registerHooks` recorder of `graph-observed.ts`. The test asserts three things:

- the run loads the modules the case names (the fixture really tests something);
- Squeal's closure holds every module the run loads (one path too wide is allowed);
- `affected` selects the test file when each loaded module changes.

A case with `TSX_TSCONFIG_PATH` goes through the adapter, with the variable in the project's env, as `squeal.config.json` gives it. A case whose test sits outside its `cwd` goes through the graph, since a project's globs stay under its `cwd`.

The brief expected the guard to pass on the graph of 0.1.585. It did not: eight of 26 cases were short there. They were committed as `it.fails` (5399c438a) and became plain tests in step 2:

- `?query` and `#hash`: the graph kept `dep.ts?query=1` as a path, so a change to `dep.ts` selected nothing;
- review r2 B4, generated: an alias (wildcard, exact, `baseUrl`) from an importer outside the tsconfig's folder, with the tsconfig found from the cwd and named by `TSX_TSCONFIG_PATH` (six cases);
- the importer's nearest tsconfig maps the alias elsewhere; tsx reads the one from the cwd.

Step 2 added two more cases, both short on the old graph: an alias whose first target names no file, and a CommonJS `require` through an alias in a `.cts` file. All 28 pass after step 2. Reviews `0.1.585.md` B1 and B2 (`{ type as Value }`, the divisions, the literal `require`) pass on both graphs: no code-text elision exists now.

## Step 2: what tsx 4.23.15 does, and what the graph now does

Read from `node_modules/tsx/dist/register-*.mjs` and `require-*.mjs` (minified):

- `loadTsconfig(process.env.TSX_TSCONFIG_PATH)`: that file, or `getTsconfig(process.cwd())`, the nearest from the cwd up. One config for the process.
- `resolveTsPaths`: when the specifier is an alias candidate and the parent is not under `node_modules`, try each target of `resolvePathAlias`, then the specifier as written. The importer's folder is not checked.
- `resolvePathAlias`: no target for `.`, `..` or a path under them, an absolute or relative path, or a URL or a `data:`, `file:` or `node:` specifier. Else an exact pattern's targets; else the wildcard with the longest prefix; with no match, `baseUrl/<specifier>` only when `baseUrl` is set. Targets resolve against `baseUrl`, else the folder of the config whose `paths` win (`implicitBaseUrl`).

The graph:

- `compileAliases` and `aliasCandidates` in `tsconfig.ts` do the same matching over `readTsconfigPaths`'s chain.
- `createResolver` takes `{ cwd, tsconfigPath }` and finds one config: `TSX_TSCONFIG_PATH` against `cwd`, or the nearest from `cwd` up, stopping at the worktree root. Its chain files are keyed for every resolution, as before.
- `targetOf` tries each alias target with the plain resolver, then the specifier. A builtin name loses to an alias target that resolves, as in tsx (`"*"` paths).
- enhanced-resolve's own `tsconfig` option is no longer used. Its plugin applies a config only to importers inside the config's folder (`_selectPathsDataForContext`); that was B4.
- `resolveOne` takes `request.path` from the resolve callback, so `?query` and `#hash` are dropped.
- `clear()` is unchanged: the process config is cached in `tsconfigPaths`, which `clear()` already resets, and its aliases in a `WeakMap` keyed by that chain object. An edit to `clear()` is a changed line that no validity case runs, and the alarm fails on it.

Not done, by the brief: no value import is dropped by reading code (018-62's b2 and b3).

## Key format

Two cases in `test/keys/validity/cases/adapter/node-test.ts`: one tsx project, run once with the config found from the cwd and once with `TSX_TSCONFIG_PATH=run/tsconfig.json`. The second config's first alias target names no file, so the resolver's failed-resolution branch runs. `test/keys/key-format.test.ts` passes through Squeal at revision 16 (current): keys differ and outputs agree, so the alarm asks no `NODE_TEST_ADAPTER_VERSION` raise. Every stored node:test result runs once more per store, which the human accepted on 2026-11-21 for 018-62.

## Limits left

- tsx's upward tsconfig search goes past the worktree root; the graph's stops there. A project whose only tsconfig sits above the worktree keys no aliases. This was so before.
- tsx applies `.js` → `.ts` only for a TypeScript parent or with `allowJs`; the graph applies it always. That keys too wide or picks the `.ts` twin, as before (the `pair` note).
- es-module-lexer rejects JSX with a closing tag (018-62 notes). The `.tsx` case uses a self-closing element.
- `resolver.ts` is 323 lines, over the 300-line guide.
