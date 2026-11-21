# 018-62 notes: node:test graph keying, after repair row 018-65

Row 018-62 (`research/node-test-left-out.md`, finding b) fixed four faults in the node:test graph. Review `reviews/0.1.585.md` failed two of them (B1, B2). Repair row 018-65 removed those two and wrote these notes (review N1). Code: `src/runners/node-test/graph/` (`resolver.ts`, `parse.ts`, `index.ts`) and `src/runners/node-test/adapter-project.ts`.

## What stays

- **b1: the tsconfig tsx loads.** tsx 4 reads one tsconfig for the whole process: `TSX_TSCONFIG_PATH`, relative to the cwd, or else the nearest `tsconfig.json` from the cwd up. The graph used each importer's nearest tsconfig. Now the resolver resolves every importer with that one config and its `extends` chain, and keys those files (`projectTsconfig` in `resolver.ts`). The upward lookup stops at the worktree root. `adapter-project.ts` passes `TSX_TSCONFIG_PATH` from the project's env in `squeal.config.json`, with `process.env` under it (`projectEnv`). Under Node's own rules no tsconfig is read or keyed.
- **b4: `?query` and `#hash`.** enhanced-resolve appends the query and the hash of a specifier to the path it returns. Node loads the file without them. The resolver now takes `request.path` from the resolve callback, so the closure holds the file.

Both only remove paths Node never reads, so neither can key less than Node loads.

## What was removed, and why

- **b2: imports esbuild drops** (`type-imports.ts`, `keepsValueImports` in `tsconfig.ts`, the re-parse on a tsconfig change in `modules.ts`). It read the code text to decide that each binding of an import was used only as a type. Review B1: `import { type as Value }` imports a value named `type`, and the binding check read it as the inline `type` modifier, so the graph dropped a module Node loads. Review B2: the shared `codeAt` guess reads some divisions (`({ return: 8 }).return / Value / 2`, `{ valueOf: () => 8 } / Value / 2`) as a regular expression, and the text between them as not code. The import's only use then looked absent.
- **b3: literal `require` in code only** (the `codeAt` filter on the literal `require` scan in `parse.ts`). Same B2 fault: `{ valueOf: () => 8 } / require("./dep.cjs") / 2` hid the require.

The coordinator's decision: the graph keeps every import Node could load. An error in a read of code text that drops an import keys less than Node loads, and that gives a wrong pass. An error in the other direction keys one path too many, and costs a re-run. So each value import and each literal `require`, in code, a string or a comment, stays a specifier, as before row 018-62. `codeAt` still decides only whether a computed `require(x)`, `getBuiltinModule` or `import.meta.resolve` counts; there a wrong guess makes the closure incomplete or wider, never shorter.

`parse.ts` keeps 018-62's `lexImports` split, without the elision, so `parseModule` stays at complexity 15.

## Tests

`test/runners/node-test/graph-keying.test.ts`. Each case of the review runs a real `node --test` (under `--import tsx`, and for CommonJS also without it) whose test passes only when `dep` loads, and asserts that the graph's closure holds every module that run loads and that a change to `dep` selects the test:

- B1: `import { type as Value } from "./dep.ts"`;
- B2: a value import after `({ return: 8 }).return / Value / 2`, and after `{ valueOf: () => 8 } / Value / 2`;
- B2: a literal `require("./dep.cjs")` after `{ valueOf: () => 8 } / ... / 2`, under Node's rules and under tsx;
- an import tsx drops (`import { type Value }`): the graph keys `dep.ts`, which the run never loads; one path too wide;
- the review's positive controls: an enum, a value re-export, a side-effect import, a mixed inline type and value import, a template expression, JSX in `.tsx`.

The five review cases and the too-wide case fail on candidate 0.1.585 (`25b7b41ea`) and pass after the repair. The b1 and b4 tests stay. The validity case "a tsx project's keys follow what tsx loads" keeps its fixture; its import used only as a type and its `require` in a string now stay keyed.

One observation, not changed: es-module-lexer rejects JSX with a closing tag (`<div>{Value}</div>`), so that module's closure is incomplete (`does not parse as a module`). That leaves the file out; it does not give a wrong pass. The control uses a self-closing element.

## Key format

`test/keys/key-format.test.ts` after the repair, at the repair's head: 12 of 12 pass, through Squeal (`squeal status --wait`, a current pass) and in one direct run under `timeout 600` (`KEY_FORMAT_VERSION > moves only when the validity path's outputs differ from the last release's`, 13.7 s). The alarm asks no `NODE_TEST_ADAPTER_VERSION` raise: b1 and b4 move node:test keys, and the stored outcomes equal the last release's. As accepted by the human on 2026-11-21, every stored node:test result runs once more per store. The removal of b2 and b3 moves fewer keys than the candidate did, since those closures return to their earlier paths.
