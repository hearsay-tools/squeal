# 022 Selection strategy: the modules a test file loads

## Problem

Squeal re-runs a test file when a path in its closure changes. In a Vitest project, the import part of that closure is the transform graph: static and dynamic imports, followed transitively. The graph does not match what a test file runs, in two ways:

- **It over-selects where code imports lazily.** Kody's registry file lazily imports about 1,000 tests' worth of modules. A one-line edit there re-ran 923 node-unit files with `vitest related`; 16 of them loaded the file (kody-hq/kody PR #5108). On this repository and cezar this shape is rare: import-graph paths that no run loaded are 1.2% and 3.6% of the "re-run but did not load" seconds (`research/loaded-modules.md` 1).
- **It under-selects where a runtime loads code without an import.** In Kody's Cloudflare Workers tests the pool loads the worker entry at runtime. Over 50 commits the import graph missed 970 selections that the loaded modules caught (`loaded-modules.md` 4). Squeal's closure has the same gap. Nothing records what the Vitest module runner evaluated, because the runner fetches modules from the daemon's Vite server and the runtime-input recorder sees only the worker's own file system calls.

The human, 2026-11-14, asked for selection by the modules a test loads, with Kody as the reference. The research showed that Kody's rule as it is (re-run only when a loaded module changed) is not safe here: it would have skipped 11 of 19 real new failures in this repository's history, all in tests that read source files as data (`loaded-modules.md` 4).

## Goals

Phase 1 (the human, 2026-11-14):

1. Squeal records, for each Vitest test file run with coverage on, the repository modules its worker evaluated. Recording costs under 1 ms per test file (D1).
2. A loaded module outside the test file's closure and environment joins its key. After that, an edit to it re-runs the test file. No key format raise; files whose loaded modules are all in their closure keep their keys (D2).
3. The loaded list is stored per result key and shared by every worktree (D3).
4. `squeal reach` estimates, per project, the share of re-run seconds that narrowing by loaded modules would save. It also names the files it cannot estimate and why (D4).

Phase 2, built only when the human sees a project's estimate and asks for it (the human, 2026-11-14):

5. A repository setting, off by default, narrows the import part of each test file's closure to the modules it loaded. Every other input stays in the key. A test file with no usable list keeps today's closure. Each narrowed file runs once at the switch (D5).

## Non-goals

- **Kody's rule as it is.** That rule re-runs a test file only on a change to a loaded module. It drops file reads, declared inputs, child processes and the setup and config closure from the key (the human, 2026-11-14: "Do not offer Kody's rule").
- **Loaded lists from CI.** Lists come from local runs only. A CI run may add inputs to a key, never remove one (018 D6, D11 stand; the human, 2026-11-14).
- **node:test and pytest in phase 1.** node:test already records the modules each process loads (its recorder's resolve hook). pytest runs five files per process, so a per-file list depends on file order. Both keep today's closure until a later row (the human, 2026-11-14: "Vitest first").
- **Recording with coverage off.** Phase 1 records through the coverage provider, which runs in the worker (D1). An injected setup file would change every project's environment hash and re-run every test once. A project with coverage off gets no lists, and its reach estimate says why.
- **Per-test lists, and function or line level selection.** 015's `line-level-selection.md`, `selection-tools.md` and `cezar-selection.md` deferred these; 011's non-goal "Per-test closures from runtime coverage" stands.

## Design

### D1. Recording (Vitest)

The coverage provider (`src/core/code/coverage/provider.mjs`) already runs in each Vitest worker, beside each test file, on every supported Vitest (peer range `>=5`; the field exists from 4.1). Its `takeCoverage` also reads the worker's `globalThis.__vitest_worker__.evaluatedModules.idToModuleMap` and returns the loaded list with the coverage data.

Rules, from `loaded-modules.md` 2:

- **Node presence, not `evaluated`.** `vi.resetModules()` sets `evaluated = false` on every node and keeps it. A node that exists was loaded in this file's run.
- **Repository paths only.** The query and hash are stripped (`a.txt?raw` is `a.txt`); `mock:<path>` maps to `<path>`. `node_modules`, virtual ids and paths outside the worktree root are dropped; packages are keyed by the lockfile and install (011 C11).
- **No `coverage.exclude` filter.** The list is what the worker loaded; the coverage record keeps its own exclusion. This repository excludes `test/**`, and its helpers belong in the list.
- **One list per test file, only under isolation.** With Vitest `isolate: false`, a list is the union of every earlier file in the same worker. No list is recorded then, as no coverage record is (`selection-option.md` 1).
- **No list when the file did not complete.** A file that failed to load, was skipped by the inspector rule or timed out has no list. Nothing is added to its key from that run.
- **A list must hold the test file itself.** Otherwise it is dropped as lost. Kody's reporter has this rule; 5 cezar records broke it.

Cost: 0.31 to 0.40 ms per test file for 300 loaded modules, measured at load 10.7 to 12.9 (`loaded-modules.md` 2).

### D2. Loaded modules join the key (union)

A list's paths enter the observed inputs of the run (`ObservedInputs.paths` and `.modules`, 016 D4). They are not new state. They follow the rules observed paths already follow (011 C3, C4; 001-132):

- They are merged into the per-project shared map, kept across worktrees and never pruned.
- A result is stored under the key that includes them.
- A run whose new path was first hashed after the run began is discarded.

Two rules keep keys still where nothing new was learned:

- **Paths already accounted for add nothing.** These are paths already in the test file's closure (the test file, its import graph, its snapshot, declared inputs, earlier observed paths) and paths the project's environment hash holds (setup files, global setup, config and their closures). Setup files are loaded by every test file. Without this rule, every key would move once.
- **Policy `observe.runtimeInputs` holds this too.** With it off, no list joins the key, as with every other observed path.

Effect: a test file that reaches a module only at runtime re-keys when that module changes. The cost measured on this repository and cezar is 0.1% to 0.2% more re-runs (`loaded-modules.md` 4, "S1 adds"). Part of that is a list and a closure taken on different branches.

**Key format.** Keys only gain paths. A result stored by an older release under a key without the new path is not found: the file runs once. It is never read as current under the wrong inputs. No `KEY_FORMAT_VERSION` raise follows (`docs/process.md`, key format). The key-format alarm (`test/keys/key-format.test.ts`) still runs over the changed validity path and decides by its corpus.

### D3. The loaded list in the store

Lists are kept apart from the closure. Reach needs to know which closure paths the file did not load, and phase 2 needs the same. A new table in the shared store is created at open, with no schema version raise, as `IMPORT_TABLES` and `CODE_TABLES` are. It holds one list per result key: the project, the test path, the key, and the loaded paths with their blob ids.

- Prune removes a list with its result.
- `test_files.method` keeps its one value. A new value there makes older daemons that share the store throw (`store/codec.ts` `oneOf`; `selection-option.md` 1).
- CI export and import carry no lists (non-goal).

### D4. The reach estimate

`squeal reach` (015 D11) gains one section per project, in text and JSON: **narrowing by loaded modules**. It keeps D11's rules: pull only, store reads only, no test, no daemon, no write.

- **What it counts.** For each edit revision in D11's window and each test file the edit re-keyed, the pair is *avoidable* when two things hold. The test file has a list at the key it had before the edit. And every changed path that re-keyed it is an import-graph path of its closure that the list does not hold. A change through any other input (observed reads, declared inputs, snapshot, resolution candidates, glob expansions, the environment) is never avoidable. The estimate is the avoidable pairs' recorded seconds over the project's re-run seconds in the window, weighted as D11 weights its shares.
- **What it shows.** The share and the seconds. The ten source files with the most avoidable seconds, each with the count of test files that import it and the count that loaded it (PR #5108's table shape). The re-keyed files without a list, by reason: never recorded, coverage off, `isolate: false`, incomplete run, list lost. With no lists at all, it says so and names the reason, and estimates nothing.
- **Reading it.** The estimate is an upper bound on what phase 2 saves. It does not prove those tests are waste. A loaded file that runs nothing (`edit-reach.md`: 41% here) stays selected under phase 2.

For scale, the research's replay gives what the estimate should show: about 0.0% here, 0.8% for cezar, 57% for Kody's node-unit project (`loaded-modules.md` 4).

### D5. Phase 2: the narrowing setting (not built until the human asks)

A key in `squeal.config.json`, repository level. Its name and values are decided with the phase 2 rows; the default is today's rule. A project with no per-file record (pytest, single-process projects) keeps today's rule (`selection-option.md` 2).

- **The narrowed closure.** Today's closure, with the import-graph paths that the list at the file's previous key does not hold removed. Every other input stays. A test file with no usable list (D1's cases) keeps today's closure.
- **At the switch.** Each narrowed file's key carries a marker, so the file runs once (the human, 2026-11-14: "Run them once"). The research measured 15% of recorded files here and 25% in cezar.
- **Readers to change with it.** From `selection-option.md` 1:
  - named waits on a path (`src/cli/named-selection.ts`);
  - `squeal reach`;
  - the code gate's store lookup, which must key as the daemon does;
  - status, which today shows one `closureMethod` per payload;
  - CI import, where results reach only files whose key did not narrow.
- **Not narrowed.** The edit cut and catch-up ranking stay on the runner's `affected`. A file the narrowed key no longer re-keys finds its stored result.

## Testing

- **Recorder fixtures**, one each, Vitest 5:
  - `vi.resetModules()` in a test;
  - an automock (`mock:` id) and a factory mock;
  - `?raw`;
  - a failed load;
  - `isolate: false`;
  - a list without its own test file.
  The cases come from `research/probes/loaded-modules/vitest/`.
- **Union:**
  - A fixture where a test file loads a module only at runtime (a computed `import()`; a Kody-style pool entry). Editing that module re-keys the file after its first run.
  - A setup-file edit moves no key through the list.
  - A file whose list is inside its closure keeps its key.
  - With `observe.runtimeInputs` off, nothing joins.
- **No-loss checks:** the 20 escape cases of `loaded-modules.md` 3 still re-key under today's closure. Phase 1 removes nothing.
- **Store:** an older-build reader opens a store that holds the new table. Prune removes a list with its result.
- **Reach:** a fixture store with an avoidable pair, a pair through a declared input, a file without a list for each reason, and a project with no lists. Text and JSON.
- **Key format:** `pnpm exec vitest run test/keys/key-format.test.ts test/version-sensitive.test.ts`.
- **Dogfood:** after release, `squeal reach` on this repository and cezar. The estimates are set beside the research's replay (about 0% and 1%).

## Slices (rows filed when the spec is approved)

- **022-03** Recorder and union (D1, D2): the coverage provider's list, its rules, the observed-input route, the environment exclusion.
- **022-04** The loaded-list table (D3), written by 022-03's path; its schema is a contract file committed before the wave.
- **022-05** The reach estimate (D4), against the D3 contract.

022-03 and 022-05 can run in parallel once the D3 contract is on the branch; 022-04 is small and folds into 022-03 if the wave brief finds it so. Phase 2 (D5) gets rows only when the human asks.

## Open questions

1. **Phase 2 trigger** (the human). The research expects phase 1's estimate to show about 0% here and 1% on cezar. Is there a threshold, such as 10% for one project, at which phase 2 should be proposed, or does the human decide on each reading?
2. **Coverage off** (coordinator, in the phase 1 wave). A project with coverage off gets no lists. If a project asks for lists without coverage, a runner hook (Vitest's `onAfterRunFiles`, which also runs after a failed load) is the candidate. That needs its own research, since the hook must not move the environment hash.
3. **node:test lists** (later row). The node:test recorder already records the modules each process loads. Feeding them into D3 and D4 is the next runner.

## References

- `research/loaded-modules.md` (022-01), `research/selection-option.md` (022-02), `research/README.md`; `status.md`.
- Kody: https://github.com/kody-hq/kody/pull/5108 (`2b3a0035a`); issues #4995, #5062.
- Vitest 5.1 `experimental.recordDependencies` (an experimental recorded-dependency mode; not used, compared in `selection-option.md` 3).
- 011 C3, C4, C7, C11; 015 D11 and `research/edit-reach.md`; 016 D4; 018 D6, D11, D14 to D16; 001-132 (observed runtime inputs).
