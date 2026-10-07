# Monorepo fixture

The three closure misses of `docs/specifications/003-node-test-runner/reviews/wave-1.md`, each a shape the reference fixture lacks. Every test passes on Node 22 and 24.

| Case | Run from | Command | What tsx loads |
| --- | --- | --- | --- |
| S1, `paths` inherited through `extends` | `packages/app` | `node --import tsx --test test/extends.test.ts` | `~/x` maps through `tsconfig.base.json` (no `baseUrl`) to `packages/app/src/x.ts`, relative to the base's directory. |
| S2, conditions by module format | `packages/legacy` | `node --import tsx --test test/dual.test.ts` | `packages/legacy` has no `"type"`, so tsx compiles the test to CommonJS and `@mono/dual` resolves with `require`: `packages/dual/src/cjs.cjs`, not `esm.mjs`. |
| N6, a computed `require` | `packages/legacy` | `node --import tsx --test test/computed.test.ts` | `require(name)` loads `packages/legacy/src/target.cjs`, which no static scan sees. |
| S3, a bare-specifier preload | `packages/app` | `node --import @mono/setup --import tsx --test test/extends.test.ts` | `@mono/setup` resolves through the workspace symlink to `packages/setup/index.mjs`, which imports `helper.mjs`. |

The `node_modules/@mono/*` symlinks are committed, as `npm install` would make them for the workspace.
