# 016-10 one correctness kit for every runner: findings

Researcher 016-10, 2026-10-24, at `f6320cd7e`. Brief: `runner-kit-brief.md`. Probes: `probes/runner-kit/` (throwaway). Vitest 5.0.3, Node 24.21.0, pytest 9.1.1 on Python 3.12.3.

## Questions answered

| # | Question | Answer | Tag |
| --- | --- | --- | --- |
| 1 | Inventory | Each of the 10 scenarios has a test for at least one runner. No scenario is stated once for all three. 3 cells have no runner test: a deleted pytest file, a pytest duplicate name, and a node:test focused run. I add 4 scenarios that past blockers name; 3 of their cells have none (a computed load in a Vitest startup hook; the same-stat edit on Vitest and node:test). | read in source code |
| 2 | Shape | Yes. A scenario is abstract modules, an edit script and the expected outcome of each check after each step. A pack per runner renders it. What differs: paths, syntax, the full name of a check, how the adapter opens, where observed paths are kept, and documented gaps. | verified by experiment |
| 3 | Probe | 3 scenarios × 3 runners through `RunnerAdapter`: 8 PASS, 1 KNOWN (the Vitest computed `import()`, documented in 011 C12). The kit needs 2 preconditions the type does not state. | verified by experiment |
| 4 | Past defects | Of 26 blocker findings in 17 failed runner reviews, 5 fall to a runner-neutral scenario, 6 more if the pack also lists the runner's variants, and 15 do not (runner internals 5, core 8, harness 1, cost 1). Node:test wave 2: yes. Wave 2.5: only with a `--require` variant. Wave 2.6: only with a quoted `NODE_OPTIONS` variant. 007-29 (stale bytecode): yes, shown. | read in source code; 007-29 verified by experiment |
| 5 | Cost | Probe: 461 lines (driver 148, scenarios 93, packs 220: 52 to 57 per runner). A kit with all 14 scenarios: about 900 lines. A new runner writes one pack, about 120 lines. It would replace little: most of the 20,269 lines under `test/runners/` test runner internals. | verified by experiment (probe); the rest inferred |

## Findings

### 1. Inventory (read in source code, `f6320cd7e`)

Each cell names a test at the adapter level (A), or at the daemon or end-to-end level (D) when no adapter test exists. "core" means a runner-agnostic test with a fake adapter.

| Scenario | Vitest | node:test | pytest |
| --- | --- | --- | --- |
| 1. A source edit flips PASS to FAIL | A `test/runners/vitest/invalidation.test.ts:108`; D `test/e2e/transitions.test.ts:25` | D `test/integration/node-test.test.ts:203`, `test/e2e/node-test.test.ts:70` | A `test/runners/pytest/run/bytecode.test.ts:59`; D `test/e2e/pytest.test.ts:191` |
| 2. It recovers | D `test/e2e/transitions.test.ts:25` | D `test/e2e/node-test.test.ts:114` | D `test/e2e/pytest.test.ts:236` |
| 3. An edit two imports away re-runs the dependent file | A `affected.test.ts:5`, `:92` | A `adapter.test.ts:157` | A `graph/invalidate.test.ts:102`, `adapter.test.ts:184` |
| 4. A deleted test is retired | A `invalidation.test.ts:53` (unlisted); core `test/scheduler/runs.test.ts:191` | A `adapter.test.ts:217` | none at A; core only |
| 5. A file that fails to load | A `broken.test.ts:125`, `run.test.ts:57` | A `run-streams.test.ts:127` (syntax only) | A `run/report.test.ts:87`, `run/run.test.ts:115` |
| 6. An interrupted run leaves results unknown | A `run.test.ts:172`, `:197`; core `test/scheduler/runs.test.ts:65` | A `run/run.test.ts:149`, `:190`, `:208` | A `run/run.test.ts:151`, `:171` |
| 7. A duplicate test name | A `edge-cases.test.ts:44` | A `identity.test.ts:71`, `run-streams.test.ts:101`, `fixtures.test.ts:210` | none (pytest suffixes duplicate IDs itself, 007 spec line 60) |
| 8. A focused run | A `focused.test.ts:30` | none (no node:test runner sets `focuses`, `seams.md` F1.2) | A `focused.test.ts:134` |
| 9. An environment file change re-keys | A `invalidation.test.ts:90`, `affected.test.ts:30` | A `adapter-preload.test.ts:63` | A `adapter.test.ts:230`, `environment/hash.test.ts:236` |
| 10. A runtime read outside the static closure invalidates | A `observe.test.ts:23` (fs reads only) | A `adapter.test.ts:172`; D `integration/node-test.test.ts:203` | A `adapter.test.ts:127` |
| 11. A startup hook loads a module by a computed path (003 wave 2 B1, 007 wave 2 B5) | none (011 C12: not seen) | A `adapter-preload.test.ts:63`, `adapter-preload-require.test.ts:105`, `adapter-preload-quoted.test.ts` | A `adapter-session.test.ts:232` |
| 12. An installed dependency change re-keys (007 wave 2 B1, 003 wave 3 B1 and B2) | A `packages.test.ts:132` | A `packages.test.ts:105`; D `integration/node-test-packages.test.ts` | A `environment/hash.test.ts:63` |
| 13. An edit that keeps the size and the whole-second mtime (row 007-29) | none | none | A `run/bytecode.test.ts:59` |
| 14. A read one worktree observed keys another (007 wave 2.5 R1) | core `src/core/scheduler/observed.ts` path | A `adapter-observed.test.ts:25` | partial in `adapter-session.test.ts` |

Paths without a directory are under `test/runners/<runner>/`. Scenarios 11 to 14 are my additions: each is the general form of a blocker or a defect row on one runner. In every row, each runner's test has its own fixture, its own words and its own helper. The validity corpus (`test/keys/validity/cases/adapter/`) already drives the Vitest and pytest adapters over fixture files. It has one input type per runner (`VitestInput`, `PytestInput` in `case.ts`) and no node:test kind.

### 2. Shape (verified by experiment)

One scenario can be stated once. `probes/runner-kit/scenarios.ts` uses 5 module kinds (`value`, `reexport`, `test`, `computed`, `broken`) and 3 step kinds: edit and then `invalidate` and `affected`; run and expect each check's outcome; and a closure check that the file holds a module, or lacks it. The same in every runner:

- the edit script and the expected outcome per step (pass, fail, file-error);
- the reach rule: after an edit, the test file is in `affected`, or the path is in `closure()` or in what the last run observed;
- the precondition of a computed-import scenario: the static closure lacks the module before the first run. Without it, the scenario proves nothing.

What differs, all in the pack (52 to 57 lines each):

- paths and syntax (`src/x.ts` and `expect().toBe()`; `src/x.mjs` and `assert.equal`; `app/x.py` and `assert`);
- the full name of a check (`chain` and `test_chain`);
- project files (`vitest.config.ts`; `package.json`; `pyproject.toml` with `pythonpath`);
- how the adapter opens. node:test and pytest need an `ObservedStore`, and the two shapes differ: `readPreloads`/`writePreloads` against `readSession`/`writeSession`. pytest needs a Python environment;
- where observed paths are kept. Vitest returns them in `RunReport.observed`. node:test and pytest write them through the injected store. A uniform assertion needs an accessor per pack. This is `seams.md` F1.2 seen from the test side;
- documented gaps, cited to the spec (`known` in `packs.ts`).

### 3. Probe (verified by experiment, `probes/runner-kit/output.txt`)

| Scenario | Vitest | node:test | pytest |
| --- | --- | --- | --- |
| flip, recover, two hops, a file that fails to load (brief 1 to 3 and 5) | PASS | PASS | PASS |
| computed `import()` in a test (brief 10) | KNOWN | PASS | PASS |
| same-stat edit (row 007-29) | PASS | PASS | PASS |

- **Vitest, computed import.** The static closure lacks `src/hidden.ts` before the run, as it should. After the run, neither `closure()` nor `RunReport.observed` holds it: observed holds only the snapshot path. In a daemon, an edit of `hidden.ts` would therefore not re-run `loads.test.ts`. This is documented: 011 C12, observed runtime inputs, lists "a computed `import()` Vite loads" under "Not seen, and left to `inputs`" (`docs/specifications/011-core/spec.md:337`). The kit found the gap without being told. The pack now declares it, so it reads KNOWN. The validity case `test/computed.test.ts` (`cases/adapter/vitest.ts:44`) checks the touched-path withhold for the same pattern, not the closure.
- **Unstated precondition 1: a fresh `logDir` per run.** My first run gave one directory to every run. The pytest adapter appends `events-<i>.jsonl` there and reads it back (`src/runners/pytest/run/run.ts:186`), so it read the first run's pass after a failing edit. Its stdout showed `assert 2 == 1`, but the report said `pass`. The daemon gives `join(runsDir, runId)` (`src/core/scheduler/tiers.ts:476`), so the product is not affected. The type says only "Where the adapter writes full runner output" (`src/core/types/runner.ts:218`). `output-shared-logs.txt` reproduces it. Vitest and node:test passed with a shared directory.
- **Unstated precondition 2: the observed store.** Without a store, node:test and pytest keep observations "only as long as the adapter" (`adapter.ts` option comments). The kit has to give an in-memory store that merges per test file, as the daemon does.
- **Row 007-29 discriminates.** The same-stat scenario passes on all three runners at HEAD. By hand, with one `PYTHONPYCACHEPREFIX` shared by two runs (the behaviour before 007-29), the same-size edit with the same mtime gave `1 passed`. A fresh prefix gave `1 failed`. Step 2 of the scenario expects fail, so it would have caught the defect. It costs Vitest and node:test nothing to meet it, and they had no test for it.

What each runner needed: Vitest needed a `node_modules` that resolves `vitest/node` from the fixture root (a link) and `observe: () => true`. node:test needed `process.execPath`, an include glob and the store. pytest needed a declared environment (an absolute `python`), a `cacheDir`, a `tempDir` and the store.

### 4. Past defects (read in source code, `docs/specifications/{003,007,013}-*/reviews/`)

17 runner reviews failed (003: 6 of 9; 007: 10 of 14; 013: 1 of 1). They hold 26 blocker findings:

| Class | n | Findings |
| --- | --- | --- |
| A runner-neutral scenario catches it | 5 | 003 wave 2 B1 (scenario 11); 007 wave 2 B5 (11); 007 wave 2 B1 (12); 007 wave 2.5 R1 (14, two adapters sharing a store); 007 wave 2 B3, a module-level skip drops parametrized identities (a "file that skips itself keeps its known checks" scenario, for Vitest and pytest) |
| A scenario catches it if the pack lists the runner's variants | 6 | 003 wave 2.5 B1 (`--require` preloads); 003 wave 2.6 B1 (quoted `NODE_OPTIONS`); 003 wave 3 B1 (`#` aliases) and B2 (unnamed loads); 007 wave 1 B1 (an ancestor config); 007 wave 1 B2 (prepend-mode basedir layout) |
| Runner internals | 5 | 007 wave 1 B3 (editable through a symlink); 007 wave 2 B2 (admission's one second); 007 wave 4 B1 and wave 4.5 B1 (basetemp scrubbing of a diagnostic); 013 0.1.250 B1 (a closed instance's memory) |
| Core logic | 8 | 003 wave 4 B1, wave 4.5 B1 (growth attribution); 007 wave 3 007-30 B1, 007-32 B1 (withhold count); 007 wave 4 B2 (note dedupe); 007 waves 5.5, 5.75, 5.875 B1 (attribution after policy loss) |
| Harness | 1 | 007 wave 2 B4 (deny resolution) |
| Cost | 1 | 007 wave 2.5 R2 (idle work) |

Classification is inferred from each finding's text. The brief's three cases:

- **node:test wave 2** (a computed `import()` in a preload never entered a key): yes. Scenario 11 is stated once; the node:test pack renders the hook as a preload. pytest's wave 2 B5 is the same scenario as a `-p` plugin, a week later. One scenario would have caught both.
- **wave 2.5** (`--require` preloads run before an `--import` recorder): only if the node:test pack runs scenario 11 once per preload form. A runner author must know that the forms exist.
- **wave 2.6** (a quoted `--require` in `NODE_OPTIONS`): only with that variant too. `ecosystem-adoption.md` finding 5 calls both 2.5 and 2.6 "quoted `NODE_OPTIONS`". The review files say 2.5 is the `--require` order and 2.6 the quoting.

The kit gives the slot; the variants are runner knowledge. A third-party author who does not know them is caught only by the scenario's plain form. Also caught outside the reviews: row 007-29 (board line 596, "found by 007-17"), shown above.

### 5. Cost (probe verified by experiment; estimates inferred)

- **Probe:** 461 lines. The driver is 148 and holds no runner name. Three scenarios take 93 lines (about 20 each). Packs take 220: Vitest 53, node:test 57, pytest 52, and 58 shared.
- **Full kit (14 scenarios):** about 280 scenario lines. The driver grows to about 300, adding cancel, focus, delete, install and two-adapter steps. Each pack grows to about 120 lines, adding module kinds for a startup hook, a config, an install, a duplicate and a skip. Total about 900 lines for three runners.
- **What a new runner writes:** one pack. Paths and text for each module kind, project files, `open`, an accessor for observed paths, the full-name mapping, and its documented gaps. For a runner outside Node, `open` also has to start its process. Today that means a `RunnerAdapter` in TypeScript.
- **What it replaces:** little, at first. Most of the 20,269 lines under `test/runners/` test internals the kit cannot state: graph parsing, environment admission, stream parsing, cost. The overlap is the adapter-level scenario tests in the inventory. It is part of `vitest/invalidation.test.ts` (123), `affected.test.ts` (119), `node-test/adapter.test.ts` (269), `pytest/adapter.test.ts` (277) and `pytest/run/run.test.ts` (433). From the file names and test titles, perhaps a third of these 1,221 lines restate a kit scenario. The integration and end-to-end tests (`integration/node-test.test.ts` 301, `integration/pytest.test.ts` 222, `e2e/*` per runner) test the daemon and the harness too, and stay. The validity harness has two per-runner adapter kinds (`harness/vitest.ts` 189, `harness/pytest.ts` 248), and a pack could feed both. Merging them is a separate decision, because the corpus compares two git trees.

## Recommendation for Squeal

1. **Build the kit as packs over runner-neutral scenarios, at the `RunnerAdapter` level** (findings 2, 3). The shape works for all three runners with 52 to 57 lines per pack. It needs no daemon, so it is cheap per edit and fits Squeal's own suite.
2. **Start with scenarios 1, 3, 5, 10, 11, 12 and 13** (findings 1, 4). They cover 5 of the 26 blockers directly and 6 more with variants. Scenario 13 shows the value best: a defect found on one runner becomes a check on all of them for about 20 lines.
3. **Give each pack a list of documented gaps cited to the spec, and a variants list** (findings 3, 4). The Vitest computed-import gap shows that a uniform expectation makes per-runner limits visible. Variants are where runner knowledge lives (preload forms, `NODE_OPTIONS` quoting, layouts). An `UNEXPECTED PASS` verdict tells the author to remove a gap that has closed.
4. **Write the adapter's preconditions into the contract before outsiders use it** (finding 3): a fresh `logDir` per run, and the observed store and its merge rule. Better still, return observed paths in `RunReport` for every runner (`seams.md` F1.2). Then the kit needs no accessor per pack.
5. **Do not count on the kit for core, harness or cost defects** (finding 4). It touches 11 of 26 blockers. The other 15 need the scheduler and delivery tests that exist today.

## Open questions

1. Should the kit also run through a scratch daemon, so that transitions, retirement and unknown are checked end to end? Here the kit checks adapter outcomes only. Retirement and unknown are core rules. Owner: the 016 coordinator.
2. Can the kit share its fixtures with the validity corpus, which compares keys across two git trees? Not tried.
3. How should the kit pin timing-dependent scenarios (interrupt, same second) without the host's load? The probe pinned 007-29 by setting the mtime with `utimes`. The validity corpus holds a run inside a test file with markers (`test/keys/validity/cases/adapter/vitest.ts:20`, `harness/vitest.ts`). Not tried in the kit.
4. Classification of findings 4 is my reading of each finding's text. `defect-causes.md` (016-09) sorts the same reviews independently. I did not read it.

## Sources

- `src/core/types/runner.ts:200-340`; `src/runners/{vitest/index.ts,node-test/adapter.ts,pytest/adapter.ts}`; `src/runners/pytest/run/{run.ts:186,bytecode.ts}`; `src/core/scheduler/{tiers.ts:476,observed.ts}`; `src/runners/vitest/dynamic.ts`, at `f6320cd7e`.
- `docs/specifications/011-core/spec.md` C3, C4, C5, C12 (line 337), C14; `docs/specifications/007-pytest-runner/spec.md:60`; `docs/board.md:596`.
- Reviews: `docs/specifications/003-node-test-runner/reviews/wave-{1,2,2.5,2.6,2.7,3,3.5,4,4.5}.md`; `docs/specifications/007-pytest-runner/reviews/*.md` (14 files); `docs/specifications/013-vitest-runner/reviews/0.1.250.md`.
- Tests: `test/runners/{vitest,node-test,pytest}/`, `test/integration/`, `test/e2e/`, `test/scheduler/runs.test.ts`, `test/keys/validity/{case.ts,harness/,cases/adapter/}`.
- `seams.md` F1.2, F5; `ecosystem-adoption.md` findings 4 and 5, recommendation 5.
- Probe: `probes/runner-kit/{scenarios.ts,packs.ts,kit.ts,output.txt,output-shared-logs.txt,README.md}`.
