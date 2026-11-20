# Why cezar's node:test files were left out of the export (row 018-55)

Researcher, 2026-11-20. Run: cezar (`hearsay-tools/squawk`) merge-group run 44805319389 at `cd8cea696`, Squeal 0.1.579. Probes: `probes/node-test-left-out/` (throwaway).

**Method.** I replayed the export (`verified by experiment`). I used a fresh clone at `cd8cea696`, installed as the export job installs it (`pnpm@12.11.2 install --frozen-lockfile`, Node 26.13.0, no build), and Squeal 0.1.579's bundle from this worktree, patched only to write its full left-out list. Parts: the 8 Vitest shard dirs and the two node:test parts (`package`, `scripts/613c9e96`). I left out the 26 nested Vitest parts of row 018-54. The replay gives the brief's numbers: 37 of 153 node:test files exported, 116 left out for inputs (5 `test:unit`, 111 `root:test:unit`). `classify.mjs` compares each of the 1,306 left-out (file, input) pairs with the file's own part, the other parts and the clone. `causes.mjs` gives each pair a cause.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | For each of the 116 files, which input differs, by cause | **No input differs.** In all 1,306 pairs the input is **absent** from the node:test part's evidence. Not one hash differs. Two cause families. (a) **Declared, never read:** 110 files have an input from cezar's own `squeal.config.json` `inputs` that no Node process of the command read. In 103 files that input is only one of six `.github/scripts/` files. (b) **Keyed by Squeal's node:test graph, never loaded:** 8 files have an input that the static graph adds but the run never opens. These are a per-importer tsconfig (5), a value import used only as a type (1), `require()` inside a string (2) and an `import()` with a `?query` (1). Per file: `probes/node-test-left-out/causes.tsv`. | verified by experiment |
| 2 | Squeal recording faults vs the local checkout | **Neither.** Recording: every path that the 153 files observed has evidence in its part (0 of 1,210 + 185 missing), including the 127 TypeScript modules that tsx loaded. Local checkout: no pair differs, and my clone was clean. The 56 untracked paths are paths through committed directory symlinks. They exist in any checkout. The faults are in **keying**: Squeal's node:test graph keys 4 kinds of inputs that the run never opens (family b, 6 files only this, 8 in all). The rest is D9's evidence rule meeting cezar's wide `inputs` globs (family a). | verified by experiment; read in source code |
| 3 | Compared with the 47 Vitest files of squawk run 43389121989 | Its artifacts are gone (`gh api …/runs/43389121989/artifacts` lists none), so the 47 are not classified per file. By class, from `left-out-files.md` (run 43188846583): the same kind of failure, and **never a differing hash**. Family a is cause D there (declared inputs with a native or no reader), 5 files then and 110 now. `require` in a string is cause E. A type-only value import is a form of cause C. The tsconfig and `?query` causes are new and come from node:test's own graph. In this run the Vitest shards alone leave out **452 files**, not 47: 445 by cause C after cezar #3978 (2026-11-20). | verified by experiment (this run); inferred (the 47) |

## Findings

### 1. Causes (116 files, 270.9 of 462.7 node:test seconds)

| Cause | Files (all / this cause only) | Pairs | What happens |
|---|---|---|---|
| a1. Declared input that no hooked process read | 110 / 106 | 1,142 | cezar declares `".github/scripts/*.test.cjs": [".github/workflows/**", ".github/scripts/**"]`. Six files under `.github/scripts/` are never read in the node:test run: `cockpit-test-sequencer.d.mts`, `node-floor-test-sequencer.mjs`, `node-floor-vitest.config.mjs`, `test-env-windows-probe.ps1`, `test-env-windows.test.mjs` (not matched by the command's `*.test.cjs`) and `fixtures/missing-patches/README.md`. In cezar, only workflows or another config name them (`git grep`). So all 108 `.github/scripts/*.test.cjs` files lack evidence for them, and 103 lack nothing else. Other declared globs: `packages/**` (`change-surface-readers`, which reads with `git ls-files`), `**/*.{md,…}` (`no-compat-policy`, `git ls-files` and `git grep`), `.ai/skills/**`, `packages/web/e2e/**`, `packages/cezar/scripts/**` (Windows `.cs` and `.ps1` files), `.ai/browsers/agent-browser.md` (`test-env-launcher`, 135.7 s). | verified by experiment; read in source code (cezar) |
| a2. Declared input read only in Vitest shards | 2 / 0 | 86 | For example `packages/cezar/src/runners/claude/__fixtures__/*.ndjson` in `change-surface-readers`. Shards 3, 4 and 6 hold their commit content. The node:test part does not. | verified by experiment |
| a3. Declared glob expanded through a directory symlink | 1 / 0 | 56 | `no-compat-policy`'s `**/*.{md,…}` reaches `.agents/skills/*/…` and `.claude/skills/*/…` through the committed symlinks (`120000` entries) to `.ai/skills/*`. The test reads with `git grep`, which does not follow them. | verified by experiment |
| b1. Importer's tsconfig that tsx never reads | 5 / 3 | 5 | Squeal's node:test resolver keys the nearest `tsconfig.json` above each importer (`src/runners/node-test/graph/resolver.ts:139-147` `tsconfigFor`, `tsconfig.ts`). For a `packages/cezar` test that loads `packages/contract/src/*`, that is `packages/contract/tsconfig.json`. tsx 4.23.0 loads one tsconfig per process, from `TSX_TSCONFIG_PATH` or the cwd (`loadTsconfig` in `tsx/dist/register-*.mjs`). strace of `workflow-types.test.ts` shows `packages/cezar/tsconfig.json` opened and no other tsconfig, while `packages/contract/src/runner.ts` loads. The Vitest shards hold it (Vite reads it), and so does the scripts part. | verified by experiment; read in source code |
| b2. Value import used only as a type | 1 / 0 | 1 | `packages/cezar/src/planner.ts:10` `import { RunnerSkillCatalog } from './core/runner-skill-catalog.ts'` uses it only in a signature. esbuild (tsx) drops the import, and the module never loads. es-module-lexer reports it as a value import (`parse.ts:83` drops only `typeOnly`). | read in source code; verified by experiment (not loaded in `planner.test.ts`'s run) |
| b3. `require('…')` inside a string | 2 / 1 | 15 | `parse.ts:39,89-92` scans the whole source, strings included, by design ("a closure one path too wide only costs a re-run"). Fixture text such as `"require('./word.cjs')"` (`merge-queue.workflow.test.cjs:206`) and `"require('./hub.ts')"` (`import-reach.test.mjs:33`) adds the missing Node candidates (`word.cjs.js`, `.ts`, … and `scripts/package.json`). No process probes them. This is row 018-40's cause E. | read in source code; verified (paths missing, no evidence) |
| b4. `import()` with a query | 1 / 1 | 1 | `scripts/test-install-marker.test.mjs:108` `await import('./test-install-marker.mjs?darwin')`. The graph keys `scripts/test-install-marker.mjs?darwin` as a missing path. Node loads `test-install-marker.mjs`, which has evidence. | verified by experiment |

Every left-out input is **absent**, never different. The check against the export checkout never fired. No file was left out because the local checkout differed from CI's.

### 2. Recording faults vs local checkout

- **Recording (no fault found).** Both node:test parts hold evidence for every path their files observed. The package part (`--import tsx`) holds evidence for 127 `.ts` modules. Spec open question 1 (ESM and `--import tsx` loads get evidence through the load step) holds on cezar's real suite. That is one run.
- **Local checkout (no effect).** The clone was clean. All 1,306 pairs are `absent`. The untracked paths are symlink expansions present in every checkout.
- **Keying (Squeal faults, family b).** Locally, b1 to b4 only add needless re-runs, the cost the source comments accept. In CI each one costs the whole file under D9. Fixing them moves node:test keys (closures shrink), so it needs a `NODE_TEST_ADAPTER_VERSION` or key-format decision. That is not part of row 018-55.
- **Rule meeting config (family a).** D9 accepts only read-time evidence. A declared input that only `git` or nothing reads can never be certified. This is open question 1 of `left-out-files.md`, now with a larger share: 110 of 116 files.

### 3. What each change recovers (from `causes.tsv`)

| Change | Files | Test s |
|---|---|---|
| b1 to b4 fixed in Squeal's node:test graph | 6 | 3.3 |
| cezar drops the six never-read files from `.github/scripts/**` (a cezar config change) | 103 | 126.4 |
| both | 110 | 130.8 |
| both, plus a D9 change that certifies declared inputs no hooked process reads | 116 | 270.9 |

The last 6 files (140 s, 135.7 of them `test-env-launcher`) need the D9 change or narrower cezar globs. Their declared files are read by `git`, by a shell script or by nothing.

### 4. Vitest in the same run

The 8 shard dirs alone export 1,293 files and leave out 452 for inputs. That is not caused by the node:test parts: the same 452 appear with or without them. 3,504 of 3,679 pairs are cause C of `left-out-files.md`. Each input has commit content in another shard and nothing in the file's own shard, and it is not observed. The top inputs are `runners/*/…-model-catalog.ts` and `…-skill-catalog.ts`. cezar #3978 (18ea24e8, 2026-11-20) made them lazy: `loadModelCatalog: async () => (await import('./claude-model-catalog.ts'))…` (`runners/claude/definition.ts:28`). Vite's graph keeps those targets, and most shards never load them. The other 7 files have only missing inputs (causes E and F). So the jump from 47 to 452 is a cezar code change meeting cause C. It is not a Squeal regression.

## Recommendation for Squeal

1. **No recording repair is needed** for node:test, on this evidence. Row 018-54 (nested Vitest parts) stays the only blocker of cezar's export.
2. **A row for node:test graph keying (b1 to b4), as a key decision.** Match tsx: key the tsconfig tsx loads (`TSX_TSCONFIG_PATH` or the one found from the cwd), not each importer's nearest. Drop `import { X }` when every binding is used only as a type and the TS compile settings elide it (no `verbatimModuleSyntax`). Scan `require` only in code. Strip `?query` and `#hash` from a resolved specifier. The gain in cezar is small alone (6 files, 3.3 s), but each fix also cuts needless local re-runs. Each moves node:test keys once.
3. **Ask the human about family a, as one question with row 018-40's open question 1.** Should a declared `inputs` file that no hooked process read be certified by a hash at command start, with no write seen? That would recover 110 files (267 s) here, while the export still refuses a file whose shard wrote the input. The risk is the same as there: a native reader (`git grep`, esbuild) sees content the run did not hash at its read. Without that change, cezar's own lever is narrower globs (103 files from one edit, a cezar change that needs the human).
4. **Tell the coordinator** that the Vitest side regressed to 452 left out through cause C after cezar #3978. Cause C's open decision (cross-shard evidence) now weighs about 445 files per run, not 56.

## Open questions

1. For the human: certify declared-but-unread inputs (family a, 110 files) and cause C (445 Vitest files this run) under a changed D9? Both are the same rule.
2. Whether the b1 to b4 fixes need a `NODE_TEST_ADAPTER_VERSION` raise or another key decision. Not determined: this row changes no key.
3. The counts come from one run. Shard spread changes what cause C costs. The node:test causes are config and code text, so they should hold until cezar changes them (inferred).
4. Side note: `squeal ci export --parts <file.json>` crashes with an `ENOTDIR` stack trace. It accepts only directories (`readPartsIn`). Seen once while setting up; not a finding of this row.

## Sources

- Run 44805319389, read-only: `gh run download` of `squeal-parts-shard-1..8` and `squeal-parts-node-test`, retrieved 2026-11-20. Run 43389121989: no artifacts left.
- cezar at `cd8cea696`: `squeal.config.json` `inputs` and `nodeTest`, `.github/workflows/ci.yml` (`squeal-node-test`, `squeal-export`), `.github/scripts/no-compat-policy.test.cjs:29-56`, `change-surface-readers.test.cjs:46`, `merge-queue.workflow.test.cjs:205-213`, `scripts/import-reach.test.mjs:25-33`, `scripts/test-install-marker.test.mjs:108`, `packages/cezar/src/planner.ts:10,61`, `packages/cezar/src/runners/claude/definition.ts:28`, commit 18ea24e8 (#3978). tsx 4.23.0 `dist/register-*.mjs` (`loadTsconfig`).
- Squeal 0.1.579: `src/runners/node-test/graph/resolver.ts:111-147`, `tsconfig.ts`, `parse.ts:39,58-92`, `graph.ts:10-20`, `src/core/ci/inputs.ts:134-158,216-253`, `src/cli/ci-export.ts:247-258`.
- `research/left-out-files.md` (row 018-40), `status.md:118` (run 43389121989), spec 018 D9, D24, D26.
