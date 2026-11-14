# Research brief for spec 022: selection strategy

Read `docs/vision.md`, `docs/styleguide.md`, `docs/process.md`, `docs/decisions/0002-content-keyed-shared-store.md` and `../status.md` first.

The human, 2026-11-14: "Research adding an option to configure test selection strategy. We currently use static imports, but I would like to add selecting by a module the test loads."

The human, 2026-11-14, later: "Use Kent C Dodds Kody as a reference for what I'm asking." Kody (github.com/kody-hq/kody, PR #5108, commit `2b3a0035a`, 2026-11-13) picks pre-push tests by the modules each test file evaluated in a CI run: `tools/vitest-module-map-setup.ts` records them, `tools/vitest-module-map-reporter.ts` writes one map per shard with a git blob hash per module, `tools/test-module-map.ts` selects the tests that loaded a changed module plus the tests the map has not seen, and `tools/vitest-related-observed.ts` falls back to `vitest related` with no map or with `KODY_PRE_PUSH_TEST_SELECTION=related`. The PR reports a one-line edit of `capabilities.ts` selecting 16 node-unit files instead of 923, and one file where the observed set is larger than the static one (8 to 114 workers-unit files). Both researchers were told this while running.

Our reading: today's strategy re-runs a test file when any file in its closure changes. The closure is the import graph (static and dynamic) plus literal `require`, glob expansions, observed reads, declared inputs, and the project's setup and config closure. The new strategy re-runs it only when a module it loaded in its last run changes. If you find a different reading that fits the words better (per test, or "the tests that load module X" as a command), say so in your first section.

Earlier research to extend, not repeat: `../../015-coverage-complexity/research/edit-reach.md` (33% of re-run seconds here do not load the edited file in their process; 41% load it and call nothing), `line-level-selection.md`, `selection-tools.md` and `cezar-selection.md` in that folder (line and function level: deferred, with the misses they proved), `../../011-core/research/central-edits.md` and `edit-cut.md` (direct and transitive importers). Note `~/projects/notes/projects/cezar/squeal-test-rerun-cost.md` (cezar's re-run cost, 2026-11-14). Spec 011 Non-goals: "Per-test closures from runtime coverage". Coverage is on by default since 2026-10-28.

Each topic is one researcher task. Write your findings to `research/<topic>.md` in this folder. Commit when done.

## Rules for findings documents

- Length: 1 to 4 pages. Structure: Questions answered (a table), Findings per question, Recommendation, Open questions for the human, Sources.
- Mark every finding `verified by experiment`, `read in official docs`, `read in source code` or `inferred`. Name the commit you read source at and, for outside tools, the version.
- Store data: copy a store with `VACUUM INTO` through a read-only connection into `$TMPDIR`; never open a live store for writing.
- Experiments: fixtures and clones under your own `$TMPDIR`, never the main checkout or another worktree. No full test suite, no `squeal run --all`. Stop every daemon you start.
- Load: this host is shared. Make no load on purpose. Skip timings while the one-minute load is above 24; report the load beside every timing you keep. A replay of recorded durations is fine at any load.
- Throwaway scripts live under `research/probes/<topic>/` with a README that says they are throwaway.
- Do not design the feature. Answer, measure, recommend; the coordinator writes the spec.
- Touch nothing outside `docs/specifications/022-selection-strategy/research/`.

## Topic: loaded-modules (row 022-01)

Can Squeal record what a test file loaded, is selection by it safe, and what does it save?

1. Today's closure per runner (Vitest `src/runners/vitest/graph.ts`, `loads.ts`, `dynamic.ts`, `environment.ts`; node:test; pytest): which kinds of path are in it that the test file's process never loads? Classify edit-reach's 33% from this repository's store: setup and config closure, `vi.mock` replacements, untaken dynamic imports, child-process scripts, declared inputs, others.
2. How each runner can record the modules a test file loaded, per file, in a run: Vitest (module runner, the V8 coverage records Squeal already stores, the Vite module graph), node:test (module hooks), pytest (import hooks, `sys.modules`). Cost per run, and whether isolation off or shared workers mix files' sets.
3. Soundness: which edits can change a test file's result while they touch no module it loaded? New files that a resolution or a glob would now find, a mocked module, a file read outside the module system, environment, child processes, the setup and config. Prove each with a fixture. Compare with how Ekstazi and testmon argue safety.
4. Savings and misses by replay on copies of this repository's and cezar's stores: test-file runs and recorded seconds the new strategy skips on real edit revisions, and recorded new failures it would not have run.
5. What a test file with no recorded load set (new, never run, failed to load) must fall back to.

## Topic: selection-option (row 022-02)

What in Squeal depends on the closure, and how do other tools offer more than one selection strategy?

1. Every reader of the closure in Squeal: the result key (011 C3, C4, C7), the edit cut and catch-up, named waits (`squeal status <path>`, `src/cli/named-selection.ts`), `squeal reach` (015 D11), the code gate (020), CI record and import (018), the shared store between worktrees. For each, what changes if the closure becomes the loaded set, and whether a result keyed under one strategy may be reused under the other.
2. Granularity a user would need: per repository, per runner, per group (019), per test file. Find evidence in this repository's and cezar's configs for one level over another.
3. Prior art: Jest (`--findRelatedTests`, `--changedSince`), Vitest (`related`, `--changed`), Wallaby, testmon, Ekstazi, Nx and Bazel. Which offer a choice of strategy, what the option is called, its default, and what users report about it.
4. The cost of a switch: does a project that changes the option re-run everything once? Does a key-format raise follow (see `docs/process.md` on key format)?
