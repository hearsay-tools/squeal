# 011-25: an agent's edit of a central source

Researcher R1 of 011 wave 6, 2026-10-20. Brief: `tasks/wave-6.md` R1. Read: `docs/vision.md`, `docs/styleguide.md`, `docs/process.md`, board row 011-25, spec 011 C4 (steps 3 to 5, catch-up as amended 2026-10-20, the four-tiers turn, claims), C10, `status.md`, `research/catch-up.md` (open question "Agent edits of central sources"), `reviews/wave-5.md`, `tasks/011-22/notes.md`.

Versions: Squeal main at `eb25bb3f` (0.1.226 and docs, after `8560795d`), read in this worktree. Cezar's store: the read-only copy `research/catch-up.md` made at 2026-10-19T22:21Z (`/tmp/r3/cezar-store.sqlite`, opened `readOnly: true`), so the 62 revisions are the same ones. Cezar's git read only: `git archive` of the 10 heads into scratch directories, `git cat-file` for a revision's new blobs. Vite's one hop is reproduced with the transform cezar's Vite 8.1.4 uses (rolldown 1.1.5's oxc) and es-module-lexer 2.3.1. **No live measurement ran**: the one-minute load was 24 to 67 on 24 CPUs throughout, above the brief's hold of 8. Every time below is a replay of recorded durations or a read of the store. Probes: `probes/central-edits/` (README lists each).

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Direct importers | Per revision, the edited test files and direct importers are 10 files at the median (p90 150, max 173) of the 213 to 472 re-keyed. That is 13 % of all re-keyed files. The transitive rest is 203 at the median, 175 of them at depth 3 or more. The tail is modules that tests import directly. The largest is one hub, `runs/store.ts`, which 150 to 182 test files import (`RunStore`). After it come `workflows/run.ts` (42) and a testkit (46). The widest-reaching modules have 0 to 20 direct importers and 216 to 455 transitive ones. The static scan agrees with Squeal's stored closures at precision 0.998 and recall 0.93. What it misses are paths a run read, which are no runner's one hop either | verified by experiment (static graph over `git archive`), read from the store |
| 2 | The cut | (a): edited test files and the runner's direct importers stay edits, the rest is catch-up. All 110 own test files of the 62 revisions are edited (20) or direct (90), so none leaves the edit route. (b) changes nothing on the 62. Over all 293 agent revisions, the 268 own test files are again all edited (147) or direct (121). So a threshold only spares small revisions' guard tests, the declared-input and source-reading files, from catch-up. (c) depth 2 keeps 39 files at the median and up to 237, and gives back none of the wait. A mistaken cut costs a file the first group of its lane plus its catch-up tier, at most the 120 s budget in Vitest. The candidates are barrel importers, tests of a spawned script and declared inputs | verified by replay, read in source code |
| 3 | The runners | All three adapters already split `affected` into `direct` and `transitive` per changed path, and the scheduler already receives it (`RunnerPart.direct`). Vitest counts one hop of the transform graph, static or dynamic, and a changed snapshot. node:test counts one hop of its own graph (deps, reads, resolution candidates). pytest counts one hop plus every test under a changed `conftest.py`. Barrel importers, paths a run read and environment inputs are transitive or unnamed in all three. What it takes is a fallback for a runner part that failed, and an `affected` call per unrefined revision at a daemon start | read in source code (adapters and their tests) |
| 4 | The gain on cezar | On the 62 revisions replayed one by one, (a) leaves the own test file where it is: p50 6 s, because class order already runs it first. The next edit's wait falls from 124 s (tierSize 4) or 174 s (tierSize 12) to 6 s at the median, but stays 132 to 136 s at p90. That p90 comes from the 16 revisions with 20 or more direct importers (`store.ts`, `workflows/run.ts`, a testkit, `git-worktree.ts`). Time to all results falls from 1,554 s to 839 s (tierSize 4). Measured on cezar, own test files waited 227 s at the median for their run to start (p90 744 s). 41 of 62 revisions landed behind an uncancelled edit tier. 26 of the 44 tiers in flight held only files (a) makes catch-up, 7,071 s of waiting in sum that a cancel bounds at 6 s each | verified by replay, read from the store |

## Findings

### 1. Direct importers

**Method** (`graph.mjs`, `direct.mjs`). The 62 revisions are `research/catch-up.md`'s: no HEAD move, 1 to 8 keyed sources, 200 or more fast files re-keyed by today's closures. Their worktrees sat at 10 heads. For each head, every code file under `packages/`, `scripts/` and `.github/` is transformed by oxc as Vite 8 does: type-only imports are dropped, and only those in `packages/web`, whose tsconfig sets `verbatimModuleSyntax` (Vite reads it into `onlyRemoveTypeImports`). Its static and literal dynamic imports are then read with es-module-lexer, and `require` in `.cjs` files by a regex. Specifiers resolve by cezar's rules: relative, with `.js` to `.ts` and extension and `index` candidates; `@/` to `packages/web/src`, as in `vite.config.ts`; and `@open-mercato/cezar-contract` and `-api-client` to their `src` through their `exports`. Each revision's own edits are overlaid: a changed file's edges come from its new blob, and the worktree's earlier revisions at the same head, or its stat cache's hash, supply the files it had added. A re-keyed file is then **edited** (it changed), **direct** (it imports a changed path in one hop), **transitive** at depth d, **outside** (no import path: a declared input, a path a run read, or a module nothing imported yet), or **absent** (not in the tree then: today's closures name files written later). *verified by experiment.*

**Trust** (`trust.mjs`, at a8042ec3, where 486 of the 914 stored closures were written 2026-10-19 22:13Z to 22:19Z). Each fast test file's static reach was compared with its stored closure (`test_files.closure_paths`, method "static imports plus declared inputs"), both cut to code files in the tree, declared inputs set apart:

| Project | Files | Exact | Recall | Precision |
|---|---|---|---|---|
| server (Vitest) | 463 | 269 | 0.926 | 1.000 |
| web (Vitest) | 262 | 156 | 0.946 | 0.995 |
| contract, api-client (Vitest) | 15 | 15 | 1 | 1 |
| test:unit (node:test) | 10 | 8 | 0.848 | 1 |
| the four above (750 files) | 750 | 448 | 0.932 | 0.998 |

What the static graph misses is not imports. It is paths a run read: the mock scripts tests spawn (`packages/cezar/scripts/mock-nudge.mjs` in 89 closures, `mock-claude.mjs` in 67), the transcript-facts worker that 103 closures hold, and `design-guardian.test.ts`'s scan of 712 files. Squeal records these as observed closure paths (C4: "A completed file whose run observed paths its closure lacks takes them into its closure"). They are no runner's one hop, so the static one hop is a fair stand-in for `affected().direct`. Two forms are not modelled: `vi.mock` factories and `new URL(…, import.meta.url)` workers (*inferred*). `root:test:unit`'s `.cjs` files are covered whole by declared inputs, and `test:package` is no longer in cezar's config; both are left out of the figure. *verified by experiment.*

**Counts** (`results/direct.txt`; 0 parse failures at all 10 heads):

| Per revision (62) | min | p50 | p90 | max | sum |
|---|---|---|---|---|---|
| re-keyed (today's closures) | 213 | 245 | 258 | 472 | 15,322 |
| edited | 0 | 0 | 1 | 4 | 20 |
| direct | 0 | 10 | 150 | 173 | 1,981 |
| transitive | 0 | 203 | 209 | 439 | 11,359 |
| of which depth 2 / depth ≥ 3 | | 29 / 175 | 113 / 191 | 215 / 313 | 3,298 / 8,061 |
| outside the import graph | 5 | 8 | 20 | 223 | 825 |
| absent at the head | 0 | 24 | 26 | 31 | 1,137 |

By lane, Vitest has 20 edited, 1,957 direct, 11,301 transitive and 707 outside; node:test has 24 direct, 58 transitive and 118 outside. Under (a), 38 of the 62 revisions keep 12 or fewer files as edits, 10 keep 13 to 24, and 14 keep more. Of those 14, `bccd1abc` r1 to r8 (150 each) and `ba5234dc` r44 (173) edit `runs/store.ts`. `ba5234dc` r2, r13 and `f3ab1acc` r2, r3 (42 to 77) edit `workflows/run.ts` (42 direct) or a testkit (`harness-parity.testkit.ts`, 46 direct), and `729119b9` r2 keeps 27.

**The widest changed paths** (direct importers / the rest they re-key): `contract/src/delegation.ts` 17 / 455, `contract/src/waits.ts` 6 / 410, `contract/src/github.ts` 0 / 391, `runs/store.ts` 163 / 84, `core/runner-runtime.ts` 6 / 239, `git-worktree.ts` 20 / 225, `git-worktree-lock.ts` 3 / 242, `workflows/waits.ts` 4 / 240. Central modules come in two kinds. Most are reached through barrels and chains (the contract's `index.ts`, the runner registry), with at most 20 direct importers. One is a hub that tests construct directly: `grep` finds 182 test files at a8042ec3 that `import { RunStore } from '../runs/store.ts'`. *verified by experiment.*

The re-keyed counts from today's closures over-count. They include the 1,137 absent files, and b20a0d00 r1's 223 "outside" files did not import its new module yet. `research/catch-up.md` flagged this as approximate; the graph puts the real figure 7 to 10 % lower. *verified by experiment.*

### 2. The cut

From `queue.ts` `priorityOf` and the C4 step 4 order: within the first group, failing comes first, then edited, then direct, then the rest, each shortest first. An edited or direct own test file therefore runs in the first tier whether or not the transitive rest is in the first group. The cut does not change when the agent's own test reports in an isolated revision. It changes what holds the lane after it. Each edit tier is never cancelled (C4 step 5), so the agent's next edit waits for the tier in flight. *read in source code.*

| Cut | Stays an edit (62 revisions: p50 / p90 / max) | Own test files (110) | What a mistake costs |
|---|---|---|---|
| (a) edited + direct | 10 / 150 / 173 | all 110 stay (20 edited, 90 direct) | a barrel importer, a test of a spawned script, a declared-input test: waits for the first group of its lane, then runs in a catch-up tier that stores at its end |
| (b) (a) above N re-keyed | the same for any N < 213 | the same | below N, today's rule. At N = 12 (cezar's tierSize), 166 agent revisions keep their 690 non-direct files as edits. 668 of those are guards outside the import graph, of 0.1 to 7 s |
| (c) depth ≤ 2 | 39 / 217 / 237 | all 110 stay | as (a), fewer files; but depth 2 holds heavy files, so the lane stays busy (next-edit wait 123 s p50, as today) |
| (a) capped at 12 direct (shortest) | 10 / 12 / 16 | 94 stay. 16 direct own files miss the 12 shortest and land in catch-up: `store.test.ts` (3 to 8 s, among 150), `workflows/run.test.ts`, `opencode-server-runner.test.ts`. Over the 293 revisions, 18 of 268 (`capown.mjs`) | `store.test.ts` 26 s → 63 s in the replay; every own test of a module with more than 12 direct importers that is not among their 12 shortest |

**Over all 293 agent revisions** (`cuts.mjs`, `outside.mjs`; no HEAD move, 1 to 9 keyed sources; 25 heads, 0 parse failures):

| Re-keyed | Revisions | Files | Edit under (a) | Catch-up under (a) | of which outside the import graph | Edit under (c) | Own: edited / direct / other |
|---|---|---|---|---|---|---|---|
| 1 to 4 | 59 | 153 | 33 | 120 | 120 | 33 | 29 / 0 / 0 |
| 5 to 12 | 107 | 741 | 171 | 570 | 548 | 193 | 58 / 10 / 0 |
| 13 to 24 | 9 | 137 | 36 | 101 | 97 | 40 | 8 / 2 / 0 |
| 25 to 49 | 48 | 2,062 | 78 | 1,984 | 1,530 | 126 | 32 / 9 / 0 |
| 50 to 99 | 2 | 172 | 0 | 172 | 172 | 0 | 0 / 0 / 0 |
| 100 to 199 | 4 | 464 | 98 | 366 | 46 | 191 | 0 / 10 / 0 |
| 200 or more | 62 | 14,185 | 2,001 | 12,184 | 825 | 5,299 | 20 / 90 / 0 |

Below 50 re-keyed files, what (a) moves is mostly guard tests reached through declared inputs or reads, not through imports. `change-surface-readers.test.cjs` (inputs `packages/**`) is reached by 108 of these 225 revisions, `contract-import-boundaries.test.ts` (every `src/**/*.ts`) by 83, `design-guardian.test.ts` by 76, `cockpit-test-sequencer.test.cjs` by 76, `pid-file.testkit.test.ts` by 61, each 0.1 to 7 s at the median. They are guards that read every source. As catch-up they run right after the edit's tier when the lane is free, failing first, and are cancelled by the next edit when it is not. A threshold (b) would keep them edits. Its only gain is C10's: an edit's tier never waits for a pool permit, while a catch-up tier beyond each daemon's one free backlog worker does. On a full pool a small revision's guards would then run one at a time. *verified by experiment (counts), read in source code (C10).*

**Where a mistaken cut bites.** A catch-up file waits for its lane's first group, then for a backlog tier: at most 200 files within 120 s of estimated wall in Vitest (it stores at the end, unless a later edit cancels it first), or a slot in node:test. The four-tiers turn bounds the wait under a stream of edits to one tier in five. Three cases are demoted by (a) whatever the agent meant. (1) A test that imports through a barrel. The Vitest adapter's own test pins it: "a test that imports through a barrel is transitive". On cezar the web tests reach `contract/src/*.ts` through `@open-mercato/cezar-contract`'s `index.ts`. (2) A test of a script it spawns, such as `mock-claude.mjs` and the 16 other mocks. They are observed paths, never one hop. (3) A declared-input test such as `contract-import-boundaries.test.ts`, whose inputs are every source under `packages/*/src`. Among the 268 own test files of the 293 agent revisions none falls in these cases (`cuts.mjs`: 0 own files off the edit route). *verified by experiment; inferred for the cost bound.*

### 3. The runners

| Runner | `affected(changed)` returns today | Direct | Transitive |
|---|---|---|---|
| Vitest (`src/runners/vitest/affected.ts`) | `relatedSpecifications` (Vitest's walk), then `directImports` per reached spec | the changed test file, an owner of a changed `.snap`, an importer of a changed path in one hop of the transform graph, static or dynamic, a deleted target included | everything else the walk reached, and every file of a project whose config, setup file or its closure changed |
| node:test (`src/runners/node-test/graph/graph.ts` `affected`) | its own module table | the changed test file; a holder whose node has the path in `deps`, `reads` or `candidates` | other holders, every file on a preload change, a file whose last run loaded the path (`observed`, `takeGrown`) |
| pytest (`src/runners/pytest/graph/graph.ts` `affected`) | its own module table | the changed test file; every test file under a changed `conftest.py`; a holder with the path in `deps`, `candidates` or `plugins` | other holders, observed loads |
| composite (`src/core/daemon/composite-runner.ts`) | fans out and concatenates | merged | merged |

Tests pin each split: `test/runners/vitest/affected.test.ts` ("splits direct importers from transitive ones", "a test that imports through a barrel is transitive"), `test/runners/node-test/graph-structural.test.ts` ("puts a changed test file in direct and a preload change everywhere", "keeps a deleted module's importers direct through its candidates"), `test/runners/node-test/adapter.test.ts` and `test/runners/pytest/adapter.test.ts`. The scheduler already carries the split. `refinement.ts` `fetchRunnerPart` puts `affected.direct` in `RunnerPart.direct`, and `Ledger.settle` uses it for `priorityOf` and in `recentOf`, which today ORs it with every file the reverse index holds. *read in source code.*

**What it would take.** No adapter change. Three seams in the core:

1. **The cut.** In `applyRunnerPart`, for a revision that is not catch-up, the files `recentOf` reaches but that are neither in `changed` nor in `part.direct` become catch-up. `Queue.toCatchUp(ref, keyedAt)` already does this per revision for wave 5's B1 recount. `part.recent`, the content part's files, gets the same treatment, so another revision's edit keeps its first-group flag (`Entry.recentBy`).
2. **A runner part without an answer.** When `affected` fails or is abandoned (C4's bound), `affected` is `null` and `direct` is empty. Today's rule must stand then (all reached files first group); otherwise a runner failure would demote every file.
3. **A daemon start.** `bootstrap.ts` classifies each unrefined revision with `ledger.recentOf(paths)` and no `direct`, because no runner `affected` runs at a start. It either calls `affected` per unseen revision once the runner is up, or keeps today's rule for those revisions.

pytest's conftest rule makes a root `conftest.py` edit direct for every test, which is right for fixtures: the cut does not apply there. *read in source code; inferred for the seams.*

### 4. The gain on cezar

**Replay** (`replay.mjs`). Each revision is replayed alone, Vitest and node:test lanes at once. A file's time is its median recorded run (a sum of check durations, low by 1.04 to 1.27, `../catch-up/calibrate.mjs`). Edit tiers use the span rule; catch-up runs in Vitest backlog tiers (W 23, 120 s, shortest first) and node:test slots (W 4). The next edit's wait is the time left in the Vitest tier in flight at a uniform moment, capped at 6 s for a cancelled catch-up tier. 61 revisions (b20a0d00 r1 left out), absent files left out. Values are p50 / p90 / max:

| Rule | Edit files | First own result s | Last own result s | All results s | Next edit waits s |
|---|---|---|---|---|---|
| today, tierSize 4 | 221 / 235 / 466 | 3 / 64 / 650 | 6 / 71 / 1,062 | 1,554 / 1,957 / 2,208 | 124 / 143 / 145 |
| today, tierSize 12 (cezar's stopgap) | 221 / 235 / 466 | 3 / 26 / 267 | 6 / 75 / 795 | 964 / 1,060 / 1,335 | 174 / 186 / 193 |
| **(a), tierSize 4** | 10 / 150 / 173 | 3 / 64 / 650 | 6 / 71 / 1,062 | 839 / 1,488 / 1,972 | **6 / 132 / 158** |
| (a), tierSize 12 | 10 / 150 / 173 | 3 / 26 / 267 | 6 / 75 / 795 | 774 / 1,316 / 1,391 | 6 / 136 / 169 |
| (a) capped at 12 direct, tierSize 12 | 10 / 12 / 16 | 3 / 63 / 452 | 6 / 75 / 744 | 631 / 1,000 / 1,391 | 6 / 8 / 58 |
| (c) depth ≤ 2, tierSize 4 | 39 / 217 / 237 | 4 / 64 / 650 | 6 / 71 / 1,062 | 1,363 / 1,783 / 1,963 | 123 / 146 / 161 |

Mean time to a result is 178 s today at tierSize 4, 94 s at 12, and 145 s under (a). A backlog tier stores at its end, so the light transitive files that edit tiers of 12 finished early now land with their tier. Under (a), the next-edit wait stays above 100 s in the 16 revisions with 20 or more direct importers. For example, `bccd1abc` r3 (`store.ts`) goes 167 s → 127 s under (a), and to 6 s capped. Its `store.test.ts` comes at 26 s, and at 63 s capped. `ba5234dc` r1 (`contract/src/delegation.ts`, 466 files) 152 s → 11 s, all 1,146 s → 850 s. `66a59a96` r20 (`runner-runtime.ts` and three runners) 172 s → 6 s, all 977 s → 648 s. *verified by replay.*

**Measured** (`measured.mjs`; Squeal 0.1.2xx of 2026-10-14 to 10-19, tierSize 4 then 12, host load unrecorded). For the 110 own test files, 93 got a run. From the revision to that run's start: p50 227 s, p90 744 s. To the file's first result: p50 300 s, p90 817 s. The replay's 6 s is a revision alone. The real ones came in bursts: `66a59a96` r1 to r34 is 28 revisions in 30 minutes, each re-keying about 245 files. Here 41 of 62 landed while an edit tier was in flight, with p50 82 s left and up to 593 s. Of the 44 tiers in flight, 26 held only files (a) makes catch-up: 7,071 s left in sum, which the Vitest cancel bounds at 6 s each. 12 held a file (a) keeps as an edit (4,430 s), 5 of them the `store.ts` hub's (`bccd1abc` r4 to r8, 349 to 568 s left). For example, `66a59a96` r3 to r19 each waited 21 to 582 s behind one tier of 4 transitive files. Under (a) that tier would have been catch-up and cancelled. *read from the store; the counterfactual is inferred.*

## Recommendation for Squeal

**Cut (a), whatever the count.** A revision's edit work is its edited and added test files and the runner's direct importers of the paths it changed. A file it reaches any other way is catch-up: through other modules, a declared input, or a path a run read. Catch-up is 011-22's group, on the backlog's route, cancelled by the next edit in Vitest and beside it in node:test and pytest. The tradeoff that decides it: the own test file reports at the same moment (it already runs first), and the lane stops being held by work the agent did not ask about. On cezar the next edit's wait falls from about 2 minutes to 6 s at the median. All results arrive in 839 s instead of 1,554 s at tierSize 4, and in 774 s instead of 964 s at 12. The price is that a barrel importer, a spawned script's test or a declared-input test runs one catch-up tier later, and that a backlog tier's results arrive at its end. No adapter changes. The runner part that cannot answer keeps today's rule.

**Modules that tests import directly stay unsolved by (a).** An edit of `runs/store.ts` keeps 150 to 182 direct importers as edit tiers, and `workflows/run.ts` or a testkit keep 42 to 77. Measured, up to 568 s was left in the tier in flight; replayed, 132 to 136 s at p90. A cap on the direct importers kept as edits fixes the wait (p90 8 s). The cost falls on the module's own test when it is not among the shortest: 16 of the 110 own test files, among them `store.test.ts` (26 s → 63 s). That is the human's question below.

**C4 sentences it would change.**

- Step 4, "Work an edit caused, a test file whose closure a revision changed, that a revision added or edited, or that the runner reports as a direct importer, runs ahead of the baseline, …" becomes: "Work an edit caused, a test file that a revision added or edited, or that the runner reports as a direct importer of a path it changed, runs ahead of the baseline, …".
- Step 4, after "… an edit or a named wait (C15) still moves it to the first group (amended 2026-10-20, row 011-22, …)." add: "A revision of fewer keyed paths makes catch-up of the files it reaches only otherwise: through other modules, a declared input or a path a run read. When its runner part gives no answer (the `affected` call failed or was abandoned), every file it reaches stays an edit's work. A daemon's start classifies each unrefined revision by the runner's `affected` for its paths (amended 2026-10-…, row 011-25; cezar, 2026-10-14 to 10-19: 62 revisions of 1 to 8 keyed sources re-keyed 213 to 472 files, of which 10 at the median were edited or direct importers, and 26 of the 44 edit tiers an agent's next edit waited behind held only the rest; `research/central-edits.md`)."
- Step 4's class order sentence ("then test files that import a changed path directly …, then transitively affected files") stands inside each group. Step 5 and the turn stand: catch-up already takes the grant, the budget, slots, the cancel and one tier in five.
- "Explicit checkpoints": "An edited file or a direct importer goes in the first group" stands. After "… a catch-up revision's file in catch-up" add: ", and a file a revision reached only through other modules in catch-up".
- If the human chooses a cap: after the step 4 addition, "Of a revision's direct importers, at most K, shortest last-known duration first, stay an edit's work, and the rest are catch-up."
- C10 is unchanged.

**The question the human must decide.** Should a revision's direct importers stay edits however many there are, or only the K shortest (for example K = `runner.tierSize`, 4 by default and 12 on cezar)? Uncapped: a hub edit keeps 150 to 182 edit files, and the next edit waits up to a tier of them (p90 132 s replayed, 349 to 568 s measured). Capped at 12: the wait is 6 to 8 s at p90. 16 of the 62 revisions' 110 own test files (18 of 268 over all 293 agent revisions) then report one catch-up tier later (`store.test.ts` 26 s → 63 s). Squeal cannot tell a module's own test from its other importers (no naming rule exists in C4), so a cap trades exactly those files. Recommended: no cap. The vision's first promise is notice when the agent's own change breaks something, and a cap delays exactly the files most likely to carry that notice. The wait a hub edit causes is the cost of every importer being equally direct.

**The slice's done-when, as tests** (`test/scheduler/`, the `catch-up-fixture.ts` shape: real store and pool, a fake runner of fixed durations whose `affected` returns a direct/transitive split):

1. One edited source with 3 direct importers and 200 transitive ones (0.1 to 5 s, plus one 60 s transitive file): the first tiers are edit tiers holding only the 3 (no grant, ≤ `runner.tierSize`). The 200 run as catch-up: backlog tiers with a grant, more than `runner.tierSize` files, within the budget. Red on main: edit tiers of `runner.tierSize` over all 203.
2. The edited module's own test file (direct) is current before any transitive file's run starts. The same holds for an edited test file of the revision. This is a guard: it holds on main too, and the cut must keep it.
3. A second edit 1 s into the first edit's catch-up Vitest tier: the tier is cancelled, the second edit's direct importer is current within its own run plus 6 s, and the cancelled tier's finished files keep their results. In a node:test lane the edit's tier starts beside the catch-up slots, with no permit. Red on main: the second edit waits for the tier in flight.
4. A file another revision's edit reached directly stays in the first group when this revision reaches it transitively (`recentBy`).
5. `affected` fails, or is abandoned past its bound: every reached file is queued in the first group, as today.
6. A declared-input test and a barrel importer of the edited source are catch-up. A named wait (C15) on either still promotes it ahead of catch-up.
7. A daemon start over an unrefined small revision: its direct importers are first group and the rest catch-up (the runner's `affected` per revision). Under `lookup-only` nothing is queued, as before.
8. A 9-source revision and a 12-source revision keep 011-22's tests (`catch-up.test.ts` 1 to 3) green.
9. With a cap (if chosen): 150 direct importers queue the K shortest as edits and the rest as catch-up.
10. The cezar case: `probes/central-edits/replay.mjs` on the slice's selection (011-22's `replay-slice.ts` shape), or live once the load is below 8. Version bump, review PASS.

## Open questions

- **The cap** above: the human's. A cap that spares the module's namesake test (`store.ts` → `store.test.ts`) would keep the 16, which are all namesakes (this probe found own files by that name). It adds a naming rule C4 does not have, and it does not help a language or layout where tests sit elsewhere; not measured.
- **Bursts are not replayed.** The replay takes each revision alone. The measured side shows that bursts are where today's wait lives (28 revisions in 30 minutes, each re-keying 245 files). A discrete-event replay of `66a59a96` r1 to r34 under (a) would put a number on the burst. Not built.
- **The runner part's own cost** on cezar is not measured. `affected` walks `relatedSpecifications` and one `directImports` per reached spec, and the cut must wait for it as every tier already does ("A tier is never selected while runner work is pending").
- **`vi.mock` and worker URLs** are not modelled in the static graph. Vitest's real one hop may differ for files that use them (none of the 110 own test files is affected: all are edited or import the changed path).
- **Catch-up stores at the end of a tier.** Under (a) the mean time to a result is 145 s against 94 s for edit tiers of 12. A light transitive file waits for its backlog tier's end. Slots for Vitest (`research/streaming-lanes.md`) would remove that and are outside this row.
- **Live numbers.** Every number here is replayed or read from the store. The slice should measure cezar live below load 8.

## Sources

- Squeal main `eb25bb3f` (0.1.226): `src/core/scheduler/{ledger,queue,refinement,bootstrap,revision,failures}.ts`, `src/runners/vitest/{adapter,affected,graph}.ts`, `src/runners/node-test/{adapter,adapter-project}.ts`, `src/runners/node-test/graph/graph.ts`, `src/runners/pytest/adapter.ts`, `src/runners/pytest/graph/graph.ts`, `src/core/daemon/composite-runner.ts`, `src/core/types/runner.ts` (`AffectedTestFiles`); tests `test/runners/vitest/affected.test.ts`, `test/runners/node-test/{graph-structural,adapter}.test.ts`, `test/runners/pytest/adapter.test.ts`.
- Spec 011 C4, C10, C15, `status.md`; board row 011-25; `research/catch-up.md` and `probes/catch-up/` (`calibrate.mjs`, `results/{explained,revisions}.json`); `reviews/wave-5.md`; `tasks/011-22/notes.md`.
- Cezar's store copy `/tmp/r3/cezar-store.sqlite` (2026-10-19T22:21Z; tables `revisions`, `runs`, `results`, `checks`, `test_files`, `file_hashes`, `worktrees`). Cezar's git `/home/agent/projects/cezar`, heads `6b89b129`, `efac418a`, `00ff0f16`, `b4031083`, `7fe10d99`, `f5762d5a`, `e8949e5b`, `9c9bf1d7`, `a8042ec3`, `03419167` (and the 293 agent revisions' heads for `cuts.mjs`); `squeal.config.json` at a8042ec3; `packages/*/vitest.config.ts`, `packages/web/vite.config.ts`, `packages/*/package.json` `exports`, `packages/web/tsconfig.json`.
- rolldown 1.1.5 (`rolldown/utils` `transformSync`), es-module-lexer 2.3.1, from the npm registry; Vite 8.1.4's `verbatimModuleSyntax` to `onlyRemoveTypeImports` read in cezar's `node_modules/.pnpm/vite@8.1.4…/dist/node/chunks/node.js`.
- Probes: `probes/central-edits/` (README, `graph.mjs`, `trust.mjs`, `direct.mjs`, `cuts.mjs`, `outside.mjs`, `capown.mjs`, `replay.mjs`, `measured.mjs`, `results/`).
