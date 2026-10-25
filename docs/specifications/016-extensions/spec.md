# 016 Extensions: one correctness kit and the three repeat seams

Status: approved by the human 2026-10-25. Research, decisions and amendments: `status.md`, `research/`.

## Scope

The human's idea was a core plus extensions that other people write. Research 016-01 to 016-10 found that the public half (protocol, SDK, license, registry) pays only if outsiders come, and that the internal half reaches about 5 to 8% of past defects (`research/defect-causes.md`). The human then narrowed this spec on 2026-10-24 to the part the numbers support:

1. one correctness kit whose scenarios are written once and run against every runner;
2. the three seams that kept costing review rounds: the runner of a check is recorded, not guessed; observed paths reach the shared store through one path; `src/harness/shared` names no runner.

Everything else from the research stays a finding, not a plan (Non-goals).

## Problem

- **Each runner tests correctness in its own words.** Each of 14 correctness scenarios has a test for at least one runner, and none is written once for all three (`research/runner-kit.md` finding 1). A defect found on one runner stays a test of that runner. Row 007-29's stale pass after a same-size, same-second edit had a test for pytest only. Vitest and node:test had none.
- **No check records its runner.** `src/core/delivery/attribution.ts` infers it from the policy and the file's extension. That took three FAIL rounds in a row (007 waves 5.5, 5.75 and 5.875), and the residual is row 007-45.
- **Observed paths reach the store two ways.** Vitest returns them in `RunReport.observed`, and the core merges them (`src/core/scheduler/observed.ts`): it drops ignored paths, hashes every path into the stat cache and marks first-seen paths. node:test and pytest get an `ObservedStore` from the daemon (`src/core/daemon/node-test-runners.ts:30`, `pytest-runners.ts:32`). That store writes the stored closures of every worktree directly, and it is copied line for line between the two runners. It produced findings in three specs (003 wave 2 S2, 004 wave 2.5 B3, 007 wave 2.5 R1). Rows 007-47, 007-52 and 007-56 are open on it.
- **`src/harness/shared` knows every runner.** It parses `vitest`, npm scripts, `node --test` and `pytest` commands for the deny (005 D8), names runners in the primer and in coverage, and imports pytest's environment discovery (`deny.ts:21`). That gave four blockers (001 wave 13aa B1 and B2, 005 wave 2 B1, 007 wave 2 B4).

## Goals

1. Every kit scenario is written once and runs against Vitest, node:test and pytest in Squeal's own suite, with one pack per runner.
2. A runner's documented gap reads KNOWN, with the spec line that documents it. A gap that closes fails the test as UNEXPECTED PASS until it is removed from the list.
3. Replaying three past defects on a scratch branch makes the kit fail each one: row 007-29's shared bytecode cache, 003 wave 2 B1's computed `import()` in a preload, and one of the interrupted Vitest runs (011 `0.1.287.md` B1).
4. No check's runner is inferred. Attribution reads the stored runner. The `.js` doctest case of 007 `reviews/wave-5.875.md` gets no "No dependencies are installed" sentence. A store from before the change reads as before.
5. node:test and pytest observed paths reach the store only through the core's path, and `ObservedStore` with both of its copies is gone. Their adapter suites and `test/scheduler/environment-growth-*.test.ts` pass with no assertion changed, except a difference D4's survey names and the human accepts.
6. After a daemon restart, and in a second worktree, an edit of a path that a child process imported puts its test file in `direct` (row 007-56).
7. No source file under `src/harness/shared` names a runner. The deny, the primer and the coverage lines say what they say today.
8. A kit file re-runs only when its own closure changes: its runner's adapter and what that imports, and the kit. An edit inside one runner's folder re-runs no other runner's kit file. That second rule holds once row 016-20 moves the helpers node:test's folder shares with the other two runners into a folder of their own (review `reviews/016-12.md` B1); until then an edit to them re-runs every kit file that loads them, as their closures require.

## Non-goals

- A public contract, an SDK, a license, a registry, or third-party code of any kind (the human, 2026-10-24: decided later).
- A load point by name, a runner description beyond what D5 needs, moving toolkit code between runner folders, policy members per runner, and runner names in core status (seams S1, S4, S7, S10 in `research/seams.md`).
- New check kinds (linters, type checkers) and diagnostic identity.
- Moving harness adapters behind a process protocol, or any new harness.
- A kit level that drives a scratch daemon (open question 1).

## Design

### D1. The kit

**Location.** `test/kit/`:
- `scenarios/`, the runner-neutral scenarios;
- `packs/vitest.ts`, `packs/node-test.ts`, `packs/pytest.ts`;
- `driver.ts`, which names no runner;
- one test file per runner, `test/kit/<runner>.test.ts`, which runs every scenario through that runner's pack.

The kit drives `RunnerAdapter` directly in a scratch directory under the test's temporary root. It starts no daemon and touches no live store (`research/runner-kit.md` finding 2).

**A scenario** is three things:
- abstract modules of kinds such as `value`, `reexport`, `test`, `computed`, `broken`, `hook` and `dependency`;
- an edit script;
- after each step, the expected outcome of each check (pass, fail, file-error, unknown) and the expected reach. Reach means: after an edit, the test file is in `affected`, or the path is in `closure()` or in the last run's observations.

A scenario that depends on a path missing from the static closure first asserts that precondition. Otherwise it proves nothing.

**A pack** renders each module kind in its runner's syntax:
- paths, project files, the full name of a check, and how the adapter opens;
- `variants`: per-runner forms of one scenario, for example node:test's `--import`, `--require` and quoted `NODE_OPTIONS` preloads, or pytest's `-p` plugin and `conftest.py`. Variants are where runner knowledge lives (`research/runner-kit.md` finding 4);
- `known`: the documented gaps, each with the spec line that documents it.

**Verdicts.**
- PASS: the expected outcome.
- FAIL: anything else.
- KNOWN: a listed gap failed as documented.
- UNEXPECTED PASS: a listed gap passed. It fails the test, so the list stays true.

**The first scenarios.** These carry the past defects (`research/defect-causes.md` recommendation 3, `research/runner-kit.md` recommendation 2):
- K1: a source edit flips a test, then it recovers.
- K2: an edit two imports away re-runs the dependent file.
- K3: a file fails to load, then recovers.
- K4: a runtime read outside the static closure is observed.
- K5: a startup hook loads a module by a computed path, with each pack's variants.
- K6: an installed dependency changes.
- K7: an edit keeps the file size and the whole-second mtime.
- K8: a run is interrupted or cut mid-file, and nothing it wrote counts.
- K9: a test imports a missing file, then the file is created.

Later scenarios, each its own row: a deleted test is retired, duplicate names, a focused run, an environment file re-keys, and two worktrees share one store.

**Determinism.** No scenario sleeps or depends on load:
- K7 sets the mtime with `utimes`.
- K8 cuts the run at a marker, as `test/keys/validity/harness/vitest.ts` holds a run inside a test file.
- A scenario that cannot be pinned this way is not written until it can be.

**Keys.** The kit's test files key their closure, so Squeal's daemon re-runs a runner's kit file only when that runner's code, what it imports, or the kit changes (goal 8). If a closure misses a pack's runtime, `squeal.config.json` declares it under `inputs`.

### D2. Contract preconditions

`RunnerAdapter` gets the two preconditions the kit found (`research/runner-kit.md` finding 3):

- `RunOptions.logDir` is a directory that no earlier run used. The daemon already gives `runs/<run-id>/`. With a shared directory, the pytest adapter read an earlier run's pass after a failing edit.
- The observed-store precondition goes away with D4.

C14 in 011's spec is amended to state the first one, and to correct its node:test focus line: node:test runs focused files whole, as 003 D5 says (`research/seams.md` F1.2). 011's coordinator is told before the amendment lands.

### D3. A check knows its runner (row 007-45)

The runner that produced a check is stored when the check is first recorded. Attribution decides ownership from that record, never from the policy or a file extension. `NODE_TEST_FILE`, the `loadPolicy` read in `nodeFailing` and its three-round comment are deleted, as row 007-45 states.

The store step must keep 011 C7's compatibility rule. A daemon that finds a `user_version` newer than it understands exits, so raising it would stop every older daemon of a repository. The slice brief weighs these options, with a test for each:
- a nullable column added without a version raise, which older daemons leave empty;
- a shared `meta` map from project to runner, written when a project is enumerated and kept while any check of the project is.

When the record is absent (a check an older daemon wrote), attribution says nothing rather than guess. A raise of `user_version` goes to the human first.

~~Decided 2026-10-25 (the coordinator, open question 2): the nullable column `checks.runner`.~~ Replaced the same day, after reviews `reviews/0.1.303.md` (B1, and its two re-reviews). A runner per check is shared by every worktree, so another worktree's run changed this one's sentence. A column on `results` breaks older daemons on Node 22 (011 C7 as amended 2026-10-25).

Decided 2026-10-25 (the human chose a third round, and then accepted its one residual): each worktree records the runner of each of its projects in one `meta` row, `runners:<wt>`. `Ledger#write` writes it for the projects of the files, results and setup checks it commits, runs and lookups alike, and only when a runner changes. Attribution reads the failing check's project there, for result and setup checks alike. No table gains a column. A worktree whose daemon is older records nothing, so its failures get no sentence.

Accepted residual (the human, 2026-10-25, `reviews/0.1.303.md` Re-review 2): the record is per project, not per failure. When a worktree's config moves a project name to another runner, a failure the old runner left, still shown because no run of its file has ended, reads the new runner until its file runs again. Only the dependency sentence can be wrong; no verdict changes.

### D4. One write path for observed paths (rows 007-47, 007-52, 007-56)

Every runner reports what it observed through `RunReport`: per completed file in `observed`, and per project in `environmentObserved` (the start-up paths: node:test preloads, pytest session hooks). Only the core writes observed paths to the store, through `src/core/scheduler/observed.ts`. node:test and pytest observations then get the same treatment as Vitest's:
- ignored paths are dropped;
- every path is hashed into the stat cache;
- first-seen paths are marked;
- paths merge across worktrees under the same lock.

`observedStore`, `pytestObservedStore`, both `ObservedStore` types and both `Observed` trackers are deleted. What an adapter needs back, so that its `closure()` and its `affected()` direct marks see earlier observations after a restart and in another worktree (row 007-56), the core passes in read-only. A survey row first maps the semantics, because the two paths differ today:
- per runner: what is observed, where it is kept, who reads it back and when;
- how it enters `closure`, `affected` and the environment;
- where the core's filters are stricter than the injected stores. A git-ignored path is the one to settle first. The core drops it. No ignore filter appears in `src/runners/node-test/adapter-observed.ts`, `src/runners/pytest/adapter-observed.ts` or the two daemon stores (a search on 2026-10-24), though one may run earlier in the recorder. 009 lessons observation 4 is a stale FAIL behind a git-ignored path;
- how today's meta entries (`nodeTest.observed.*`, `pytest.observed.*`) are read once into the core's form.

Every difference that could change a verdict goes to the human before the slice. The human decided two on 2026-10-25 (`status.md`):
- node:test and pytest module loads key whatever `observe.runtimeInputs` says, as today (survey O8);
- D4 raises `NODE_TEST_ADAPTER_VERSION` and `PYTEST_ADAPTER_VERSION` (C3's rule: what is kept changes), and `test/keys/validity`'s comparison shows the difference for both runners. An older daemon's keys then never equal the new ones, so nothing is merged.

The human decided the third on 2026-10-25, from row 016-19's count (`research/ignored-paths.md`): an observed git-ignored path is kept, for every runner, unless the same test file wrote, created or removed one of its ancestor directories (survey O1 (b), the written-directory bound). The recorder records `mkdtemp` as a create. Measured, this keeps 21, 2 and 0 paths on the three projects counted, with no growth on a second run. node:test's and pytest's runtimes record the directories a test file creates or removes, so the bound applies to them too (016-17, coordinator, 2026-10-25). The human decided two more on 2026-10-25: D4 raises `RECORDER_VERSION` as well, so every Vitest file runs once after the release and no result kept from before the bound is reused; and adapter-suite cases that assert the injected stores move to core-level tests of the same claim, each listed in `tasks/016-17/notes.md` (goal 5). The adapter gets nothing back: the core assembles the start-up paths and the `direct` marks itself (survey Q4, recommendation 3; coordinator, 2026-10-25), so the read-only view above is not built. Vitest's `affected()` reads Vite's module graph alone (011 C4 step 4), so a Vitest child process's imports reach `direct` through the recorder (row 016-22; the coordinator, 2026-10-25): a process the test file started, its threads and its descendants carry `started` in their settings, and each module Node resolves there and each such process's entry point are marked beside the read paths; the core keeps the marks as it does node:test's. A thread of the test file's own process, a started process's file reads and the files a spawn's arguments name mark nothing; a started process's own project preload counts as one of its imports. Goal 6 holds for all three runners. `RECORDER_VERSION` stays: the recorder sees the same paths, so no key changes meaning. A Vitest file stored before that release has no marks until it runs again; until then an edit of its child's import re-keys it and runs it as catch-up. This section edits `src/core/scheduler/`, so 011's coordinator is told before the brief is dispatched (`status.md`, 2026-10-24).

### D5. `src/harness/shared` names no runner

Each runner supplies a description in `src/runners/<runner>/describe.ts`:
- how its test commands look, for the deny of 005 D8 (today `test-command.ts`, `test-command-files.ts`, `test-command-pytest.ts` and `test-command-reason.ts`, 444 lines);
- its name in the primer and its coverage line (today `primer.ts`, `coverage.ts`);
- the environment discovery the deny needs (today `deny.ts:21`).

`src/harness/shared` reads the descriptions from one registry, `src/runners/descriptions.ts`. The rules of 005 D8 and 011 C8 do not change, only where the runner knowledge lives. Every plugin bundle already carries every runner, so the bundles gain no runtime.

### D6. Waves

- **Wave 0, in parallel.**
  - The kit's scaffold: driver, three packs and K1 to K3, tests only (D1).
  - The observed-path survey (D4).
- **Wave 1, in parallel, on disjoint files.**
  - K4 to K9 with their variants, and the replay of goal 3 (`test/kit/`).
  - A check knows its runner (D3: `src/core/delivery/`, the store).
  - Runner descriptions (D5: `src/harness/shared/`, `src/runners/*/describe.ts`).
  - Shared runner helpers out of node:test's folder (goal 8: `src/runners/`).
  - The contract text of D2 lands with the scaffold.
- **Wave 2: one write path (D4).** It comes after the survey and the human's decisions on its differences. It also comes after K4, K5 and a two-worktree scenario are on main, so the kit guards the riskiest change before it lands.
- **Every product landing:** a candidate whose version is agreed with 011's and 015's coordinators, one `/reviewer` on its SHA, and the 10-minute notice before main and hub pushes (`docs/process.md` steps 5 and 6).

## Testing

- The kit is its own test: three test files in Squeal's suite, one per runner. Goal 3's replay is a scratch branch, never merged: each past defect is reintroduced, the kit fails, the branch is dropped. The replay output is recorded in `lessons.md`.
- D3, D4 and D5 are written test first. Their done-when lists the existing suites that must pass with no assertion changed (goals 4 to 7). D4 adds the restart and second-worktree cases of row 007-56.
- Goal 8: in a scratch worktree, an edit inside one runner's folder leaves the other two runners' kit files current in `squeal status`.
- No local full suite. CI on the candidate and the reviewer's locked run are the full-suite checks (`docs/process.md`, test runs on a shared host).

## Open questions

1. ~~Should the kit also run through a scratch daemon?~~ Answered 2026-10-25 from `research/core-defects.md` finding 3: not in 016. It ranks after one owner per rule and a model-based scheduler test (`status.md` amendment log).
2. ~~D3's store step: a column without a version raise, or a `meta` map.~~ Answered 2026-10-25: the column (D3).
3. ~~The rule for git-ignored observed paths (survey O1).~~ Answered 2026-10-25 by the human: the written-directory bound (D4). O8 and the older daemon were answered the same day.
4. ~~Should the kit replace the overlapping adapter-level tests (about a third of 1,221 lines, `research/runner-kit.md` finding 5), and share fixtures with the validity corpus?~~ Answered 2026-10-25 by 016's coordinator: not in 016. The kit stays the contract test and the adapter suites keep each runner's own detail; the `/quality` scan after the spec ships lists each adapter case the kit already proves as a drop candidate, and fixtures are shared only where that scan finds two copies (`status.md`).

## References

- `status.md`, the entries of 2026-10-24.
- `research/seams.md` (S2, S5, F1.2, F4.3), `research/runner-kit.md`, `research/defect-causes.md` (finding 4, recommendations 2 and 3), `research/third-party-trust.md` (Q4, provenance).
- 011 C3, C4, C7, C12, C14; 005 D8; 003 D5; 007 D6.
- Board rows 007-45, 007-47, 007-52, 007-56, released to 016 by 011's coordinator 04a258b0 on 2026-10-24.
- Reviews: 007 `wave-5.5.md`, `wave-5.75.md`, `wave-5.875.md`; 003 `wave-2.md`; 004 `wave-2.5.md`; 007 `wave-2.5.md`; 001 `wave-13aa.md`; 005 `wave-2.md`; 007 `wave-2.md`; 011 `0.1.287.md`.
