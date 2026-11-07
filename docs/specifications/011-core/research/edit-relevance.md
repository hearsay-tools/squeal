# Edit relevance: run callers of the edited file first, and skip type-only edits

Researcher, 2026-11-07, 13:05Z to 13:45Z. The human (task 7d611fc4) asked whether Squeal should run tests that do not run the edited code. Two changes are studied here. Change 1: tests whose coverage shows they called the edited file run first, as the edit's own work, and the rest go to catch-up; nothing is skipped. Change 2: an edit that changes only types, comments or formatting keeps the key. Read: `docs/vision.md`, `docs/styleguide.md`, `status.md` (011-22, 011-25, 016-17), 015 `status.md` (D1), `research/edit-load.md`, `research/type-only-edits.md` (011-149), `research/edit-cut.md`, 015 `research/edit-reach.md`.

Versions: squeal `31e9dd7bd`, cezar `84e1fd9c9` (main at the copy), read-only clones. Store, coverage and run-report copies taken 2026-11-07 13:25Z. Vite 8.3.2 (oxc via rolldown 1.2.16), esbuild 0.28.2, Node 24.22.1. No test, build or benchmark ran. Probes and how to re-run: `probes/edit-relevance/README.md`.

**Terms.** An *agent edit* is a `watch` revision of 1 to 3 paths. *Work ahead* of a test file is the recorded seconds (median `fileDurations`) of the files the queue runs before it, plus its own. Wall time is work ahead divided by the parallel workers, and catch-up also waits for the 20 s quiet. A *new failure* is a store transition to FAIL (from PASS, none or unknown) in that worktree before the next revision that changes a path the file holds. *Called*: the file's coverage record shows a function of the edited file ran. *Loaded only*: the module loaded and no function ran. *Not loaded*: the record does not hold the module.

**Correction to the brief.** Coverage is not opt-in. It has been on by default since 0.1.373 (`src/core/types/policy.ts:389`, 015 `status.md` 2026-11-06). Cezar's `squeal.config.json` has no `coverage` key, so cezar has coverage too: 204,087 records from 2026-10-28 14:31Z. 015's `edit-reach.md` said cezar had none. *read in source code and store.*

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Change 1 on history | Squeal (54 new failures in 27 of 191 edits): 20 failures come later, 6 sooner, 28 the same; per edit, the first failure is later in 6 and sooner in 3, by −176 s to +2,024 s of work. Cezar (51 failures in 16 of 243 edits): 41 sooner, 2 later, by a median of 3 s; the worst case is 7,781 s later. The edit's own work grows from at most 5 files at p90 to 198 files (squeal) and 525 files (cezar), max 1,498. Of today's edit work, 83% (squeal) and 13% (cezar) of its seconds go to catch-up | verified by experiment (replay of store history) |
| 2 | Without coverage | Every runner adapter has an import graph (`affected` gives direct and transitive importers). "Has a value-import path" finds 99% (squeal) and 88% (cezar) of called seconds. Only 50% and 63% of the seconds it selects called the file. Direct import is precise (70%, 98%) but finds only 1.4% and 6.6%. As a catch-up order it moves squeal failures 14 sooner and 13 later | verified by experiment against coverage |
| 3 | Type-only share | Evaluable TypeScript edits with equal oxc output: 6 of 85 (7.1%) in squeal, 1 of 102 (1.0%) in cezar. Seconds kept: squeal 0% of 346,595 re-keyed s (3.7% if setup files are keyed by stripped output too); cezar 18 of 1,093,125 s. Not evaluable: 45% and 71% of TypeScript edits, which hold 16% and 74% of re-keyed seconds | verified by experiment |
| 4 | What it breaks | Eight named cases. The new one: the coverage step joins records by blob, so a kept key leaves the edited file's CRAP pending until some run happens | read in source code; 011-149 fixtures |
| 5 | Recommendation | Change 1: drop, both as stated and capped. Change 2: drop | inferred from 1 to 4 |

## 1. Change 1 on recorded history

`order.mjs` replays each agent edit that changes a source some closure holds. It ranks every re-keyed test file under five orders. **T** is today: the edit cut (`src/core/scheduler/edit-cut.ts` `editWork`: edited tests, namesakes or direct importers, then the 4 shortest other importers), then catch-up shortest first (`queue.ts` `sorted`). **A** is Change 1 as stated: every called file is the edit's work. **B** keeps T's cut and orders catch-up by called, no record, loaded only, then not loaded. **C** is A capped like the cut: called namesakes plus the 4 shortest called files. **P** is the fallback without coverage: T's cut, then catch-up by import kind. Most edits come before the first coverage record (2026-10-28). The main run therefore gives a file with no record at the edit its first later record. A strict run uses records at or before the edit only; it has n too small to decide (squeal 54 edits with 7 failures, cezar 26 with none). *verified by experiment.*

| | squeal | cezar |
|---|---|---|
| agent source edits; re-keyed recorded s | 191; 287,134 | 243; 710,210 |
| re-keyed seconds called / loaded only / not loaded / no record | 15.6 / 15.7 / 56.2 / 12.5% | 64.5 / 32.5 / 2.9 / 0% |
| new failures (edits with one) | 54 (27) | 51 (16); 38 from 3 edits of `packages/web/vitest.setup.ts` in one worktree |
| failures by class: called / loaded only / not loaded / no record | **7** / 10 / **28** / 9 | **42** / 0 / 9 / 0 |
| T: failures in the edit's work; work ahead p50, p90 | 3; 303 s, 2,128 s | 4; 402 s, 760 s |
| A: sooner / later / same; change p10, p50, p90 | 6 / **20** / 28; −1, 0, +1,363 s | **41** / 2 / 8; −15, −3, 0 s |
| A: first failure per edit sooner / later; range | 3 / 6; −176 to +2,024 s | 6 / 2; −4,039 to +7,781 s |
| B: sooner / later; change p50, p90 | 15 / 32; +24, +1,976 s | 41 / 3; −3, 0 s |
| C: sooner / later | 16 / 33 | 41 / 3 |
| edit's work files p50, p90, max: T / A / C | 4, 5, 97 / **0, 198, 451** / 4, 5, 27 | 5, 6, 54 / **4, 525, 1,498** / 4, 5, 7 |
| edit's work, all edits: T / A | 3,946 s / 47,288 s (12×) | 5,345 s / 458,347 s (86×) |
| T's edit-work seconds that did not call the file (move to catch-up under A) | 83.2% | 12.7% |

Findings:

- **The two projects fail in different places.** In squeal, 38 of 54 failures (70%) are in files that load the edited file but call nothing, or do not load it at all. Examples: `test/harness/{plugin,opencode/package,pi/package}.test.ts`, which bundle or read the sources, and `test/daemon/step-down.test.ts`, `lifecycle.test.ts` and `test/cli/codex.test.ts`, which spawn the CLI. This matches `edit-load.md` finding 3. In cezar, 42 of 51 (82%) are in callers. *verified by experiment (`failures-*.txt`).*
- **Gains are seconds, losses are long.** In cezar, A finds most failures sooner, by a median of 3 s and at p10 15 s of work. That is less than one quiet window. The worst cases go the other way. `packages/cezar/src/runs/agent-tmpdir.test.ts` failed 12 s after an edit of `runs/store.ts`. Today catch-up reaches it after 29 s of work. Its record did not load the edited files, so A puts it after 7,810 s of work. `file-length.test.ts` reads source text: 100 s ahead today, 2,392 s under A, 7,518 s under B. In squeal, `test/harness/opencode/package.test.ts` (FAIL 12 s after an edit of `tiers.ts`) goes from 47 s to 2,071 s. *verified by experiment.*
- **A removes the edit cut.** In squeal, half of all edits have no called file, so A gives them no edit work, and everything waits for the quiet. For edits with many callers, A's edit work is hundreds of files. Row 011-25 made the cut to keep the next edit's wait short: on cezar it brought the p90 from 132 s to 8 s (`edit-cut.md`). *verified by experiment; the wait inferred from 011-25.*
- **The capped forms do not help.** B and C keep the cut's size. They move squeal's failures later more often than sooner (32 against 15), because catch-up's shortest-first order already reaches the short bundle and package tests early. The 011-22 decision kept catch-up undivided by class, "the edited, direct and transitive classes do not divide it". This replay supports that decision. *verified by experiment; decision read in `queue.ts`.*

## 2. Change 1 without coverage

Coverage comes only from in-process Vitest and node:test runs. Pytest gives none (015 spec, "Coverage under pytest ... is a later row"), a child process is not seen, and a project can switch it off. All three adapters already answer `affected` with direct and transitive importers from their own import graph (`src/runners/vitest`, `node-test/adapter-project.ts:122`, `pytest/adapter.ts:261`). So an import-kind signal works on any project. *read in source code.*

Each pair below is one (edit, re-keyed file with a record), weighted by recorded seconds. The ground truth is "called".

| Signal | squeal precision / recall (of called s) / share of s | cezar |
|---|---|---|
| (base rate: called) | 17.8% of seconds | 64.5% |
| direct value import | 70.3 / 1.4 / 0.4% | 97.8 / 6.6 / 4.3% |
| namesake | 78.6 / 0.1 / 0.0% | 100 / 0.5 / 0.3% |
| value path of depth ≤ 2 | 74.8 / 13.8 / 3.3% | 81.5 / 35.4 / 28.0% |
| value path with no barrel or test helper | 32.6 / 8.2 / 4.5% | 67.0 / 15.6 / 15.0% |
| any value-import path | 50.1 / **99.2** / 35.3% | 63.4 / **88.1** / 89.6% |

Read: a file with no value-import path almost never calls the edited file (0.8% of squeal's called seconds, 12% of cezar's; in cezar likely through its setup files, as the `vitest.setup.ts` failures show, inferred). Inside the import graph, no cheap signal separates callers from loaders. But the question is where the failures are, and in squeal 34 of 54 failures sit in files with no value path. Ordering catch-up by import kind (P) moves 14 squeal failures sooner and 13 later; for the first failure per edit, 5 sooner and 2 later, from −665 s to +3,294 s. In cezar, 3 sooner and 3 later. The signal works on any project. It does not find failures sooner. *verified by experiment (`summary-*-any.json` `proxy`, `byOrder.P`).*

## 3. Change 2: how many edits change no stripped output

`strip.mjs` transforms the old and new blob of every changed TypeScript path in every agent edit in both stores. It uses Vite 8's `transformWithOxc` (what Vitest runs) and esbuild. The seconds a stripped-output key would keep are those of re-keyed files that hold every changed path as an import only. The test file itself, declared inputs, observed reads, child-process loads and (in the main count) the setup and config closure keep raw bytes, as 011-149 found they must. *verified by experiment.*

| Agent edits, store history | squeal | cezar |
|---|---|---|
| agent revisions; with a TypeScript path | 862; 114 | 585; 307 |
| TypeScript path edits; evaluable (both blobs in git) | 154; 85 (55%) | 353; 102 (29%); 5 `.d.ts` edits re-keyed 0 s |
| oxc equal code (K2); code and mappings (K1); esbuild equal | 6 (7.1%); 5; 6 | 1 (1.0%); 1; 6 |
| type-only revisions (every path K2) | 3: `src/core/types/runner.ts`, `src/core/types/scheduler.ts`, one test file | 1 |
| their re-keyed seconds | 13,743 (4.0% of 346,595) | 155 (0.01% of 1,093,125) |
| kept, setup closure raw | **0 s** | 18 s |
| kept, setup closure stripped too | 12,844 s (**3.7%**) | 18 s |
| revisions not evaluable; their re-keyed seconds | 44; 54,300 s (15.7%) | 217; 809,951 s (74.1%) |

Both type-only source edits in squeal are to type modules that `test/global-teardown.ts` reaches through `test/daemon/strays.ts`. They re-key all 1,713 files through the environment hash, not through imports (015 `edit-reach.md` finding 1). An emitted-code key over imports alone keeps none of them. It keeps 3.7% only if the setup closure is also keyed by stripped output. `edit-load.md`'s 13.8% was the share of hub re-run time on 16 hub edits. Over all agent edits, the share is 0 to 4% in squeal and about 0% in cezar. 011-149's 72 h replay found 1.2% and 0.3%. The not-evaluable edits are unknown: their blobs never reached git. *verified by experiment; reconciliation inferred.*

## 4. Change 2: what it can break

| # | Case | Where it is in the code | Effect of a stripped-output key | Tag |
|---|---|---|---|---|
| 1 | Coverage and CRAP are joined by blob | `src/core/code/crap/file.ts:142` (`source.blob !== file.blob` gives `"unread"`) | A kept key means no run, so the stored record carries the old blob, and the file's CRAP stays pending until another edit runs its tests. Coverage is on by default, so this hits every project. K1 (positions equal) would allow a re-stamp of the blob; K2 would not | read in source code |
| 2 | Failure locations and stack lines | `src/core/state/fingerprint.ts:141-187` (`name: line @ path:line:column`) | Under K2 a reused FAIL keeps old line numbers, and a test that asserts a stack line goes PASS → FAIL unseen (011-149 fixture `stack-assert`). K1 is safe | read in source code; 011-149 fixture |
| 3 | Transform options | Vite's `transformWithOxc` resolves each file's tsconfig chain (`vite/dist/node/chunks/node.js`, `getTSConfigResolutionCache`) | `emitDecoratorMetadata`, `verbatimModuleSyntax` and `jsx` change the emitted code for the same bytes. The key must hash the tsconfig files raw. Today `tsconfig*.json` is read once and not a key input (`src/runners/vitest/touched.ts:73`) | read in source code |
| 4 | The runner's own transform | node:test with `tsx` (esbuild), Node's type stripping, pytest | Equal oxc output proves nothing when another transform runs the file. esbuild drops comments that oxc keeps, so a comment edit inside a function body is equal under esbuild but changes `Function.prototype.toString` under oxc (011-149 `tostring-comment`) | read in source code; 011-149 |
| 5 | `?raw` and `?url` imports | `src/runners/vitest/graph.ts:231-232` collapses the query onto the plain path | A test that imports the text sees every comment; the graph must keep the query so the path stays raw | read in source code |
| 6 | Bundle and build tests, child processes | `src/harness/build.ts` (esbuild, `legalComments: "none"`); observed reads and `observedModules` | They read sources as files or in another process, so the key stays raw for them. They are most of squeal's type-only re-keys, so the saving shrinks | read in source code |
| 7 | `const enum`, `enum`, namespaces, decorators | per-file transforms (isolated modules) | A value change of an `enum` or `const enum` changes the emitted code in the declaring file (re-key, safe). An importer never inlines it under oxc. Decorator metadata: see case 3 | inferred from oxc's isolated transform; 011-149 fixtures |
| 8 | `.d.ts` files | never in a value closure; Vite does not transform them | They re-key only through declared inputs or `tsc` tests, which must stay raw. Cezar's 5 `.d.ts` edits re-keyed 0 s | verified by experiment |

## Recommendation for Squeal

**Change 1: drop, as stated and in the capped forms.** As stated, it removes the edit cut: the edit's own work grows to hundreds of files (p90 198 in squeal, 525 in cezar), so the next edit waits again. In the capped forms (only catch-up order changes), it finds cezar's failures about 3 s sooner. It finds squeal's later more often than sooner (32 against 15), and the worst cases in both projects come 2,000 to 8,300 s of work later. These are files that coverage cannot see do the work: bundle, package, source-reading and CLI-spawning tests. It does not depend on the machine. It does depend on the project: a project whose tests run everything in process gains seconds, and a project with out-of-process tests loses. Squeal cannot tell the two apart before it fails. Keep the import closure and today's order: the cut, then catch-up shortest first.

**Change 2: drop.** Over all agent edits it keeps 0 to 3.7% of re-keyed seconds in squeal and about 0% in cezar. 011-149 found 1.2% and 0.3% over 72 h. Against that it costs per-path provenance in the key, the tsconfig chain as a key input, one transform per runner, and a coverage re-stamp. Without the re-stamp, every type-only edit leaves CRAP pending on a default-on feature. The types modules that drive squeal's type-only cost are in the global teardown's setup closure. Moving them out of it (015 `edit-reach.md`, the teardown smell) removes most of that cost for every edit, not only type-only ones. It needs no key change.

## Open questions

1. The 45% (squeal) and 71% (cezar) of TypeScript edits whose blobs never reached git: not determined, because the store keeps hashes, not contents. If they behave like the evaluable ones, the shares above hold.
2. Coverage at the edit: most edits came before the first record, so the main run uses a later record. The strict run (records at or before the edit) has 7 failures in squeal and none in cezar, too few to decide. Its 7 squeal failures all move later or stay under A and B.
3. Flakes: failures are store transitions. They include load flakes in `test/daemon/*` after `package.json` edits in worktree `f87240cd`, and cluster in a few edits (cezar: 38 of 51 in 3 edits of one setup file). Per-edit counts are given beside per-failure counts.
4. Closures are the warm closures at the copy, and the cut uses a static graph in place of the runner's `affected`.

## Sources

- Squeal source at `6dc634687` (this worktree): `src/core/scheduler/edit-cut.ts` (`editWork`, `fetchEditCut`), `queue.ts` (`sorted`, `Priority`), `namesakes.ts`, `quiet.ts`; `src/core/types/policy.ts:389`; `src/core/code/crap/file.ts:142`; `src/core/state/fingerprint.ts`; `src/runners/vitest/{graph,touched}.ts`; `src/runners/node-test/adapter-project.ts`, `src/runners/pytest/adapter.ts`; `src/harness/build.ts`.
- Vite 8.3.2 `dist/node/chunks/node.js` (`transformWithOxc`), rolldown 1.2.16 binding types (`emitDecoratorMetadata`), esbuild 0.28.2.
- Store copies: `~/projects/{squeal,cezar}/.git/squeal/{store,code}.sqlite` with `-wal` and `-shm`, and `runs/*/report.json`, 2026-11-07 13:25Z. Blobs from each repository's `.git`.
- Earlier research: `research/edit-load.md` (finding 3), `research/type-only-edits.md`, `research/edit-cut.md`, 015 `research/edit-reach.md`; `status.md` 011-22, 011-25; 015 `status.md` D1 (2026-11-06).
- Probes: `probes/edit-relevance/` (`order.mjs`, `summary.mjs`, `failures.mjs`, `strip.mjs`, `graph.mjs`, specs and outputs).
