# 011-415: a fast parser for the import graph, aligned on type-only imports

Researcher of row 011-415, 2026-11-20. Brief: `research/fast-parser-brief.md`. Probes: `research/probes/fast-parser/` (throwaway; README there). Squeal at `ad9bf3a43`. The second repository is cezar at `c11e4edf0`, as a `git archive` copy with its installed dependencies hard-linked in. The source checkout was not touched. Host: 24 vCPUs (Ryzen 5950X). No other load was added. The one-minute load at each phase is in each `results/*/summary.json`: 3.3 to 3.9 for every number below, except where a row says otherwise.

**Verdict: no.** Three parsers give the same closure as Vite's graph on both repositories, with zero differing test files. But the gain is small for the Vitest versions Squeal supports. Vitest 5 already replaced the 5 s related walk with a walk of about 50 ms. On the warm closure loop, a fast graph saves about 1 to 3 s for every test file. Only a cold walk on a new Vitest instance gains much (about 13 s), and a parser cannot see what a Vite plugin adds to a file's imports.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | b99e3c05's Babel audit | Found in records: cezar task `0a6c5807`, report of 2026-11-19 (cezar main `2d06ed70c`). Its own resolver matched Squeal's stored walk on 1,797 of 1,803 test files. The report says the 6 remaining files are lint tests where Squeal "resolves import strings inside fixture code text" (paths such as `lint/x.ts` that do not exist). | read in records (`~/projects/notes/projects/cezar/squeal-test-rerun-cost.md`, the task's report artifact). That the cause is Squeal's text scan `sourceLoads` (`loads.ts`), which the probe reuses, is inferred |
| 2 | Which imports Vite's transform drops | Measured on rolldown `transformSync`, the function Vite 8's oxc plugin calls; same result on rolldown 1.2.16 and 1.1.5. **Dropped** in both modes: `import type`, `export type … from`, `export { type A } from`, `export type * from`. **With `verbatimModuleSyntax` on:** `import { type A } from "x"` is **kept**, as `import "x"`. An unused value import is kept too. **With it off:** an import whose names are all inline `type`, or are used only as types (including `typeof`), or are not used at all, is dropped. `import {} from "x"` and side-effect imports are kept in both modes. | verified by experiment (`elision.mjs`, `elision.txt`) |
| 3 | Same selection? Squeal repo | 2,076 test files, 3,658 walked files. Closure files, missing targets, packages and builtins equal Vite's for **every** test file with `oxc-strip`, `oxc-parse` and `babel`. `lexer-ts` also equals Vite's once its `probablyTypeOnly` flag is honoured. Related sets for 6 sampled sources are equal. | verified by experiment |
| 3 | Same selection? cezar | 1,786 test files, 3,338 walked files, 4 projects; only `packages/web` has `verbatimModuleSyntax`. `oxc-strip`, `oxc-parse`, `babel`: **0 differing test files** after the two fixes below. `lexer-ts`: 235 differ. | verified by experiment |
| 4 | Time | Table below. | verified by experiment |
| 5 | What it would replace | Vitest ≥5: the closure walk only. Vitest's related walk already costs 43 to 53 ms there. Vitest 4: the related walk too (3.8 to 4.6 s). Squeal's peer range is `vitest >=5`. | verified by experiment; peer range read in `package.json` |
| 6 | Key-format impact | None while closures are equal. A key reads the closure's paths and hashes and its package set (C3), never the edges. A parser that differed would change keys and need a `KEY_FORMAT_VERSION` case. | read in source code (`adapter.ts` `closure`, spec 011 C3); equality verified by experiment |

## Differences found and fixed on the way (cezar, first run)

- **Template-literal `import()`.** `` import(`./${file}`) `` (`packages/cezar/src/core/model-discovery-guard.test.ts:53`): es-module-lexer 3 returns it as the glob `./*`, and the probe kept it as a missing target. Vite keeps only literal specifiers. The probe now skips lexer results marked `glob`. One test file was affected. *Verified by experiment.*
- **JSX runtime.** Vite's oxc transform adds `react/jsx-runtime` to each `.tsx` file that has JSX. The AST parsers did not, so 9 `packages/web` test files missed the package `react`. No file differed. The probe now adds `<importSource>/jsx-runtime`, using the project's `oxc` options. `oxc-strip` already matched, because it runs the transform itself. *Verified by experiment.*
- **`lexer-ts` (es-module-lexer on raw TypeScript).** On Squeal it read TypeScript `import("…")` type queries as real imports (`store-decision.ts:48`) until its `probablyTypeOnly` flag was honoured. On cezar two classes remain: (a) it cannot parse JSX, so each `.tsx` file loses all its edges; (b) it cannot see usage, so under `verbatimModuleSyntax` off it keeps value imports used only as types. Together these make 232 file sets and 229 package sets differ. It is fit only for JSX-free repositories with `verbatimModuleSyntax` on. *Verified by experiment.*

## Time (whole repository, one test file after another, as the closure loop runs)

| | Squeal cold | Squeal warm | cezar cold | cezar warm |
|---|---|---|---|---|
| Today: adapter `closure` loop (walk + candidates, resolution inputs, globs, imports) | 22.9 s, 11.0 ms/file | 6.4 s, 3.1 ms/file | 26.4 s, 14.8 ms/file | 4.0 s, 2.3 ms/file (load 4.9) |
| Today: `importClosure` alone (the part a parser replaces) | 16.6 s | 4.8 s | 16.7 s | 2.8 s |
| `oxc-strip` graph (parse + Vite's resolver) | 4.2 s (parse 0.85, resolve 1.2: 5,442 calls) | walk 1.7 s | 3.0 s (parse 1.1, resolve 0.72: 3,959 calls) | walk 0.85 s |
| `oxc-parse` / `babel` / `lexer-ts`, cold | 4.8 / 7.7 / 2.1 s | | 4.6 / 9.4 / 1.3 s | |
| Re-parse one file: `oxc-strip` / `oxc-parse` / `babel` / `lexer-ts` | 0.2 / 0.6 / 1.6 / 0.04 ms | | 0.3 / 1.0 / 2.3 / 0.04 ms | |
| Related walk: Vitest `filterTestsBySource`, warm | | 43–53 ms (Vitest 5.0.3) | | 3.8–4.6 s (Vitest 4.1.10) |
| Adapter `affected` | | 68–92 ms | | 5.7–7.3 s (load 5 to 11) |
| Reverse lookup on the fast graph, 6 sources | | 18 ms | | 7 ms |

The warm walk in the probe still checks with `existsSync` each time it reaches a file, as `importClosure` does, so a product walk could be faster than 0.85 to 1.7 s. *Inferred.*

**Why the related walk differs.** Vitest 4.1.10 `filterTestsBySource` walks each test file's whole closure separately (`cli-api.BK8pd4xc.js` 11484–11524): tests × closure size. Vitest 5.0.3 builds one reverse-edge map per project and walks it once from the changed files (`index.DpLw24bj.js` 18584–18624). The 4.9 to 5.5 s in `broad-change-throughput-2.md` row 2 is the Vitest 4 walk on cezar. *Read in source code; the timings verified by experiment.*

**Against the earlier figures.** The 13 ms a file of row 2, and the 10 to 12 ms after row 011-414, were measured under heavy host load. At load 3 to 5 the warm loop is 2.3 to 3.1 ms a file. For the 1,297-file broad change of row 2 that is about 3 to 4 s of warm loop, of which a fast graph would remove about 1.5 to 2.5 s. *Inferred from the measured per-file rates.*

## What would pay, and what would not

- **Related walk:** no gain on Vitest ≥5 (50 ms today). On Vitest 4 a reverse lookup would save about 4 s a revision, but Squeal does not support that version. Upgrading a project to Vitest 5 gives the same saving.
- **Warm closure loop:** about 1 to 3 s saved per full loop on these repositories, about 0.5 to 1.5 ms per test file.
- **Cold closure loop** (a new Vitest instance: a new worktree's daemon, a restart, a config change): `importClosure` 16.6 s against about 3 to 4 s, about 13 s wall and 17 CPU-s per instance. Part of it moves rather than disappears: a later run transforms the files it loads, and the walk would no longer have done it. *Inferred.* How often instances start was not measured; this is the open question that could change the verdict.
- **Cost and risk:** a second graph path beside Vite's, which must stay equal to it. Vite plugins can add or remove imports in `transform`. Examples: `import.meta.glob` (Squeal has its own handling in `dynamic.ts` and `glob-listing.ts`), virtual modules, and a project's own plugins. A parser sees none of these, so it would need a guard and a fallback to `transformRequest`, and no guard can be shown to be complete. Spec 015 D11's `imports` read `readHash` from the bytes Vite's stamped reads saw (`sources.ts`). A parser reads the bytes itself, which adds a new race against the watcher. Neither repository exercised plugins or globs in a walked closure, so zero differences here does not prove the general case. *Read in source code; risk inferred.*

## Recommendation for Squeal

No row. Keep Vite's transform graph as the source of closures (C3/C4 unchanged). If a later count shows that new Vitest instances are frequent, the narrow form to evaluate is: "build cold closures with rolldown `transformSync` (the project's `oxc` options), es-module-lexer and Vite's `resolveId`; use `transformRequest` for any file that holds `import.meta.glob` or that a non-builtin plugin transforms". That form keeps the `oxc-strip` exactness measured here. The gain it buys is about 13 s per instance on repositories of this size.

## Open questions

- How often a new Vitest instance starts per worktree and per day. The store's daemon starts and adapter recreations would answer it. Not determined, because no such count exists in the records read.
- Whether the parsers stay exact on a repository whose Vite config transforms imports through plugins. Not determined, because both repositories walk no such file.

## Sources

- Squeal: `src/runners/vitest/{graph,adapter,affected,related,loads,sources,dynamic,glob-listing}.ts`, `src/core/fs/worktree-paths.ts`; spec 011 C3, C4; spec 015 D11; `research/broad-change-throughput-2.md` row 2; `tasks/011-414/notes.md`; `015-coverage-complexity/research/cezar-selection.md` (its Babel notes concern function hashing, not the graph).
- Vite 8.3.2 and 8.1.4 `dist/node/chunks/node.js`: `transformWithOxc`, `oxcPlugin`, importAnalysis' SSR externalisation (26487–26490). Rolldown 1.2.16 and 1.1.5 `rolldown/utils` (`transformSync`, `parseSync`, `TsconfigCache`).
- Vitest 5.0.3 `dist/chunks/index.DpLw24bj.js` 18584ff; Vitest 4.1.10 `dist/chunks/cli-api.BK8pd4xc.js` 11484ff.
- es-module-lexer 3.0.3, @babel/parser 7.29.13 (cezar's own Babel 8.0.7 was not used; the elision rule is the probe's, not the parser's).
- Probe results: `research/probes/fast-parser/results/{squeal,cezar}/{summary,diffs}.json`, `run.log`, `load.txt`; `elision.txt`.
