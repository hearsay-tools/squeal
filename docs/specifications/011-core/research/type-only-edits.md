# 011-149: edits that change only types or comments

Researcher of row 011-149, 2026-10-23, 13:17Z to 13:55Z. Brief: `research/type-only-edits-brief.md`. Read: `docs/vision.md`, `docs/styleguide.md`, `research/edit-load.md` (findings 1 and 3), `research/key-format-guard.md`, 011 C3, C12, C14 and `status.md` (011-37, 011-60, 011-85).

Versions: clones under `/tmp/to149` of squeal `88f90431c` (Vitest 5.0.3, Vite 8.3.2, rolldown 1.2.12, esbuild 0.28.2, TypeScript 7.0.2), cezar `565fd3eaf` (Vitest 4.1.10, Vite 8.1.4, esbuild 0.28.1, tsx), toolkit-dev `7f939fb9` (Vitest 4.1.11, Vite 8.3.4); Node 24.21.0. Store copies taken 13:20Z. One-minute load 25 to 64 during the probes. Probes, outputs and how to re-run each: `probes/type-only-edits/README.md`.

**Terms.** An *edit* is one path of a `watch` revision with its old and new blob. *Agent* edits are revisions of at most 3 paths; *bulk* revisions (pulls, rebases, checkouts) have more. An edit is *evaluable* when both blobs are in git and both transform. Three key variants: **K1** the emitted code and its source map's `mappings` are equal; **K2** the emitted code is equal; **K3** the emitted code is equal after an oxc reprint without comments. *Recorded seconds* are the last file-level duration of each re-keyed test file (`checks.kind = 'file'`); *stored seconds* are the file results stored in the window after the edit. CPU-seconds use 011-143's 0.32 to 0.59 CPU-s per recorded second.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | How often | Of evaluable agent edits of TypeScript files, Vitest's transform emits equal code for 7.4% in squeal (9 of 122) and 5.0% in cezar (5 of 101); 4.1% and 1.0% also keep every position. Bulk: 6.9% and 2.7%. Without comments: 8.2% and 7.9%. Node's type stripping almost never emits equal code (1 of 2,749 squeal edits; 112 differ in whitespace only). 57% (squeal) and 74% (cezar) of agent edits are not evaluable: a blob never reached git | verified by experiment |
| 2 | What else can differ | Nine mechanisms, each shown by a fixture whose outcome changed while the emitted code stayed equal, or by a transform demo. Raw bytes are needed for the test file itself, declared inputs, observed reads, `?raw` and `?url` imports, and anything a native tool reads (TypeScript 7's `tsc`) | verified by experiment, read in source code |
| 3 | Mechanism | Hash oxc's output, not the Vitest pipeline's. They agree on all 2,731 squeal edits. Cost: 0.2 to 1.0 ms per file, against 0.03 to 0.06 ms for a blob id. The closure must keep why each path is in it | verified by experiment, read in source code |
| 4 | Key format | `KEY_FORMAT_VERSION` does not move. All Vitest checks re-key once, unless a miss also reads the raw-bytes key as 011-85's former definition does. The cross-release comparison needs new cases, not a raise | read in source code and spec, inferred |
| 5 | Measured saving | 72 h replay. K2 keeps 1.2% of squeal's re-keyed recorded seconds and 0.3% of cezar's. Stored seconds saved: 2,589 s (squeal, 830 to 1,530 CPU-s) and 1,277 s (cezar, 410 to 750 CPU-s), that is 1.0% and 0.5% of 011-143's 72 h work. K3: 2.4% and 0.7%. FAIL transitions missed: none caused by an edit. K1 and K2 keep 0 files with a FAIL transition in squeal. The 4 under K3 (squeal) and 1 under K2 (cezar) are flakes, or a lookup that still finds the same row | verified by experiment, read from store copies |

## 1. How often

`emit.mjs` writes each edit's two blobs into a clone in turn. For every Vitest project whose stored closures hold the path, it calls `project.vite.environments.ssr` (or `.client` for jsdom and happy-dom) `.transformRequest(file)`, as Vitest's `fetchModule` does (`vitest/dist/chunks/index.DpLw24bj.js:6926`). It also runs Vite's `transformWithOxc` alone, Node's `stripTypeScriptTypes` and esbuild's `transformSync`. Unique edits: squeal 2,749, cezar 1,233, toolkit 17.

| Agent edits of `.ts/.tsx/.mts/.cts` | squeal, all (72 h) | cezar, all (72 h) | toolkit |
|---|---|---|---|
| edits; evaluable | 284; 122 (66) | 387; 101 (66) | 8; 1 |
| K1: code and positions equal | 5, 4.1% (3) | 1, 1.0% (0) | 0 |
| K2: code equal | 9, 7.4% (6, 9.1%) | 5, 5.0% (4, 6.1%) | 0 |
| K3: also equal without comments | 10, 8.2% | 8, 7.9% | 1 |
| bulk evaluable; K1, K2, K3 | 3,279; 4.5%, 6.9%, 8.6% | 1,152; 1.0%, 2.7%, 8.2% | 6; 0, 0, 1 |

Per runner transform (unique edits):

- **Vite 8 (oxc).** oxc reprints the code. It drops type annotations and comments inside expressions and parameter lists. It keeps statement comments: JSDoc, `//` lines, `/*! */`, `/*#__PURE__*/` (`t.mjs` probe). So most comment edits change the emitted code, and K3 is the variant that ignores them. *verified by experiment.*
- **Node 24 type stripping** (`mode: "strip"`) replaces types with spaces and keeps every comment. Squeal: 1 edit equal, 112 differ in whitespace only, 2,258 differ, and 281 cannot be stripped. Of those, 267 are `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` (enums, namespaces, parameter properties). Cezar: 12 whitespace-only, 815 differ, 79 cannot be stripped. *verified by experiment.*
- **esbuild** (cezar's `test:unit` node:test project runs through `--import tsx`): 96 of 1,131 cezar edits emit equal code (8.5%), 27 of them with equal positions. esbuild drops comments that oxc keeps. *verified by experiment.*

Recorded seconds of the test files these equal edits re-key (warm closures, `q1.py`), by how the path enters each closure:

| Equal edits (K2), agent | import only | observed read | declared input | own file |
|---|---|---|---|---|
| squeal, 9 edits | 26,443 s (74%) | 7,365 s | 1,858 s | 7 s |
| cezar, 5 edits | 3,326 s (18%) | 313 s | 15,215 s | 0 |

A module of types only is never in an import closure. oxc drops `import type` and every import used only as a type (fixture `import-elision`), so the transform graph never reaches the module. Its re-keys all come through declared inputs and observed reads, so no emitted-code key keeps them. This is why 011-143's `src/core/ps/model.ts` edit (94 files) would still re-key all 94. *verified by experiment (elision), inferred (model.ts).*

## 2. What else can differ

Fixtures in `probes/type-only-edits/q2/`. Each runs its test with `lib.A.ts` and with `lib.B.ts` (Vitest 5.0.3) and compares Vite's oxc output for the two (`out/q2.out`).

| Mechanism | Example and result | Code / mappings | Must keep raw bytes |
|---|---|---|---|
| Line numbers in stack traces and error locations | `failure-location`: frame `lib.ts:2:9`, then `lib.ts:3:9` after a type line above. `stack-assert`: a test that asserts `lib.ts:2:` goes PASS → FAIL | same / differs | No if the key holds `mappings` (K1). Under K2 a reused FAIL keeps its old location: the fingerprint is `name: line @ path:line:column` (`src/core/state/fingerprint.ts:141-187`), so the next real run reads as a changed failure. A test file's own check locations move too, so the test file itself is raw or K1 |
| Snapshots | an external `.snap` is a raw closure path already. An inline snapshot is code in the test file. A snapshot of a stack is the case above | n/a | `.snap` already raw |
| `import type` elision and side effects | `import-elision`: `import { Shape }` → `import type { Shape }`, with `side.ts` setting a global: PASS, PASS. Under `verbatimModuleSyntax` (oxc `onlyRemoveTypeImports`) the same bytes emit `import { T }` | same / same; same bytes differ by option | No, if the hash is computed with the project's own options. No `tsconfig` input is in `src/core/keys` today |
| Enums, namespaces, decorators, parameter properties | enum value edit: code differs. Decorator `p: string` → `number`: code differs only with `emitDecoratorMetadata`; the same bytes emit differently with it on and off. Node's strip mode rejects enums, namespaces and parameter properties | differs where code is emitted | No, the code shows it; options as above |
| Tests that read source text | `reads-source` (`readFileSync`) and `raw-import` (`import text from "./lib.ts?raw"`): PASS → FAIL, with equal code | same / differs | Yes. Observed reads are raw. `?raw` and `?url` imports collapse onto the plain path (`src/runners/vitest/graph.ts:231-232`), so the graph must keep the query |
| `Function.prototype.toString` | `tostring-comment`: a comment edit inside a function body. The code differs (oxc keeps the comment), so K2 re-keys; K3 would keep the key and miss PASS → FAIL | differs; K3 same | Not under K2 |
| Tests that run `tsc`, lint or bundle | `tsc`: `n: number` → `n: string` (type error): PASS → FAIL; code, positions and the strip output are all equal. TypeScript 7's `tsc` is a native binary (`@typescript/typescript-linux-x64/lib/tsc`), so the recorder sees only the files its arguments name (C12) | same / same | Yes, as declared inputs. Today such a test re-keys only when it also imports the file. An esbuild bundle drops types and non-legal comments, and squeal's bundles carry no maps (`legalComments: "none"`, `src/harness/build.ts:153`), so their output does not change |
| Source maps | Vitest inlines the map that maps stack frames back | the K1 / K2 split | as row 1 |
| Pipeline state | once, cezar's `web` project emitted different code for `transcript-facts.ts`; oxc alone, the `server` and `e2e` projects said equal; a second run alone did not reproduce it | n/a | hash the transform's output, not the pipeline's |

## 3. Mechanism

Today (read in source code): `hashFile` takes the blob id (`src/core/hash/hasher.ts`), and `StatCache` keeps it per path. `KeyIndex` encodes one segment per path, shared by every closure (`src/core/keys/key-index.ts:271`). `assembleClosure` (`src/core/keys/closure.ts`) merges runner imports, declared inputs and observed paths into one sorted set and drops why each path is there. The recorder keeps paths only, with no load or read kind (`src/runners/observe/inputs.ts`).

What an emitted-code key needs:

1. **Provenance per closure.** The paths that are runner imports without a query and are not the test file, not a declared input and not an observed read. Only these get the emitted hash. A path can be import-only for one test file and observed for another, so `KeyIndex` holds two segments per path.
2. **The transform per runner.** Vitest: Vite's `transformWithOxc` with the project's `config.oxc` and tsconfig. It agrees with the full pipeline on 2,731 of 2,731 squeal edits. In cezar, all except 2: the one above, and one that differs in `mappings` only. Vite does not run oxc on `.js` files, so those stay raw. node:test: its loader's transform, for cezar tsx (esbuild); without a loader the files run as written, so raw. pytest: raw. *verified by experiment.*
3. **Cost.** Cold, one process, every TypeScript file (`cost.mjs`, load 25 to 27). Squeal: 1,910 files in 392 to 491 ms; the blob ids take 51 ms. Cezar: 1,717 files in 1,183 to 1,727 ms against 101 ms. That is 0.2 to 1.0 ms per file. An agent revision changes 1 to 3 blobs. *verified by experiment.*
4. **Cache by blob.** The emitted hash is a function of the blob id, the transform options and the transformer's version, so a store-wide table keyed by those three transforms each blob once per host. *inferred.*
5. **Raw bytes stay** for the test file (unless K1), declared inputs, observed reads, imports with a query, and non-TypeScript files. *inferred from finding 2.*

## 4. Key format

Rule (C3 as amended by 011-37): "A change to what a key is computed from re-keys the affected checks by itself and moves nothing ... and a differing key is never by itself a reason to move it." So `KEY_FORMAT_VERSION` (20) stays. Every check whose closure holds an import-only TypeScript path gets a new key. That is about every Vitest check in squeal and cezar, once, at the release. *read in spec.*

The one re-key can be avoided as 011-85 avoided its own (`src/core/keys/former.ts`). Equal raw closures give equal emitted closures under the same options, so a row stored under the raw-bytes key means what a row under the emitted key means. A miss would compute the raw-bytes key and copy the newest set (C4 step 3). `ReadAsOne` carries only an environment hash and a dependency segment today (`key-index.ts:62-66`), so it would also need closure segments, at one more `checkKey` per miss. The copy runs from raw to emitted only. *read in source code, inferred.*

Cross-release comparison: the change touches `src/core/keys` and `WorktreeKeys`, which are global entries (`test/keys/validity/entries/global.ts`). So the bundles differ and the corpus runs at both trees. The golden key case gives different keys at the two trees, which is no reason to raise (D6). Every changed line must run in some case, so the change adds cases: a type-only edit of an import-only path (equal key at the new tree), and declared, observed, `?raw` and own paths (keys still differ). If the hash lives in the Vitest adapter, the adapter comparison runs under `VITEST_ADAPTER_VERSION` "3". The hash is computed, not observed and kept, so no version moves. Keying observed child-process loads on emitted code would change what the recorder keeps. That raises `RECORDER_VERSION` 3 → 4, and every observed Vitest file runs once more (011-60). *read in spec, inferred.*

## 5. Measured saving

`replay.py` covers every `watch` revision of the last 72 h before the copy (2026-10-20 13:20Z to 10-23 13:20Z). A test file whose closure holds a changed path keeps its key when every such path is equal under the variant and enters only as an import. Unknown paths re-key. A FAIL is missed when a kept file turned to FAIL before the next revision (of any trigger) that touched its closure.

| 72 h | squeal | cezar | toolkit |
|---|---|---|---|
| revisions; file re-keys; recorded s; stored s | 236; 71,619; 693,640; 53,302 | 262; 42,318; 1,378,471; 87,249 | 24; 2,699; 917; 540 |
| K1 keeps | 603 (0.8%), 2,170 s (0.3%), stored 1,618 s | 4, 12 s | 0 |
| K2 keeps | 2,080 (2.9%), 8,368 s (1.2%), stored 2,589 s | 284 (0.7%), 3,506 s (0.3%), stored 1,277 s | 0 |
| K3 keeps | 4,503 (6.3%), 27,775 s (4.0%), stored 6,202 s | 658 (1.6%), 15,756 s (1.1%), stored 1,729 s | 2 files, 0 s |
| CPU-s saved (stored × 0.32 to 0.59) | K2 830 to 1,530; K3 1,980 to 3,660 | K2 410 to 750; K3 550 to 1,020 | 0 |
| revisions with every path evaluable | agent K2 5.4% of 92,281 s; bulk K2 3.5%, K3 24.1% of 94,493 s | agent K2 1.2%, K3 1.9% of 269,362 s; bulk K2 0.2% | |
| emitted equal, still re-keyed (agent) | observed 5,979 s, declared 697 s | declared 6,083 s, observed 219 s | |

FAIL transitions in kept files, 72 h, each examined (*read from store copies*):

- **Squeal, K1 and K2: none.** K3 keeps 4 transitions in 2 files. `test/scheduler/slow-slot-fair.test.ts` (worktree `15c0d83e`, revision 36): both of its checks went PASS → FAIL and FAIL → PASS at revision 39, a `start` revision, with no closure change between. `test/daemon/vacant-wait.test.ts` (`07b0d895`, revision 44, comment-only changes to `handoff.ts`, `liveness.ts`, `stopping.ts`, `store-records.ts`): FAIL at 44, then PASS at 45. Revision 45 touched only `src/cli/start.ts`, which is not in its closure, and the PASS row replaced the FAIL at the same key. Both are flakes, not edit failures.
- **Cezar, K2 and K3: 1.** `packages/cezar/src/server/projects-api.test.ts` (`b92c665e`, revision 6, a type-only edit of `server.ts`): no state → FAIL, a first observation in that worktree. It was a lookup of a FAIL another worktree stored at its revision 36. After that row the check has 8 FAIL and 4 PASS rows at other keys: it is flaky. Under K2 the closure emits what the other worktree's emitted, so the same row would be found. Not missed.
- Before the window, squeal's K2 keeps 10 FAIL transitions in bulk revisions of worktree `f87240cd` (watcher, daemon and delivery tests, which flip both ways in the same windows). Not examined one by one.

## Recommendation for Squeal

The saving is small and narrow. K2 keeps about 1% of squeal's and 0.5% of cezar's 72 h test work. K3 keeps 2.4% and 0.7%, but misses a `toString` that reads comments. K1 keeps 0.3% and 0%. At the 72 h agent revisions, files whose changed paths all emit equal code still re-key 6,676 s (squeal) and 6,302 s (cezar) through declared inputs and observed reads. That is more than K2 keeps there (5,024 s and 3,335 s), and no emitted-code key may keep it. If built: use K2 on oxc's output; keep raw bytes for the test file, declared inputs, observed reads and `?raw` or `?url` imports; hash with the project's options; read the raw-bytes key as one at the release. On these numbers, the larger shares in 011-143's ranking come first.

## Open questions

1. Unevaluable edits: 57% (squeal) and 74% (cezar) of agent TypeScript edits had a blob that never reached git, and the replay counts them as re-keys. If they behave like the evaluable ones, squeal's agent saving is about 5.4% of agent re-keyed seconds, not 1.5%. *inferred.*
2. Closures are the warm closures at the copy, not the closure at each revision, as in 011-143.
3. Not determined: why cezar's `web` pipeline once emitted different code, because a second run alone gave equal code.
4. Not determined: whether a `tsconfig` change re-keys today. `sortTouched` treats `tsconfig*.json` as an input read once (`src/runners/vitest/touched.ts:73`), but keys were not tested.
5. Toolkit: 7 evaluable TypeScript edits, too few to conclude.

## Sources

- Store copies: `~/projects/{squeal,cezar,toolkit-dev}/.git/squeal/store.sqlite` with `-wal` and `-shm`, 2026-10-23 13:20Z; blobs read with `git cat-file` from each repository's `.git`.
- Vite 8.3.2 `dist/node/chunks/node.js` (`transformWithOxc`, `oxcPlugin`); Vitest 5.0.3 `dist/chunks/index.DpLw24bj.js:6926`; rolldown 1.2.12 `minifySync` and `CodegenOptions` (`dist/shared/binding-tzp6Hc_3.d.mts`); Node 24.21.0 `module.stripTypeScriptTypes`.
- Squeal source at `4e1ba068a`: `src/core/keys/{check-key,closure,key-index,former,key-format}.ts`, `src/core/hash/hasher.ts`, `src/core/state/fingerprint.ts`, `src/runners/vitest/{graph,touched}.ts`, `src/runners/observe/inputs.ts`, `src/harness/build.ts`, `test/keys/validity/entries/global.ts`, `test/store/child/register-ts.mjs`; spec 011 C3, C12, C14; `status.md` 011-37, 011-60, 011-85.
- `squeal.config.json` of squeal and cezar at the clone commits; toolkit-dev's untracked copy at 13:40Z.
- 011-143 (`research/edit-load.md`): CPU per recorded second and the 72 h work totals.
- Probes: `probes/type-only-edits/` (README lists each script, its outputs in `out/` and the commands).
