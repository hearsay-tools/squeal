# Runtime-equivalent hashing of JS/TS inputs (row 022-11)

Researcher task f4d15925, 2026-11-23, brief `runtime-hashing-brief.md`. Source read at commit `7b45dd289`. Tools: Node 22.19.0, 22.23.3, 24.15.0, 24.22.1, 26.13.0 (host default); web-tree-sitter 0.27.1 with tree-sitter-typescript 0.23.2 grammars; acorn 8.19.0; esbuild 0.28.2; Vite 8.3.2 (rolldown 1.2.16, oxc); Vitest 5.0.3; tsx 4.23.15; sucrase 3.35.1 (installed under `$TMPDIR` only). Probes: `probes/runtime-hashing/` (throwaway, see its README). Timings were taken at a one-minute load of 22.5 to 23.9 on 24 vCPUs. Runs at higher load were discarded.

## Questions answered

| # | Question | Answer |
| --- | --- | --- |
| 1 | Which transform mechanism | **Candidate B**: tree-sitter-tsx through Squeal's own parse rewrites (`src/core/code/count/parser.ts`), blanking with spaces. It falls back on 4 of 4,193 files, adds no dependency, and preserves every column. A (`stripTypeScriptTypes`) rejects parameter properties (114 files here), JSX and enums. It warns on every Node version, and its output follows the Node version's `amaro`. C (sucrase) erases a namespace that holds values (a false equivalence) and moves columns. |
| 2 | Correctness and the savings of each whitespace rule | The prototype passes 76 torture pairs. 0 false equivalences in 416 real edits. With identical hashes, the stack frames are identical under Node 22.19, Node 26 and Vitest 5. **Savings are small**: of 416 modified JS/TS file revisions in the last 200 commits, 34 run the same code by esbuild. Only 2 (`trim`) or 3 (`norm`) also keep every line in place. One residual risk: `fn.toString()` shows comments in function bodies under Vitest and Node. |
| 3 | Magic comments and `const enum` | Detect them on comment nodes: 2 files here have one. A text regex would flag 19. Vitest 5 also reads `@module-tag` and `@vitest-environment-options`, which the row's list lacks. Fall back to raw bytes for the whole file. |
| 4 | `emitDecoratorMetadata` discovery | Only Vite 8 (rolldown's native resolver) emits metadata, and only when `experimentalDecorators` is on too. tsx and esbuild ignore the flag, and Node reads no tsconfig. Today a Vitest key holds no tsconfig at all. Squeal's `parseJsonc` reads a broken tsconfig as empty, which fails open. |
| 5 | Commit keying cost | `git cat-file --batch`: 500 blobs (10 MB) in 103 ms, 1,500 blobs (19 MB) in 252 ms. Normalizing those blobs takes 6.4 s and 9.5 s. A memo lookup takes 1.2 ms per 1,500 files. Commit keying stays fast only with a **persistent** `(blob id, ext, normalizer version)` memo. |

## 1. Transform mechanism

**Candidate A, `node:module` `stripTypeScriptTypes`** (verified by experiment, `a-probe.mjs`, all five Node versions):

- **Output.** `mode: "strip"` gave byte-identical output on all five versions for 26 constructs. It blanks types with spaces, so lines and columns stay.
- **Comments.** It keeps comments, so a second pass (acorn's tokenizer) must blank them.
- **What it throws on, in every version:**
  - `enum` and `const enum`
  - a namespace with values
  - parameter properties
  - `<T>x` casts
  - JSX
  - `import x = require()` and `export =`
  - `override` in a class without `extends`. That last one is a type check, on a file that runs.
- **What passes:**
  - erased: `import type`, inline `type` specifiers, `export type *`, `interface`, `type`, `declare` (outside classes too), overloads, `abstract`, `this` parameters, `as`, `satisfies`, `!`, generic calls, a namespace with types only;
  - kept as written: decorators, `using`, `accessor`.
- **Side effects.** It keeps `import { type D } from './side'` as `import {        } from './side'`, so the side effect stays.
- **`transform` mode.** It worked on 22.x and 24.x. On Node 26.13.0 it throws `ERR_INVALID_ARG_VALUE` ("must be one of: 'strip'"): the mode is gone.
- **Warning.** Every version prints `ExperimentalWarning: stripTypeScriptTypes is an experimental feature`.
- **Engine version.** The engine is `process.versions.amaro`: 1.1.0 (22.19.0), 1.1.8 (22.23.3, 24.15.0), 1.1.11 (24.22.1, 26.13.0). The output did not differ on the cases tested. But a key built from it depends on the Node version of each worktree and CI job (inferred).

**Candidate B, tree-sitter-tsx** (verified by experiment, `strip.mjs`):

- **How it works.** It walks the tree and blanks with spaces each of these:
  - type annotations, type arguments and type parameters;
  - `interface`, `type` and ambient declarations, plus an `export` around them;
  - `import type`, inline `type` specifiers with one comma, `export type`;
  - overload and abstract signatures, index signatures;
  - `declare` and `abstract` fields;
  - accessibility, `readonly` and `override` on members;
  - `?` and `!` markers, `as …`, `satisfies …`, `!`;
  - `<T>` of a cast, `implements`, the `abstract` of a class, `this` parameters;
  - non-magic comments.
- **What it keeps.** It keeps the modifiers of parameter properties, enums, namespaces, decorators, `using` and `accessor`.
- **JS files.** A JS-family file only has comments blanked. A TS-only node in a `.js` file falls back, since `f<A>(x)` is a comparison in JS.
- **Fallback rates on the 4,193 tracked JS/TS files under `src/` and `test/`:**
  - The bare parse falls back on 60 files (1.4%): 53 `import("x")`-in-a-type, 2 `export type *`, 3 other, 2 magic.
  - Through Squeal's existing rewrites (`SQUEAL_PARSER=1`) and its `export type *` gap rule, it falls back on 4 (0.1%):
    - `src/core/store/repos/results.ts`: `i < unique.length` reads as a `unique` type operator, a gap of both grammars;
    - a fixture that is broken on purpose;
    - 2 files with magic comments.
- **Is `tree-sitter-typescript.wasm` needed?** Not for Squeal:
  - The TS grammar parses `<T>x` casts, which TSX reads as an `ERROR`, so they fall back safely.
  - It does not fix the `unique` gap.
  - Squeal has no file with an angle cast.
  - It adds 1.41 MB per plugin bundle.
  - It would lower the fallback rate only in projects with legacy casts.

**Candidate C, sucrase 3.35.1 + acorn** (verified by experiment, `cand-c.mjs`, `torture-c.mjs`):

- **Fallbacks.** 3 files here.
- **Lines and columns.** Lines stay in all 4,190 files it transformed. Columns do not: `const x: number` becomes `const x`.
- **False equivalence.** It emits nothing for `namespace N { export const x = 1 }`, so editing the value hashes the same.
- **Decorators.** acorn rejects them.
- **Cost.** It would be a new runtime dependency (1.7 MB unpacked).
- **oxc-parser** ships native `.node` bindings, so it is excluded (read in its installed package, 0.159.0).

**Cost** (verified by experiment, `corpus.mjs`, Node 26.13.0, 4,193 files, 24.9 M characters, load 23.4 to 23.9):

| | Cold start | Median | p90 | Max | Total | Fallback | New dependency |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A | 89 ms | 0.70 ms | 1.76 ms | 32 ms | 3.8 s | 118 (2.8%) | none (Node built-in) |
| B | 41 ms | 3.79 ms | 9.62 ms | 52 ms | 19.6 s | 4 (0.1%) | none (grammar already bundled) |
| C | 89 ms | 0.72 ms | 1.87 ms | 48 ms | 4.1 s | 3 (0.07%) | sucrase, 1.7 MB |

B's prototype is not optimized: it blanks by splitting the whole file into characters, and it builds both whitespace variants. Whether tree-sitter's parse or the walk dominates was not measured.

## 2. Correctness

**Torture pairs** (verified by experiment, `torture.mjs`, 76 of 76 as expected):

- **Comments and look-alikes.** Comments inside strings, templates, regexes and JSX text stay as they are. A JSX comment `{/* c */}` blanks. A hashbang and `'use strict'` stay. A triple-slash directive blanks.
- **ASI.** `return/*\n*/1` keeps its newline, so the ASI result stays. Removing that newline changes the hash.
- **Token gluing.** `a/* */-b` blanks to spaces, never to nothing.
- **Side effects.** All-type `import { type A } from './side'` keeps `import {   } from './side'` and differs from `import type`.
- **Class fields.** `declare y: number` differs from `y: number`, because a field emits `y;` under `useDefineForClassFields`.
- **Parameter properties.** `constructor(public x)` differs from `constructor(x)`.
- **Values stay.** `enum`, a namespace with values, decorators, `using` and `accessor` edits change the hash.
- **Fallbacks.** `const enum`, `declare const enum` and every magic comment fall back.
- **Parser gaps.** These cases parse through Squeal's rewrites and fall back without them:
  - `export type *`: same hash;
  - `typeof import()` in a type argument: same hash;
  - a bad escape in a tagged template: different hash.
- **Angle casts** fall back under the TSX grammar.

**Oracle replay on real edits** (verified by experiment, `history.mjs`):

- **Scope.** The last 200 non-merge commits, `d08d6b0aa..7b45dd289`. 101 touch JS/TS under `src/` or `test/`, giving 416 modified file revisions. Plugin bundles under `plugins/*/dist` are left out.
- **False equivalences: 0.**
  - Every pair `trim` or `norm` calls equal also has equal esbuild output.
  - The one disagreement is `test/fixtures/postcss.config.mjs`. There oxc keeps the edited top-of-file comment in its output.
- **Savings:**

| Rule | Equal file revisions (of 416) | Commits with every JS/TS file equal (of 101) |
| --- | --- | --- |
| raw bytes | 0 | 0 |
| `exact` (blank only) | 0 | 0 |
| `trim` (also no spaces at line ends) | 2 | 1 |
| `norm` (also collapse spaces, drop indentation) | 3 | 2 |
| esbuild output, no line rule (upper bound) | 34 | 3 |

- **Why so few.** 31 of the 34 runtime-equal edits change the line count, by −40 to +16 lines. Mostly they add or remove interface fields and type lines. 15 of the 34 are in `src/core/types/`.
- **Where savings already exist.** Squeal's Vitest closure is the transform graph (`src/runners/vitest/graph.ts`), and this repository sets `verbatimModuleSyntax`. So `import type` importers do not hold those files already (read in source code; the effect on seconds was not replayed).

**Line numbers** (verified by experiment, `lines/`):

| Variant | Edit | Hash | Frame (Node 22.19, Node 26.13 and Vitest 5.0.3) |
| --- | --- | --- | --- |
| `a.ts` | the base | | `5:13` |
| `b.ts` | other comments, imports and interface fields, same columns of code | `trim` same as `a.ts` | `5:13` |
| `c.ts` | an interface split over two lines | every mode changes | `6:13` |
| `d.ts` | two extra spaces before `new Error()` | `norm` same as `a.ts` | `5:15` |

**Horizontal whitespace.** `norm` gains 1 file revision over `trim` in 200 commits: an indentation-only change. It loses column fidelity, which matters because:
- Squeal's diagnostic fingerprint holds `path:line:column` (`src/core/state/fingerprint.ts:139`, `:184`, read in source code). A reused result would carry a stale column.
- A reused fingerprint would differ from a fresh run's.

Column-sensitive cases that every rule must keep verbatim:
- strings, templates, regexes;
- JSX text;
- whitespace between JSX children: `<p><b/> <i/></p>` renders a space.

**Residual risk** (verified by experiment, `$TMPDIR` copy of `lines/`):
- **What happens.** `Function.prototype.toString()` returns comments in function bodies:
  - under Vitest 5.0.3: oxc keeps `// inner note` and `/*! legal */`;
  - under Node 26 type stripping: all comments.
- **Effect.** A comment-only edit inside a function can change a test that snapshots `fn.toString()` or reads its own source. No such test was searched for. Its frequency is not determined.

## 3. Magic comments and `const enum`

- **Count here.** Detection on tree-sitter `comment` nodes finds 2 files in `src/` and `test/`. A regex over the raw text matches 19: 17 of them name a directive inside a string (verified by experiment). `const enum`: 0 files.
- **Vitest 5.0.3 reads from the raw file text**, strings included, with a plain regex (`vitest/dist/chunks/index.DpLw24bj.js:6034-6045`, read in source code):
  - `@(?:vitest|jest)-environment`
  - `@(?:vitest|jest)-environment-options`
  - `(\/\/|\*)\s*@module-tag`
- **Safety in strings.** A directive inside a string is still safe: strings are never blanked, so editing it changes the hash.
- **Missing from the row's list:** `@module-tag`, `@vitest-environment-options` and `@jest-environment`.
- **Coverage hints** (`ast-v8-to-istanbul` 1.0.8, `dist/index.mjs:190`, read in source code): `(istanbul|[cv]8|node:coverage) ignore (if|else|next|file|start|stop)`.
- **Other comments esbuild and oxc act on** (inferred from their presence in the Vite 8.3.2 and Vitest dist): `#__PURE__` / `@__PURE__`, `#__NO_SIDE_EFFECTS__`, `@vite-ignore`, `//# sourceMappingURL` and `sourceURL`. esbuild keeps `/*! … */` legal comments in its output (verified).
- **Fallback or verbatim.** Whole-file raw fallback costs 2 files of 4,193 here. Keeping magic comments verbatim is no simpler in B and buys almost nothing. A position-bound hint such as `v8 ignore next` is safe either way, because lines are kept. The prototype's pattern is `MAGIC` in `strip.mjs`.

## 4. `emitDecoratorMetadata` discovery

The facts below are read in source code; where the native resolver decides, they are verified by experiment with rolldown's `transformSync` (a subagent's report, checked against the paths it gave).

- **Vite 8.3.2.**
  - Vite reads no tsconfig in its JS. The `vite:oxc` plugin calls rolldown's native `transformSync` with a `TsconfigCache` (`vite/dist/node/chunks/node.js:7485-7569`).
  - Lookup: only `tsconfig.json`, the nearest one walking up from the source file, applied only when its `include` covers the file.
  - `extends` works as a string, an array, a relative path or a package. A solution-style root with `references` uses the referenced config that includes the file.
  - Metadata: `design:paramtypes` is emitted only with `emitDecoratorMetadata` **and** `experimentalDecorators`. `strict` changes nullable `design:type`.
  - Invalid JSON gives a `[TSCONFIG_ERROR]` transform error.
  - In watch mode Vite clears its cache only for files ending in `/tsconfig.json`, not for `extends` targets.
  - `vitest run` starts a fresh cache each process (`server.watch = null`).
- **tsx 4.23.15.**
  - One tsconfig per process: `TSX_TSCONFIG_PATH`, else get-tsconfig's find-up of `tsconfig.json` from the current directory, applied only to files it includes.
  - esbuild 0.28.2's `TsconfigRaw` has no `emitDecoratorMetadata` (`esbuild/lib/main.d.ts:97-113`), so under tsx the flag has no runtime effect.
- **Node type stripping** reads no tsconfig: a broken `tsconfig.json` did not stop `node a.ts` on 26.13.0.
- **Squeal today:**
  - **node:test.** `src/runners/node-test/graph/tsconfig.ts` follows `extends` (string, array, relative, package without `exports`). Its resolver adds the chain to each closure.
  - **Vitest.** No tsconfig reader at all. A touched tsconfig restarts the Vitest instance (`src/runners/vitest/touched.ts:20`), but `environmentFiles` (`src/runners/vitest/environment.ts:63-80`) does not hash it. So a tsconfig edit re-keys nothing.
  - **Parse failure.** `parseJsonc` returns `null` and the config "counts as empty" (`tsconfig.ts:26`). For this fallback that fails open: a broken tsconfig would read as "no metadata". It must read as "unknown, use raw bytes".
- **Files to track per Vitest project** (inferred): every `tsconfig.json` from each source file's folder up to the root, and their whole `extends` chains, including `node_modules` packages. With a solution-style root, add the referenced configs. `useDefineForClassFields`, `verbatimModuleSyntax` and the `jsx*` options also change emit. B keeps every construct they act on, so they do not need a fallback.

## 5. Commit keying and memoization

- **Today.** `transfer-rekey.ts` (018 D11) and commit keying (023, `src/core/commit/tree.ts`, `committedBlobs`) build keys from `git ls-tree` blob ids and read no file content (read in source code). Runtime hashes would add a content read and a parse per JS/TS blob.
- **Measured** (verified by experiment, `rekey.mjs`, Node 26.13.0, load 22.5 to 23.4, blobs spread across the 6,424 JS/TS paths of `HEAD`, plugin bundles included):

| Blobs | MB | `cat-file --batch` | Normalize (B) | Per file | Memo lookups | Fallback |
| --- | --- | --- | --- | --- | --- | --- |
| 500 | 10 | 103 ms | 6.4 s | 12.8 ms | 1.0 ms | 8 |
| 1,500 | 19 | 252 ms | 9.5 s | 6.4 ms | 1.2 ms | 22 |

- **Reading is cheap; parsing is not.** A cold daemon start that normalizes the 4,193 `src/` and `test/` files takes about 20 s on one thread.
- **A persistent memo fixes it** (inferred). Keyed by `(raw blob id, extension, normalizer version)`, a commit re-key or bootstrap then parses only blobs it has never seen. The entries are content-addressed and can be shared across worktrees and CI.
- **What the version must cover.** A grammar update, a rewrite rule change or a magic-comment list change must raise the version, as `COUNTER_VERSION` does for the code counter.
- **Raw-byte fallbacks** need no memo row beyond "raw".

## Recommendation for Squeal

- **The tradeoff.** On this repository's last 200 commits, runtime-equivalent hashing as the row defines it would leave unchanged 2 of 416 modified JS/TS file revisions. That is 1 of 101 commits.
- **The cost:**
  - a persistent memo table and a normalizer version;
  - about 20 s of parsing on a cold start;
  - every JS/TS file hash changes once, so every key moves once (inferred: a key-format decision);
  - the CI export and the code gate must hash the same way.
- **What would pay more.** A rule without the line requirement would leave 34 unchanged. But stack lines, failure locations and Squeal's fingerprints would then be stale for reused failures.
- **If it is built:**
  - Use Candidate B through the existing parser and its rewrites, with the `trim` rule: exact columns, line ends trimmed outside strings, templates, regexes and JSX. Not `norm`.
  - Do not add `tree-sitter-typescript.wasm`.
  - Keep whole-file raw fallback for magic comments, `const enum`, parse errors and TS syntax in JS files.
  - Add `@module-tag`, `@vitest-environment-options`, `@jest-environment`, `node:coverage` and `__NO_SIDE_EFFECTS__` to the list.
  - Read tsconfig fail-closed, with its `extends` chain, as Vite resolves it.

## Open questions for the human

1. **Build it at all?** Is a 0.5% file-level saving worth building, or should the row wait for a project whose history shows more same-line type and comment edits? This repository's savings in re-run seconds were not replayed.
2. **Line requirement.** Should the line requirement stay, with 3 of 34 runtime-equal edits caught? The alternative catches all 34 and lets reused failures keep their old line and column.
3. **`fn.toString()`.** Accept the comment risk, or keep comments inside function bodies in the hash?
4. **tsconfig in Vitest keys.** Squeal's Vitest keys do not hold tsconfig today, independent of this row (`emitDecoratorMetadata`, `experimentalDecorators`, `jsx*` change emit). Is that a separate row?

## Sources

- Probes: `probes/runtime-hashing/` (`a-probe.mjs`, `strip.mjs`, `cand-a.mjs`, `cand-c.mjs`, `torture.mjs`, `torture-c.mjs`, `lines/`, `corpus.mjs`, `history.mjs`, `rekey.mjs`).
- Squeal at `7b45dd289`:
  - `src/core/code/count/parser.ts`, `README.md`, `typescript.ts`
  - `src/core/keys/check-key.ts`
  - `src/core/hash/stat-cache.ts`
  - `src/core/state/fingerprint.ts`
  - `src/core/store/transfer-rekey.ts`
  - `src/core/commit/tree.ts`
  - `src/runners/vitest/graph.ts`, `environment.ts`, `touched.ts`
  - `src/runners/node-test/graph/tsconfig.ts`, `resolver.ts`, `graph.ts`
- tree-sitter-typescript 0.23.2 tarball: https://registry.npmjs.org/tree-sitter-typescript/-/tree-sitter-typescript-0.23.2.tgz. Its `tree-sitter-tsx.wasm` sha256 `79e5da75…` matches the vendored copy. `tree-sitter-typescript.wasm` sha256 is `778025db…`.
- Installed packages under `node_modules/.pnpm/`:
  - `vitest@5.0.3…/dist/chunks/index.DpLw24bj.js`
  - `vite@8.3.2…/dist/node/chunks/node.js`
  - `rolldown@1.2.16/dist/shared/binding-*.d.mts`
  - `esbuild@0.28.2/lib/main.d.ts`
  - `tsx@4.23.15/dist/`
  - `ast-v8-to-istanbul@1.0.8/dist/index.mjs`
- sucrase 3.35.1 and oxc-parser 0.159.0 from the npm registry, installed under `$TMPDIR` only.
