# Edit reach: which source files make an edit re-run a large share of the suite, and why

Researcher, 2026-11-07, 10:20Z to 11:50Z. The human asked whether a suite that needs many runs per edit signals code or tests that are too coupled. Read: `docs/vision.md`, `docs/styleguide.md`, this spec's `status.md`, `011-core/research/edit-load.md` and its probes, `011-core/research/host-load.md`, `new-worktree-baseline/hubs.cjs`, and Squeal's keying code (below).

Versions: cezar `d6fed8685` (main, 2026-11-07 10:04Z; `squeal.config.json` with the browser group `at: manual`), squeal `bc58ad12f` (main). Read-only clones under `/tmp/er015`. Store copies (with `-wal` and `-shm`) and `report.json` copies taken 11:25Z: cezar 34,248 run reports, 752 watch revisions 2026-10-14 to 11-07; squeal 8,159 reports, 1,523 watch revisions 2026-10-06 to 11-07. No test, build or benchmark ran. Probes: `probes/edit-reach/README.md`.

**Units.** *Recorded seconds* of a test file: the median of its `fileDurations` over the stored run reports (cezar 1,646 of 1,780 files, 133 from summed test durations, 1 none; squeal 1,498 of 1,504, 6 none), measured on this loaded host. *Share*: the re-keyed files' seconds over the automatic suite (cezar 1,683 files, 11,715 s, without the 97 manual browser files of 2,148 s; squeal 1,504 files, 6,696 s). A *pair* is one (source file, test file it re-keys); *pair-seconds* weight a pair by the test file's seconds. "Every source edited once" weights each source file equally; "real edits" weights it by its count in the store's watch revisions of 1 to 3 paths (cezar 211 source edits of 87 files; squeal 137 of 64; small samples).

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Top 25 files | Cezar: four CI scripts the root `vitest.config.ts` imports (91%), 18 contract schema files (85 to 90%), the setup scripts (87 to 88%). Squeal: 25 files at 100%, all in the closure of the global teardown file. Tables below | verified by experiment (static graph over store closures and durations) |
| 2 | Path kinds | Cezar: test helpers 71%, transitive imports 18%, setup and config 3%, child processes 3%, declared inputs 2%, barrels 1%. Squeal: barrels 41%, observed reads 20%, helpers 16%, transitive 11%, declared 6%, type-only 2.6% | verified by experiment; graph emulated, checked against coverage |
| 3 | Smell or central | Cezar: mostly one central block, the workflow engine, loaded by its parity test layer, with three accidental gateways into it. Squeal: barrels and a global teardown file are smells; coverage shows 24% of squeal's pair-seconds call a function of the edited file | verified by coverage for squeal; inferred from import kinds for cezar |
| 4 | Cezar changes | Split the parity testkit, stop the runner factory loading all six runners, keep setup imports leaf-only, take reporters out of the config's imports; together about 11 to 13% of per-edit seconds. The engine itself is the 28% upper bound | inferred (what-if on the import graph) |
| 5 | A Squeal report | Feasible from the store for reach, seconds, real edits, observed and child-process paths, and coverage; it lacks import edges and the setup closure | read in source code and store |

## 1. The 25 files with the largest reach

The shares come from the store's closure of each test file, plus the setup and config closure of its Vitest project. Squeal hashes that closure into every test file's environment (`src/runners/vitest/environment.ts` `environmentFiles`, `project.ts` `isProjectInput`), and no stored closure holds it. *read in source code.* `edit-load.md` counted stored closures only, so its `src/core/fs/paths.ts` "in 826 closures" is now 1,504 of 1,504.

**Cezar** (full table: `probes/edit-reach/tables-cezar.md`):

| Files | Test files | Recorded s | Share | Path kinds | Edits |
|---|---|---|---|---|---|
| `.github/scripts/{ci-test-sequencer,vitest-coverage-tests,vitest-file-duration}.mjs`, `vitest-worker-count.cjs` (4) | 1,637 | 10,685 | 91% | config 95, declared 5 | 0 |
| `packages/contract/src/{application-update,health,effort,workspace,ask-schema,conversations,delegation,discovery,ci-wait,waits,per-runner-optional-strings,team-skill-ref}.ts` (12) | 1,374 to 1,395 | 10,416 to 10,487 | 89 to 90% | helper 59 to 64, transitive 21 to 29, barrel 9, setup 3 to 4 | 0 |
| `scripts/check-workspace-resolution.mjs`, `vitest.config.ts`, `scripts/test-sandbox.mjs` | 1,521 to 1,552 | 10,191 to 10,269 | 87 to 88% | setup 99 to 100 | 0, 0, 2 |
| `packages/contract/src/{preview,workflows,github,runs,task-options,attachments}.ts` (6) | 1,110 to 1,122 | 9,990 to 10,078 | 85 to 86% | helper 66 to 68, transitive 20 to 24, barrel 9 | 0 |

None of these 25 was edited more than twice in 24 days. The files that cost the most in practice (edits × seconds) are engine files: `delegation/workspace.ts` (26 edits, 719 test files, 71%, 24% of all real-edit cost), `delegation/service.ts` (14, 66%), `workflows/run.ts` (10, 70%), `home/store.ts` (6, 73%), `runs/store.ts` (6, 72%), `vitest.setup.ts` (5, 77%). *verified by experiment.*

**Squeal** (full table: `probes/edit-reach/tables-squeal.md`): all 25 re-key 1,504 test files, 6,696 s, 100%. Coverage column: share of the file's seconds in test files whose coverage record shows a function of the file ran / the file loaded but no function ran / the file did not load.

| Files | Path kinds | Called / loaded only / not loaded |
|---|---|---|
| `src/core/daemon/paths.ts`, `delivery/harness-process.ts`, `delivery/slots.ts` | barrel, helper, setup 17 to 26 | 17 to 57 / 12 to 56 / 17 to 25 |
| `src/core/fs/{compare,concurrency,errors,git-layout,git,index,json,paths}.ts` (8) | barrel 54 to 96 | 0 to 69 / 20 to 89 / 4 |
| `src/core/types/{common,daemon,delivery,index,policy,runner,scheduler,state,store-records,store,watcher}.ts` (11) | barrel 79 to 94 (`state.ts`: types only) | 0 for 7 of 11 / 77 to 89 / 6 |
| `test/daemon/strays.ts`, `test/global-teardown.ts`, `vitest.config.ts` | setup 80 to 100 | not loaded 73 to 93 |

All 25 are in the closure of `test/global-teardown.ts` (`globalSetup`), which imports `test/daemon/strays.ts` and through it `src/core/{daemon,delivery,fs,types}`. Real-edit cost leads with `src/core/state/slow.ts` (6 edits, 959 files, 85%, through the `src/core/state/index.ts` barrel, 29% called), `src/core/scheduler/tiers.ts` and `src/core/types/runner.ts` (100%, 9% called). *verified by experiment.*

Spread. Cezar is bimodal: of 1,116 package source files, 359 re-key at least 50% of the suite and 558 re-key under 5%; the mean is 26%. Squeal is not: of 912 `src/**/*.ts` files none re-keys under 5%, the median re-keys 56%, the mean 50%. Per real source edit the mean re-keyed share is 36.7% in cezar (about 4,300 recorded s) and 27.9% in squeal (about 1,870 s). *verified by experiment.*

## 2. The path each re-key takes

`reach.mjs` gives each pair its strongest reason: a direct value import, a transitive one without a barrel or test helper, one only through a barrel (a module of imports and exports only), one only through a test helper (`*.testkit.ts`, `test/` modules), a types-only module behind a value re-export, the project's setup or config closure, a declared input, an `import type` only, a module a child process of the test imported (`meta observedModules.<project>`), or another observed read. The value graph is emulated: esbuild drops imports used only as types, as Vite's transform does. Squeal's coverage confirms it: value-import pairs loaded the module in 86 to 96% of their seconds; declared, setup, type-only, child-process and observed pairs in 0%. *verified by experiment.*

| Share of pair-seconds | Cezar, every source once | Cezar, real edits | Squeal, every source once | Squeal, real edits |
|---|---|---|---|---|
| test helper | **70.5%** | **72.4%** | 16.2% | 11.6% |
| transitive import | 17.9% | 12.0% | 11.0% | 9.1% |
| barrel | 1.3% | 0.0% | **41.1%** | **45.6%** |
| direct import | 1.0% | 3.7% | 0.9% | 0.8% |
| setup or config closure | 3.1% | 8.1% | 0.9% | 0.7% |
| declared input | 2.3% | 1.0% | 5.9% | 5.1% |
| child process imported it | 3.0% | 1.9% | 1.7% | 2.5% |
| observed read | 0.7% | 0.7% | 19.6% | 22.0% |
| `import type` only, types-only module | 0.2% | 0.2% | 2.6% | 2.7% |

Squeal's observed reads are 106 test files, mostly `test/daemon/*` and `test/harness/opencode-*`, that read 500 to 880 `src` files each: they build and start the CLI from source. *read from store (`meta observed.`).*

## 3. Coupling smell or central code

**Cezar: one block, central, with accidental gateways.** 682 automatic test files (69.7% of the suite's seconds) load `packages/cezar/src/workflows/run.ts` (`RunManager`), whose value closure holds 338 source files. Those 682 files times those 338 files are 80.8% of all value pair-seconds (82.6% by real edits), and 27 of the 97 package source files edited in the window are in the block. Only 48 of the 682 import `run.ts` directly; the rest come through parity testkits: `waits-parity-cells.testkit.ts` (98 files, 1,653 s), `harness-parity.testkit.ts` (1,596 lines, imported by 85 files, on the path of 380), `harness-parity-cells.testkit.ts` (48), `monitoring-turn-rows.testkit.ts` (24), `worker-wait.testkit.ts` (127). Removing the edge from the 25 files that import only constants from `run.ts` cuts 0%: their tests drive `RunManager` through a testkit anyway. So most of the reach is tests that really run the engine. *verified by experiment (graph); central inferred from import kinds, no cezar coverage exists.* Squeal's own numbers suggest how much of such reach is called: helper-path pairs called a function of the module in 46% of their seconds, transitive pairs in 30%. *verified by coverage in squeal; transfer to cezar inferred.*

The smells inside the block:

- `core/harness-parity.testkit.ts` brings the engine (`run.ts`, `fixture-cleanup.testkit.ts`, `delegation/provision.ts`, `delegation/workspace.ts`) into the runner-adapter tests, for example `core/claude-cli-runner.test.ts`. *read in source code.*
- `core/runner-factory.ts` imports all six runner adapters; 690 test files reach it, and a per-runner test (`waits-claude-answers-parity.test.ts`) loads the five it does not name. *read in source code.*
- `vitest.setup.ts` → `runs/run-exits.ts` → `contract/src/waits.ts` puts 12 contract schema files in the environment of every server test file, for one function, `isUsageLimitHold`. *read in source code.*
- The root `vitest.config.ts` imports four CI-only scripts (sequencer, two reporters, worker count): an edit to any re-keys 91% of the suite. A reporter cannot change a test outcome. Nobody edited them in 24 days. *read in source code, inferred.*
- The contract schemas form a dense web (each of 68 modules reaches 21 to 25 others), so each re-keys 85 to 90%. Central: the run store parses with them. Their edit count was 0 in the window. *inferred.*

**Squeal: several smells, coverage-measured.** Of all squeal pair-seconds, 23.7% are in test files that called a function of the edited file, 41.4% loaded it and called none, 32.5% did not load it in process, 2.4% have no record. By kind: direct imports 69% called, helpers 46%, barrels 30%, transitive 30%, types-only modules 0%. *verified by coverage (newest record per test file, provider 3).*

- **Barrels** (43 `index.ts` files, for example `src/core/state/index.ts`, `src/core/types/index.ts`) carry 41% of the pair-seconds and call 30% of them.
- **`src/core/types/index.ts` re-exports with `export *`** from modules of types and a few values. `state.ts` holds types only and re-keys 100% of the suite; 7 of the 11 type modules are called by no test.
- **The global teardown file** puts 25 source files in every test file's environment (0.9% of pair-seconds only; most tests reach them through barrels anyway).
- **`test/scheduler/helpers.ts`** (506 lines, 23 imports including both runner adapters, used by 153 test files): without its imports, 16.4% of pair-seconds (14.0% of real-edit) would not hold.
- **Central and really needed:** the daemon and harness tests that bundle and start the CLI (observed reads, 20%); coverage cannot see child processes, and `edit-load.md` finding 3 found real failures there. Declared `src/**/*.ts` inputs for the codex, OpenCode and Pi harness tests: 4.8%.

## 4. Changes in cezar that would cut the most

Estimates come from `cut.mjs`: it removes import edges from the graph and counts the value pairs that no longer hold. Read the result as a share of pair-seconds, every source edited once / real edits. Seconds use the 4,300 s mean per real source edit. Proposals only. *inferred.*

| # | Change | Cut | Per real source edit |
|---|---|---|---|
| 1 | Split `core/harness-parity.testkit.ts`: an adapter-level kit (runner, transcript, process) without `RunManager`, `fixture-cleanup.testkit.ts`, `provision.ts`, `delegation/workspace.ts`; workflow tests import a second kit | 4.6% / 6.2% (380 test files) | about 270 s |
| 2 | Per-runner tests import only their runner: the factory takes a registry the test fills, or cells import the adapter. A lazy `import()` does not help: Squeal's closure holds dynamic imports (`graph.ts` `importClosure`) | 6.6% / 4.3% (690 files, keeping the named runner) | about 185 s |
| 1+2 | Both | 12.6% / 11.3% | about 485 s |
| 3 | Setup imports only leaf modules: move `isUsageLimitHold` out of `contract/src/waits.ts`, or import it from a leaf | about 3 to 4% of each contract file's reach (about 330 s per contract edit); 0 contract edits in the window | near 0 now |
| 4 | Root `vitest.config.ts`: name the CI reporters and sequencer by path string, or load them only under CI, so they leave the config's imports | 91% of the suite per edit of those 4 files; 0 edits in the window | near 0 now |
| 5 | Longer term: `RunManager` takes its store, runner factory, delegation service and server as injected ports, so parity cells load fakes | at most 27.6% / 3.7% (upper bound: `run.ts` imports nothing) | at most about 160 s |

The browser group change of 2026-11-06 (`at: manual`) already removed the largest single cost: 97 e2e files, 2,148 s on every edit. `edit-load.md` measured them at 82 files and 5,211 s.

## 5. Could Squeal report this itself?

Yes, read-only and pull-only (vision: "push transitions, pull state"), for example `squeal code --reach [<path>...]`. *read in source code and store.*

**What the store already holds:** each test file's closure (`test_files.closure_paths`), observed reads and child-process imports (`meta observed.`, `observedModules.`, `observedDirect.` per project), per-file durations (`runs` and `report.json` `fileDurations`), real edits (`revisions.changes`), declared inputs (the policy), and, when coverage is on, per-test-file loaded and called sources (`code.sqlite` `coverage`, `coverage_parts`, functions with hit flags). From these it can show, per source file: test files re-keyed, recorded seconds, share of the suite, the split into import, declared, observed and child-process paths, the real-edit cost over the store's window, and, with coverage, the called / loaded-only / not-loaded split. It can also give the per-project distribution (how many files re-key at least 50%).

**What it lacks:**

1. The import edges. The closure is a flat set, so Squeal cannot name the gateway (barrel, testkit, factory) or estimate a cut. The adapter already walks one hop at a time (`importTargets`); storing each file's direct value targets, keyed by blob, would supply them.
2. The setup and config closure. It is hashed into the environment and not listed, and it is the reason for squeal's 100% files.
3. Type-only edges, to name "types-only module behind a value re-export".

**How it should work on any project.** Shares and ranks are relative to the user's own suite and their own recorded seconds, never fixed second limits or core counts. The real-edit weighting comes from the user's own revisions. A file is flagged by its relative position (for example, it re-keys over half the suite while its tests call it in under a third of their seconds), not by a threshold tuned to this host. It runs no test and costs only a store read. It must say when coverage is off: then "called" is unknown, and import kinds are only a proxy.

## Open questions

- What share of cezar's engine reach calls the edited module? Not determined: cezar has no coverage records (coverage is not enabled in its config), and running its suite was out of scope.
- Do the gateway edges in proposals 1 and 2 hold no other value? The cuts assume the remaining imports keep each test working; a cezar worker would confirm per file.
- The recorded seconds are medians on a host at load 25 to 100. Shares are robust to this; absolute seconds read high.
- The emulated graph includes dynamic imports that coverage did not see loaded: 14% of squeal's transitive pair-seconds. Squeal keys them too, so they count as reach.

## Sources

- Squeal source at `bc58ad12f`: `src/core/keys/closure.ts` (`assembleClosure`), `src/runners/vitest/graph.ts` (`importClosure`, static and dynamic deps), `environment.ts` and `project.ts` (setup and config files in the environment), `src/core/keys/observed.ts`, `src/core/store/schema.ts`, `src/core/code/store/schema.ts`, `src/core/code/coverage/{record,parts,types}.ts`.
- Cezar at `d6fed8685`: `squeal.config.json`, `vitest.config.ts`, `packages/{cezar,web}/vitest.{config,setup}.ts`, the testkits named above.
- Store copies: `~/projects/cezar/.git/squeal/store.sqlite`, `~/projects/squeal/.git/squeal/{store,code}.sqlite`, with their `runs/*/report.json`.
- Earlier research: `docs/specifications/011-core/research/edit-load.md` (findings 1 and 3), `host-load.md`.
- Probes: `probes/edit-reach/` (`reach.mjs`, `paths.mjs`, `cut.mjs`, `table.mjs`, specs, tables, summaries).
