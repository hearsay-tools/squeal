# Edge-case fixture

Run from this directory: `node --import tsx --test test/<file>`.

## `test/forms.test.ts`: every specifier form of spec 003 D3

One test per form, each passing. "Static closure" is what D3's graph builder must see without running anything.

| Form | Specifier in `forms.test.ts` | Target | Static closure |
| --- | --- | --- | --- |
| `.js` meaning `.ts` | `../src/js-means-ts.js` | `src/js-means-ts.ts` | yes |
| extensionless | `../src/extensionless` | `src/extensionless.ts` | yes |
| directory `index` | `../src/dir` | `src/dir/index.ts` | yes |
| tsconfig `paths` | `~/paths-target` | `src/paths-target.ts`, and `tsconfig.json` as a resolution read | yes |
| package `imports` | `#hash/target` | `src/hash/target.ts`, and `package.json` as a resolution read | yes |
| `exports` subpath | `@edge/lib/sub` | `lib/src/sub.ts` | yes |
| symlinked workspace package | `@edge/lib` through `node_modules/@edge/lib -> ../../lib` | `lib/src/index.ts` at its real path, `lib/package.json` | yes |
| `export ... from` | `../src/barrel.ts`, which re-exports `./reexported.js` | `src/barrel.ts`, `src/reexported.ts` | yes |
| `import type` | `import type { Shape } from "../src/types.js"` | `src/types.ts` | no: type-only, dropped; not loaded at run time either |
| literal `import()` | `import("../src/dynamic-literal.ts")` | `src/dynamic-literal.ts` | yes |
| template-literal `import()` | ``import(`../src/plugins/${name}.ts`)`` | `src/plugins/alpha.ts`, `src/plugins/beta.ts` | yes, every file the glob `../src/plugins/*.ts` matches |
| computed `import(p)` | `import(p)`, `p` joined at run time | `src/computed-target.ts` | no: closure `complete: false`, the recorder observes the target |
| `require` through `createRequire` | `require("../src/legacy.cjs")` | `src/legacy.cjs`, which requires `src/legacy-dep.cjs` | yes, by the literal `require(...)` scan |
| JSON with `with { type: "json" }` | `../src/data.json` | `src/data.json` | yes |
| `readFileSync` of a fixture | `new URL("../src/read-me.txt", import.meta.url)` | `src/read-me.txt` | no: an `fs` read, declared in `inputs` |
| `child_process` script | `execFileSync(process.execPath, [src/child.mjs])` | `src/child.mjs`, which imports `src/child-dep.mjs` | no: a spawned process, not observed either (open question 3), declared in `inputs` |

## Outcome cases

| File | Outcome on Node 22 and 24 |
| --- | --- |
| `test/pass.test.ts` | One passing test, importing `@edge/lib`. |
| `test/fail.test.ts` | One pass, one `test:fail` named `fails` with `failureType` `testCodeFailure` and an `assert.equal(1, 2)` cause; exit 1. |
| `test/syntax.test.ts` | No named check; the file wrapper fails with cause `test failed`; stderr holds tsx's `syntax.test.ts:3:14: ERROR: Unexpected "="`; exit 1. |
| `test/missing-import.test.ts` | No named check; the file wrapper fails; stderr holds `ERR_MODULE_NOT_FOUND` for `src/does-not-exist.js`; exit 1. |
| `test/busy-loop.test.ts` | Never completes; only an outside deadline ends it. Run beside `pass.test.ts`, the pass file's wrapper `test:complete` arrives before the kill on both versions; the busy file has none and no `test:summary` is written. Node 22 does not emit the pass file's inner `test:pass` before the kill; Node 24 emits its inner `test:complete`. |
| `test/duplicate.test.ts` | Four passing tests named `same name`: two in `describe("suite")` at lines 5 and 6, two top-level at lines 8 and 9, lines correct with `--enable-source-maps`. |
