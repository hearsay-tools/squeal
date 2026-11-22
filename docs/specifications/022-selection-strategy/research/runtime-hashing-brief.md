# Research brief: runtime-hashing (row 022-11)

Read `docs/vision.md`, `docs/styleguide.md`, `docs/process.md`, `../spec.md`, `../status.md`, and the rules for findings documents in `README.md` (this folder) first. Those rules apply here.

The human authorized row **022-11** on 2026-11-22: hash JS/TS/JSX/TSX/MJS/MTS/CJS/CTS module inputs in test closures by their line-preserving runtime-equivalent emitted JS (stripping TypeScript type-only syntax and non-magic comments while preserving line positions so stack traces and inline snapshots never shift), skipping re-runs on type-only and comment-only edits without coverage or purity heuristics.

Required fallbacks to raw-byte hashes (settled by the row):
1. Any path reached via `observed.` raw-data reads or declared `inputs`.
2. Any file holding `const enum` or a magic comment (`@vitest-environment`, `@vite-ignore`, `#__PURE__`, `@__PURE__`, `webpackIgnore`, `v8`/`c8`/`istanbul ignore`, plus check JSX pragmas like `@jsx`, `@jsxImportSource`, `@jsxFrag`, `@jsxRuntime`).
3. Any project with `emitDecoratorMetadata: true` in `tsconfig`.
4. Any file that fails to parse.

Write `docs/specifications/022-selection-strategy/research/runtime-hashing.md` and throwaway probes under `docs/specifications/022-selection-strategy/research/probes/runtime-hashing/`. Touch nothing outside `docs/specifications/022-selection-strategy/research/`. Do not design the feature; answer, measure, and recommend.

## Constraints from Squeal's architecture

- Shipped plugin bundles (`src/harness/build.ts`, `plugins/*/dist/cli/squeal.mjs`) are single-file ESM bundles targeting Node `>=22.19` with zero native `.node` addons. `web-tree-sitter` (`^0.27.1`) and `tree-sitter-tsx.wasm` (`src/core/code/count/tree-sitter-tsx.wasm`) are already runtime dependencies and already copied into every plugin bundle. `acorn` (`^8.19.0`) and `es-module-lexer` (`^3.0.3`) are already runtime dependencies. `esbuild` and `typescript` (7.0.2, no parser API) are devDependencies only.
- Hashing must be a pure, deterministic function of a single file's bytes and extension (no old-vs-new diff needed), because Squeal keys are content-addressed and shared across worktrees, CI exports (`018`), code gate (`020`), and commit keying (`023`).
- `StatCache` (`file_hashes`) keeps raw git blob OIDs; runtime-equivalent hashes layer above it, memoized by `(rawBlobHash, ext)` (or equivalent).

## Questions

1. **Transform mechanism comparison.** Compare concrete candidates that fit Squeal's Node `>=22.19` single-file ESM plugin bundles (zero native `.node` addons) across `.js`, `.ts`, `.jsx`, `.tsx`, `.mjs`, `.mts`, `.cjs`, `.cts`:
   - **Candidate A:** `node:module`'s `stripTypeScriptTypes` (`mode: "strip"`, and check `"transform"`) + a lexer/parser comment stripper. Check exact Node 22.19+ vs Node 26 behavior (check available Node versions under `~/.nvm` if present) and list every construct it rejects (JSX/TSX, `enum`, `namespace`, parameter properties, decorators, `satisfies`, `using`, etc.).
   - **Candidate B:** `web-tree-sitter` + `tree-sitter-tsx.wasm` (already bundled; zero new dependencies) doing a line-preserving AST strip of TypeScript type-only nodes and non-magic comments. Measure its grammar gaps on real files (`export type * from`, tagged template escapes, `import("x").T`, legacy `<T>x` casts in `.ts`, etc. — see `src/core/code/count/README.md` and `parser.ts`) and whether `tree-sitter-typescript.wasm` is needed alongside `tree-sitter-tsx.wasm`.
   - **Candidate C:** Any pure-JS/WASM option (e.g. `acorn` for JS + hybrid for TS, or a lightweight pure-JS/WASM stripper such as `sucrase` if evaluated without adding to `package.json` — read docs/source or test in `$TMPDIR` only if available; do not edit `package.json` or lockfiles).
   - For each viable candidate, measure on Squeal's JS/TS files (`src/` and `test/`): parse-failure / fallback rate, cold-start ms, median/p90/total ms (with 1-minute host load), and bundle/dependency impact.

2. **Correctness and zero-false-equivalence torture cases.** Prototype the top candidate(s) in `research/probes/runtime-hashing/` and verify against real Node / Vitest behavior:
   - Comments inside strings, template literals, regexes, JSX text (`<div>// not a comment</div>`), JSX comments (`{/* c */}`), hashbangs (`#!/usr/bin/env node`), directives (`'use strict'`), triple-slash directives (`/// <reference ...>`), source-map comments (`//# sourceMappingURL=...`).
   - TypeScript syntax: `import type`, inline `import { type A, B }`, all-type `import { type A } from './side-effect'` (side-effect preservation!), `export type`, `export type *`, `interface`, `type` alias, `declare` declarations and class fields, function/method overloads, `abstract`, `implements`, `override`, `readonly`, visibility modifiers vs **constructor parameter properties** (`constructor(public x: number)`), `this` parameter, `as`, `satisfies`, `!` non-null assertions, generic type arguments `f<T>(x)`, `enum` vs `const enum`, `namespace` (type-only vs value-bearing), decorators, `using`/`await using`, `accessor`.
   - Token-gluing and ASI hazards (`return/*\n*/1`, `a/* */b`, `x! + 1`, `a as T + b`, `1/**/in x`).
   - Line-number preservation: confirm same-line-count type/comment edits keep identical `new Error().stack` line numbers and hash identically, while newline additions/removals change the hash.
   - Horizontal whitespace normalization (collapsing/trimming spaces on a line vs preserving exact column widths): test whether exact-column space-blanking loses meaningful savings on Squeal's last 200 commits vs horizontal whitespace normalization, and name any column-sensitive edge case.

3. **Magic comments and `const enum` detection.**
   - Verify exact AST-comment detection (never matching inside strings/templates/regexes) for `@vitest-environment`, `@vite-ignore`, `#__PURE__`, `@__PURE__`, `webpackIgnore`, `v8`/`c8`/`istanbul ignore`, and JSX pragmas (`@jsx`, `@jsxImportSource`, `@jsxFrag`, `@jsxRuntime`). Check if Vite/Vitest has any other runtime-affecting comment directive (e.g. `@jsx`, `@vitest-pool` if any).
   - Compare whole-file raw fallback on presence of a magic comment vs keeping magic comments verbatim in normalized output (complexity, safety, and how many files in Squeal hold magic comments).

4. **`emitDecoratorMetadata: true` tsconfig discovery.**
   - Inspect how Vitest/Vite and `node:test` (`tsx`) resolve `tsconfig.json` (including `extends` chains — string, array, relative, `node_modules` package — and `references` / `tsconfig.*.json`), and inspect `src/runners/node-test/graph/tsconfig.ts` (`readTsconfigPaths`, `parseJsonc`).
   - Identify which tsconfig files must be watched/tracked per project so toggling `emitDecoratorMetadata` immediately re-keys the project, and whether any subtlety exists when a tsconfig fails to parse (fail-closed to raw bytes).

5. **Commit-keying (`git cat-file --batch`) and memoization cost.**
   - Measure `git cat-file --batch` reading 500 and 1,500 committed JS/TS blobs from this repository (without working-tree reads) plus running the top candidate normalizer, with 1-minute host load. Verify whether memoizing `(rawBlobHash, ext) -> runtimeHash` keeps commit re-keying (`transfer-rekey.ts`, `at-keys-ci.ts`) and daemon bootstrap fast.

## Limits

- Read-only on the product: touch nothing outside `docs/specifications/022-selection-strategy/research/`.
- No full test suite, no `squeal run --all`, no `package.json` or lockfile edits.
- Run experiments in `$TMPDIR`; clean up any temporary processes or dirs before finishing.
- Commit `docs/specifications/022-selection-strategy/research/runtime-hashing.md` and `probes/runtime-hashing/` on your worker branch when done.
