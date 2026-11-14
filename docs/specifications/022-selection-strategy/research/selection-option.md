# Selection option: what reads the closure, and how other tools offer a choice

Researcher, row 022-02, 2026-11-14, 11:00Z to 12:30Z. Squeal source at `2856d26e8`. Store copies of this repository and cezar (cezar config at `4711d29b3`), taken 12:00Z with `VACUUM INTO` and deleted after the run. Outside tools: Kody `2b3a0035a` (PR #5108), Vitest `cab34bb` (5.1.0, npm `latest` since 2026-11-02), Jest `aa88f7c` (30.5.2), pytest-testmon `86d43f1` (2.3.0), Ekstazi `b6ee1f2` (5.3.0), and the Wallaby, Nx, Bazel and Develocity docs read 2026-11-14. Probes: `probes/selection-option/`. No test, daemon or build ran.

**Reading of the request.** It fits the coordinator's reading: a test file's key covers the modules its own process loaded in its last run, not its static import closure. Two other readings came up. Wallaby and testmon select per test, not per file. Kody, the human's reference, selects per test file, as read here. "Run the tests that load module X" is not a separate mode in any tool examined: Kody, Vitest 5.1 and Ekstazi all answer it from the same per-file record.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Readers of the closure | 15 readers (table in 1). Five change meaning: the result key, the stability check, the reverse index (which keys an edit moves), named waits, and `reach`. Four would break: the shared `test_files` row, the CI import re-key, the code gate's store lookup, and status's single `closureMethod`. Mixing strategies in one store is sound, because a key covers the content of every path it names | read in source code; soundness of mixing inferred |
| 2 | Granularity | Per repository, with a fallback per project where no record can exist. cezar's per-project narrowing runs from 0% (e2e, contract) to 31% (server) of recorded files, but the e2e files lose nothing because declared inputs carry them. Per-test-file needs are already met by `inputs` (39 entries here, 35 in cezar) | verified by experiment (store copies); choice inferred |
| 3 | Prior art | Kody: env `KODY_PRE_PUSH_TEST_SELECTION=related`, default "observed", per invocation. Vitest 5.1: `experimental.recordDependencies`, default `false`, root config. Nx: `affected.legacy`. testmon, Ekstazi and Bazel offer no choice of method; Jest and Wallaby offer only baselines and tuning | read in source code / official docs |
| 4 | Cost of a switch | Not a full re-run if the loaded-set key keeps the inputs a loaded set cannot see and adds no strategy marker: 85% of recorded test files here and 75% in cezar would key over the same path set. No key-format raise if default keys stay bit-identical. A new `method` value in the shared `test_files` table would crash older daemons | verified by experiment (path sets); key and crash read in source code |

## 1. Every reader of the closure, and what changes

The closure is assembled once (`src/core/keys/closure.ts` `assembleClosure`, `method: "static imports plus declared inputs"`). It is stored per `(project, path)` in `test_files`, shared by every worktree, newest writer wins (`src/core/store/repos/test-files.ts`, `scheduler/revision.ts` `storeClosures`). It is kept per worktree in `KeyIndex` and its `ReverseIndex` (`key-index.ts:186`). All *read in source code*.

| Reader | Uses the closure for | If the closure is the loaded set |
|---|---|---|
| Result key, 011 C3 (`check-key.ts` `keyFromSegments`) | `(path, blob)` of every closure path | Fewer test files re-key per edit. This is the saving. The key must still hold what a loaded set cannot see: declared inputs, observed reads and child-process modules, the snapshot path, unresolved-import candidates, glob expansions. Setup and config stay in the environment hash |
| Store after a run, 011 C4 ("stored under the key that includes what it read") | The run's observed paths join the key before storing | The run's own loaded set (its coverage record) gives the key it is stored under, as observed paths do today. The rule that discards a run whose observed path was first hashed after the run began applies to a newly loaded module too |
| Stability check after a tier, C4 | Re-stats every closure path | An edit during the run to an import the run did not load no longer discards the result. This is consistent with the strategy |
| Reverse index and re-key, C4 steps 1 and 2 (`key-index.ts:212` `rekey`, `resolution.ts` `closuresToReresolve`) | Which keys an edit moves; which closures to re-resolve when files are added or deleted | Fewer moved keys. Re-resolution reaches only directories of loaded files, so the unresolved candidates of loaded modules must stay in the key |
| Edit cut and catch-up, C4 step 4 (`edit-cut.ts`, `fetchEditCut`) | `runner.affected()`, the static Vitest `related` walk, ranks direct and transitive importers | A file that `affected` names but whose key did not move finds its result, so there is no run. A file that only a runtime edge reaches is re-keyed but ranks as catch-up. Kody saw 114 such workers tests against 8 from `related` for one file. Ranking would need direct loaders from the record |
| Named waits (`src/cli/named-selection.ts:74-127`) | A source path selects its readers: the daemon's reverse index, else every shared `test_files` row (`:175`) | `squeal status src/x.ts` names the tests that loaded `x` in their last run. A source that is imported but was never loaded becomes `unmatched`. `list()` throws on a row with another method |
| `squeal reach`, 015 D11 (`src/core/reach/read.ts`, `pairs.ts`) | One pair per closure path; it already labels each path called, loaded only, or not loaded from coverage | The "not loaded" pairs leave the re-key count: they are the waste reach exists to show. `test_file_imports` rows stay "written with the closure the key was set from" only if keyed by the new key |
| Code gate, 020 (`gate/collect.ts:301`, `gate/evidence.ts`, `gate/stored.ts:293`, `crap/loaders.ts`) | Selection from `adapter.affected` (static); loads from `adapter.closure`; evidence from the stores at `keys.index.key(ref)` | It must key exactly as the daemon does, or every stored lookup misses. Fewer loaders per source make more sources `no-loader` |
| Delivery (`delivery/attribution.ts:111`, `uncovered.ts`) | The edits shown beside a failure; the edited paths no test reads | It attributes fewer edits (an edit that made the test load a new file is in no set yet) and reports more paths as uncovered |
| Commit match (`commit/compute.ts:221`) | Whether a commit's tree matches a key | Fewer paths are compared. This stays sound when the key uses the same set |
| CI import, 018 D11 (`transfer-rows.ts:98`, `transfer-rekey.ts:109`) | Imports closure rows only of the one method. It re-keys a result only when the local closure holds every exported input | A loaded-set export is imported with no closure row. A static export re-keys into a loaded worktree only when the local loaded set holds the exported static list, which is rarely. So CI results stop reaching loaded-set worktrees |
| Import status (`status/imports.ts:184`) | `staticListHash` of the exported and local lists | Every comparison would read "closure differs" |
| Remote lane, 021 (`runner-host/remote/lane.ts:210`) | Blobs the remote proves equal before a run | Fewer blobs are proven. A run that newly loads a file reads bytes nobody checked |
| Status (`status/snapshot.ts:197`) | One constant `closureMethod` per payload | It becomes per project or per file |
| Lint, 017 (`lint/pass/keys.ts`) | Its own config closure, with the method as a literal | Only the type changes |

**The shared store, 011 C7.** `test_files.method` accepts one value. `oneOf` throws `squeal store: method has unexpected value` (`store/codec.ts:44`). The readers that would throw are bootstrap (`scheduler/bootstrap.ts:152`), named selection, delivery, head move, the import paths and import status. An older daemon that shares the store with a newer one would crash on the first loaded-set row. The store's own precedent avoids this: additive tables made at open, with no `user_version` raise (`store/imports.ts` `IMPORT_TABLES`, `code/store/schema.ts` `CODE_TABLES`). Raising `SCHEMA_VERSION` instead makes older daemons refuse the store as `"newer-schema"` (`store/open.ts:144`). *read in source code.*

**Where a loaded set already exists.** Each coverage record is stored in `code.sqlite` `coverage` at the result key, with per-source paths and blob ids (`code/coverage/types.ts`). It is shared by every worktree. The probe read the newest record of 1,830 of 2,069 test files here and of 2,010 of 2,449 in cezar. A record is not yet a loaded set:

- It leaves out `coverage.exclude` paths. That is 51,019 closure-path entries here (the `test/**` helpers, loaded but unrecorded) and 6,155 in cezar.
- It exists only for files that ran whole, with coverage on, under Vitest or node:test. pytest has none (`reach/read.ts:74`).
- It does not exist in a single-process project (Vitest `isolate: false`, node `--test-isolation=none`; `runners/node-test/coverage.ts`).
- In cezar, 5 records lack the test file itself. Kody leaves such a file unmapped and always runs it.

*verified by experiment* (`probes/selection-option/*-summary.json`).

**Mixing strategies is sound.** A key covers `(path, blob)` of every path it names. A hit therefore means a stored run saw exactly that content on exactly those paths. A static worktree only hits a loaded-set result when the two path sets are equal, and then its own assumption holds. A loaded-set worktree that hits a static result takes a run that saw at least what it requires. The risk stays where the strategy puts it: an edit to a path the set omits. This also covers rows from other worktrees. A loaded set recorded on another branch can only cost runs, never a false current. *inferred* from C3 and C4.

## 2. Granularity

*verified by experiment* on the store copies. "Narrowed" means a closure path is a code module that the record lacks. Declared inputs, observed reads, snapshots, coverage-excluded paths and non-code files are kept.

| Project | Files with a record | Narrowed | Note |
|---|---|---|---|
| squeal (one project) | 1,830 of 2,069 | 281 (15%) | The other 1,549 key over the same path set |
| cezar `server` | 1,305 of 1,674 | 405 (31%) | |
| cezar `web` | 394 of 412 | 75 (19%) | |
| cezar `root:test:unit` (node:test) | 148 of 171 | 13 (9%) | |
| cezar `contract`, `api-client` | 33 of 33 | 0 | |
| cezar `e2e` (group `browser`, `at: manual`) | 101 of 114 | 0 | Closure 353,519 path entries, record 5,811. The tests drive a built app, so declared inputs carry all of the key |
| cezar `test:package` | 0 of 13 | n/a | No record: these files fall back |

Evidence for each level:

- **Per repository.** Nothing in either config needs two strategies. Every project that narrows gains, and a project that cannot narrow (e2e, contract) is unchanged as long as declared inputs stay in the key.
- **Per runner or project.** This is forced by fact, not by choice: pytest and single-process projects have no per-file record. Those files fall back per file, as Kody's unmapped files and Vitest's "a test file without a record always runs" do.
- **Per group (019).** cezar's two groups set a moment and limits. No evidence asks for a selection rule per group.
- **Per test file.** The need is already met by `inputs`: 39 entries here and 35 in cezar. They name tests that read sources as data, such as lint rules, plugin bundles and contract boundaries. These must stay in the key under either strategy.

## 3. Prior art

**Kody, the main reference** (*read in source code*: PR #5108 body; `tools/test-module-map.ts`, `vitest-related-observed.ts`, `vitest-module-map-setup.ts`, `vitest-module-map-reporter.ts` at `2b3a0035a`):

- **The option.** `KODY_PRE_PUSH_TEST_SELECTION=related` forces `vitest related`. The only value read is `related`. The default is "observed", and `related` is also the fallback when there is no map (no authenticated `gh`, nothing cached). It applies per invocation of the pre-push hook. CI still runs every test.
- **The record.** A setup file, loaded only when `KODY_TEST_MODULE_MAP_OUT` is set, reads `__vitest_worker__.evaluatedModules.idToModuleMap` after each test and in `afterAll`, because "`vi.resetModules()` clears the runner's module graph". It keeps the nodes with `evaluated !== false`. The reporter drops `node_modules` and paths outside the root. A test whose own path is missing from its set is left unmapped ("the graph was lost").
- **Where the map lives.** One JSON per CI shard, uploaded as artifact `test-module-map-<project>-<shard>` (7 days). It holds `version: 1`, `commit`, the tested `tree`, `shard {index, count}`, `modules[]`, `hashes[]` (git blob of each module, `null` when absent) and `projects{project: {test: [module index]}}`.
- **Which map.** From the 10 newest same-repository runs it picks the newest map whose tree is in the last 2,000 local commits. Otherwise it takes the newest map, and `main` changes since the branch point count as changed.
- **Shard completeness.** "A project is kept only when every one of its shards is present, so a test is never mistaken for one that loads nothing". All shards must share one commit and version 1.
- **Forks.** Artifacts must satisfy `head_repository_id == repository_id`: "a fork could upload a map that skips tests".
- **Selection.** Changed modules are the mapped modules whose current blob differs, or that were deleted, plus the pushed paths. It runs the tests that loaded a changed module, plus the tests the map has not seen. Its safety argument: "any new import edge lives in a module it already loaded, and that module changed."
- **Setup files.** They "are not import edges", so on the `related` fallback a pushed `packages/worker/src/test-support/` path runs the whole project. Under the observed map, setup files are in every test's set.
- **What it does not record.** File reads, child processes, environment variables and test outcomes: `selectObservedTests` reads only sets and hashes.
- **Effect.** PR #5108 reports one capability file at 16 node-unit tests where `related` gave 923, and 18 files in 24 s where #5062 reported 626 s.

**Other tools** (from a helper's survey; Vitest re-read by the researcher):

| Tool | Choice of method? | Option, default, scope | No or stale record | Switch or upgrade |
|---|---|---|---|---|
| Vitest 5.1 | Yes: static transform graph vs recorded loads | `experimental.recordDependencies`, `false`, root config for every project; `--since-last-run` turns it on with `mtime` | "A test file without a record ... always runs". Config, `.env` and `globalSetup` changes run the whole project. A `vi.mock` factory's imports are not recorded; `fs` reads and externalized imports are not recorded | Records in `dependencies.json` (paths and run time, no content hash), `DEPENDENCIES_VERSION = 2`. A mismatch is ignored, so the next run is full |
| Nx | Yes: task-based vs project-based | `affected.legacy` / `NX_LEGACY_AFFECTED`, `false`; `nx migrate` sets `true` in existing workspaces | Declared graph only | Not found in the docs read |
| pytest-testmon | Modes only; always coverage | `--testmon`, `-noselect`, `-nocollect`, `-forceselect`, `--testmon-env`; per invocation | New database: everything runs | `DATA_VERSION` mismatch deletes the database. A package change re-runs everything |
| Ekstazi | No; runtime-loaded files per test class | `forceall`, `forcefailing`, `dependencies.nio` | "Test is affected if hash of any resource does not match": no data, run | Config changes are not detected in the source |
| Jest | Baseline only; static regex graph | `-o`, `--changedSince`, `--findRelatedTests`; a custom `dependencyExtractor` | n/a | The haste map is keyed by the Jest version |
| Wallaby | Tuning only | `ignoreFileLoadingDependencyTracking`, `runAllTestsWhenNoAffectedTests` | Cached results are re-verified in the background | Not documented |
| Bazel | No; declared target deps | `--cache_test_results=auto` | n/a | Not found |

What users report: misses when a dependency is not an import (`jestjs/jest#14724`, `wallabyjs/public#1322`, `tarpas/pytest-testmon#228`). The static graph over-selects (Kody #4995 and #5062, `nrwl/nx#35797`). The recorded mode re-runs too often (`vitest-dev/vitest#11863`). And the record goes stale after a commit that adds an import: Vitest's warning, and `gliga/ekstazi#39`.

**Kody mapped onto Squeal** (*inferred* from the code read above):

| Kody | Squeal today | Gap |
|---|---|---|
| A changed module is a blob that differs from the map's | C3: a key over `(path, blob)`; C4: current is an equal key | None. A key over the loaded set is Kody's test |
| One map per CI run, chosen by tree in local history | One coverage record per result key, shared by every worktree (C7). Keys ignore commits (ADR 0002) | No tree is needed. Each result carries its own set |
| An unmapped test always runs | Not built. A file with no record must key by its static closure | A fallback per file |
| A test whose set lacks itself is unmapped | 5 cezar records lack the test file | The same rule |
| Shard completeness per project | Records are per test file, so a missing shard cannot make a file "load nothing" | n/a |
| Setup files are "not import edges" | The setup and config closure is in each project's environment hash (C3) | None; keep it |
| Fork refusal | 018 D14: only exports on the default branch's first-parent line. D16: trust is repository write access. D6: "the local daemon computes every key" | A set taken from CI would let the exporter shrink a local key. D11's rule "may add inputs, never drop one" blocks this today |
| Artifacts carry the map to developers | 018 bundles carry `closure {paths, method}` and `observedModules`, but D15 says imported files have no coverage record. 020 D13 CI parts do carry coverage records | A carrier exists in parts, not in bundles. Trusting a CI set would relax D6 and D11 |

## 4. The cost of a switch

- **Precedent.** Toggling `observe.runtimeInputs` changes the adapter version (`vitest/observe.ts` `adapterVersion`, `OBSERVED_ADAPTER_SUFFIX`), so every key of the project changes once. Turning coverage on or off changes the canonical config: node:test "recreates the project so its checks re-key once" (`runners/node-test/coverage.ts`). Vitest's own switch runs everything once, because no records exist. testmon deletes its database on a format change. *read in source code / official docs.*
- **Measured.** Suppose the loaded-set key keeps declared inputs, observed reads, snapshots, coverage-excluded paths and the environment hash, and adds no strategy marker. Then 1,549 of 1,830 recorded files here (85%) and 1,510 of 2,010 in cezar (75%) key over the same path set. Their keys do not move, so they do not re-run. The narrowed files get new keys: 281 here and 500 in cezar. Each misses once, unless their current results are also stored at the new key, which their records allow because a record holds each source's blob. Files with no record (239 here, 439 in cezar) keep today's key. *verified by experiment* for the path sets; the key equality is *inferred* from `keyFromSegments`. The stored list and the newest record are not from one run (`probes/selection-option/README.md`, caveats).
- **Key format.** `docs/process.md` and `key-format.ts`: `KEY_FORMAT_VERSION` moves only when a key this release computes "can find something an earlier release stored that this release would have stored or decided differently". If default-strategy keys stay bit-identical, and a loaded-set key can only find a run with equal content on equal paths (section 1), the rule asks for no raise. The alarm (`test/keys/key-format.test.ts`) still fires on any change to the validity path's code and decides by its corpus. A strategy marker inside the key would force one re-run of every file that switches, and still no raise. *read in source code; outcome inferred.*
- **Not free.** A new value in `test_files.method` crashes older daemons that share the store (section 1). An additive table avoids it. CI-imported results stop reaching narrowed files unless CI exports loaded sets (section 1, CI import).

## Recommendation

**Inferred:**

- Offer the loaded set as a repository-level policy choice. Follow Kody and Vitest: "observed" selection, falling back per test file to today's static closure when there is no trustworthy record (none, a partial run, a record without the test file itself, pytest, a single-process project).
- Build it as a narrower key, not as a skip. Keep in the key everything a loaded set cannot see (declared inputs, observed reads, child-process modules, the snapshot, unresolved candidates, glob expansions) and keep the setup and config closure in the environment hash. Then 75 to 85% of recorded files keep their key at the switch, and no key-format raise follows.
- Store the per-file loaded list in a new additive table, never as a new `test_files.method` value.
- Do not take sets from CI until the human relaxes 018 D6 and D11. Under those rules CI results reach only files whose key did not narrow.
- Record loads without `coverage.exclude` filtering, as Kody and Vitest do with the module runner. Today's records omit loaded test helpers.

Savings, misses and soundness are the sibling `loaded-modules.md`'s questions. Edit-reach says 41% of re-run seconds here load the edited file and call nothing. A module-level key cannot remove those.

## Open questions for the human

1. Should a narrowed file whose current result is recorded keep that result at its new key at the switch, or run once?
2. May a loaded set come from CI (relaxing 018 D6 and D11), or only from local runs?
3. Should `squeal status <source>` name loaders of the last run, as Kody does, or keep today's importers?

## Sources

- Squeal `2856d26e8`: `src/core/keys/{closure,check-key,key-format,key-index,reverse-index,resolution}.ts`, `src/core/scheduler/{keying,edit-cut,revision,bootstrap}.ts`, `src/core/store/{schema,codec,open,transfer-rows,transfer-rekey,transfer-import,transfer-bundle}.ts`, `src/core/store/repos/test-files.ts`, `src/cli/named-selection.ts`, `src/core/reach/{read,pairs}.ts`, `src/core/code/gate/{collect,stored,evidence}.ts`, `src/core/code/store/schema.ts`, `src/core/code/coverage/{record,parts,runtime}.ts`, `src/core/delivery/{attribution,uncovered}.ts`, `src/core/commit/compute.ts`, `src/core/runner-host/remote/lane.ts`, `src/runners/vitest/{affected,observe,environment}.ts`, `src/runners/node-test/coverage.ts`; specs 011 C3, C4, C7; 018 D6, D11, D14 to D16; `docs/process.md`.
- Kody: https://github.com/kody-hq/kody/pull/5108, files at `2b3a0035ad1cfb70e1cba7588d7a9938c8a1160a`.
- Vitest 5.1.0: https://github.com/vitest-dev/vitest/blob/cab34bb0ee23f00676ea895560c8b16399ce40b7/docs/config/experimental.md (recordDependencies), `packages/vitest/src/node/recorded-modules.ts`, `cache/dependencies.ts`.
- Nx: https://nx.dev/docs/features/ci-features/affected. testmon: https://www.testmon.org/, `testmon/db.py` at `86d43f1`. Ekstazi: `gliga/ekstazi` at `b6ee1f2`. Jest: `jestjs/jest` at `aa88f7c`, https://jestjs.io/docs/cli. Wallaby: https://wallabyjs.com/docs/config/overview/. Bazel: https://bazel.build/docs/user-manual.
- Notes: `~/projects/notes/projects/cezar/squeal-test-rerun-cost.md`. Earlier research: `../../015-coverage-complexity/research/{edit-reach,selection-tools}.md`.
- Probes: `probes/selection-option/` (README, `loaded-vs-closure.mts`, `extra-paths.mts`, two summaries).
