# 003-37 with 004-19 notes: what a test file's run loads

## What the recorder sees (Node 24.21.0, measured)

One line per resolved edge, now `{"parent","url","specifier"}`:

| Load | `parent` | `specifier` |
| --- | --- | --- |
| `--require ./pre.cjs` (argv or `NODE_OPTIONS`) | `null` | `./pre.cjs` |
| `--import ./pre.mjs` | the cwd's directory URL, `file:///<cwd>/` | `./pre.mjs` |
| the test file, and any spawned process's entry point | `null` | the entry's `file:` URL or absolute path |
| `createRequire(<dir>/package.json)("./x.cjs")` | `file:///<dir>/package.json`, never itself loaded | `./x.cjs` |

So `parent` alone cannot tell a `--require` preload from an entry point, and nothing tells a `createRequire` base from an `--import`'s cwd URL except the specifier. `observedClosure` therefore roots the preloads only where an unparented edge's specifier is one of the run's preload values: `preloadSpecifiers` over the child's `NODE_OPTIONS` tokens and the project's argv (`run.ts`). Every other unparented edge roots the test file. A preload missed by that match lands in each file's own closure instead; since every file's process loads its preloads, that costs keys per file, never a missed run.

The `node --test` parent process records too (`graph-<i>-<pid>` of its own): only the `--require` preloads, no `--import` (argv or `NODE_OPTIONS`).

## Slow projects

`childEnv` always prepends `--require "<recorder>"` to a slow project's `NODE_OPTIONS`. The spawned process inherits `SQUEAL_NODE_TEST_GRAPH` and writes `graph-<i>-<its pid>.ndjson`, which `graphs()` already collected. A test that spawns with its own `env` not carrying those two variables still goes unobserved; the bare-file note names such a file when nothing else of the project was observed.

## The bare-file note (lessons.md defect 6)

`bareNote` in `adapter-project.ts`: after each run, test files whose observed `paths` are only the file and manifests (`MANIFEST`, now exported from `graph/graph.ts`), each named once per adapter. The adapter does not see policy `inputs` (the core applies them), so a file with declared inputs is still named once.

## `readFileSync(new URL(<literal>, import.meta.url))`

A small change, not built here. `parse.ts` would scan `new URL("<./ or ../ literal>", import.meta.url)` in code (`codeAt`) into a new `ParsedSpecifier` kind, and `modules.ts` `resolveModule` would add `join(dirname(file), literal)` to `deps` the way the `glob` branch adds its matches: a parsed extension is followed, anything else is a leaf, and a missing target belongs in `candidates`. About 15 lines plus tests. Because it is a dep, the spawn-cli test's `new URL("../bin/cli.mjs", import.meta.url)` would bring `bin/cli.mjs` and `lib/helper.mjs` into the static closure of a fast project too. Raise the adapter version with it.
