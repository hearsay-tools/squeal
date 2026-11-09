# 015-126: one quality gate for the daemon, pre-PR and CI (#167)

Researcher, 2026-11-09. Brief: `quality-gate-brief.md`. Squeal `fc58af3da` (0.1.422), Node v24.22.1, Vitest 5.0.3; cezar `7b726e2a2` (read only). Probes: `probes/quality-gate/` (throwaway; scratch clone under `/tmp/qg` with `HOME`, `XDG_*` and `TMPDIR` there; no daemon, no store, no agent session; `/tmp/qg` deleted afterwards). One-minute load 9.7 to 21.3 during the runs; no probe was skipped. Test-run CPU used: about 12 CPU-minutes.

## Questions answered

| # | Answer | Tag |
|---|---|---|
| 1 | Yes. Squeal's Vitest and node:test adapters, provider, mapper, counter, join and score ran in one process with no daemon and no store, over 30 named test files. CPU +32% over plain `vitest run` (median of 5 pairs), +14% over `ci record`. | experiment |
| 2 | Each part would need one coverage record per completed test file, with provider and record versions. That needs Squeal's provider inside CI's Vitest, which conflicts with 018's "no provider in CI" and D8, and with a project's own `--coverage` run. A gate should read parts, not exports. | source; inferred |
| 3 | Count both ends of each changed file; match D2 identities; a body hash found at base is a move, not a change. Test files over CC 20: Squeal 3 of 29,689 functions, cezar 6 of 54,724. Counting all test files costs 4.6 s (Squeal) and 8.2 s (cezar) once; a PR's changed files cost about 8 ms per file version. | experiment |
| 4 | Complete = counted, every loader known, each loader's current record at the source's blob, join resolved, no failed test; a pass may be proven from a subset (D9's bound). Child coverage is visible to tests. In cezar's last 10 PRs, 14 of 314 changed functions (4.5%) run only in a child; 4 of them have CC 9 to 20. | experiment; inferred |
| 5 | 6 works, 3 gaps, 1 not applicable (table in Q5). | experiment |
| 6 | cezar: a live `baseline-growth` label read by trusted base-commit CI code; inherited deferrals are a manual issue process. Proposed boundary: the consumer gives verified exception records; Squeal checks evidence and applies the policy. | source; inferred |
| 7 | Stamps: `COUNTER_VERSION` 3, `COVERAGE_PROVIDER_VERSION` 3, `COVERAGE_RECORD_VERSION` 4, `KEY_FORMAT_VERSION` 21, part format 3. No policy or gate-report version. CI can pin the tag commit or the release's runtime asset by SHA-256. | experiment; source |
| 8 | First slice: a local one-shot gate, in-process coverage only, 5 rows. Then daemon parity, CI evidence, exceptions, child coverage. | inferred |

## Findings

### Q1. One-shot collection

**What exists** (read in source code). `ci record` (`src/cli/ci.ts`, `src/runners/vitest/ci-record.ts`, `ci-runtime/*.cjs`) runs the project's own Vitest with no daemon and no store, and writes outcomes and read evidence; no coverage, Vitest only. `squeal run` (`src/cli/run.ts`) asks the daemon (`askDaemon`). The code pass (`src/core/code/pass/*`, `crap/*`) needs the code store and judges against session state. `ci export` builds a Vitest adapter with no daemon (`src/cli/ci-export.ts`, `daemonVitest`). The pure parts are `countFile` (`count/index.ts`), `mapHere`/`ownRecord` (`coverage/mapper.ts`, `own.ts`), `joinCoverage` (`crap/join.ts`) and `crapScore` (`crap/score.ts`).

**It composes** (verified by experiment, `one-shot.mts`). `createVitestAdapter` with Squeal's provider ran 30 test files; 30 records; 410 loaded `src/` files counted and joined, 5,145 functions. The test files are sources of their own records, so test callbacks join and score (2 test files: all 27 functions of the 3 `test/` sources ran). Payloads must be mapped before `adapter.close()`, which deletes them.

**Missing** (inferred from the code read): a changed-function inventory against a base; a loader list built from `adapter.closure()` instead of the store's key index (`crap/loaders.ts` reads the store); one deadline over several adapter runs; the evaluator and report; counting test files; "no loader" as unknown.

**Cost** (verified by experiment, `timing.out.tsv`, `--maxWorkers=4`, CPU = user + system with children):

| Mode | Wall (median) | CPU (median) | CPU against plain, per pair | Load |
|---|---|---|---|---|
| plain `vitest run` | 8.4 s | 28.8 s | 1.00 | 11.9 to 19.4 |
| `ci record` (bundle) | 9.6 s | 31.8 s | 1.04 to 1.29, median 1.19 | 12.1 to 21.3 |
| one-shot probe (tsx, sources) | 12.0 s | 37.9 s | 1.23 to 1.40, median 1.32 | 12.6 to 21.1 |

The one-shot includes tsx compiling Squeal's sources, mapping (0.61 to 0.77 s) and joining all 410 sources (0.85 to 0.99 s). A gate joins only changed files, and a bundle compiles nothing, so +32% is an upper bound for this sample (inferred). 015's measured provider cost is +8% CPU.

### Q2. Reading CI's own run

**What a part would carry** (read in source code, `core/ci/parts.ts`, `coverage/record.ts`): per completed test file, the `CoverageRecord` (per source: path, blob, line and covered bitsets, function hit entries), the provider and record versions, and the format raised to `squeal-ci-part/4`. 015 D8 measured about 26.7 KiB per test file as stored.

**What it takes** (read in source code; inferred where marked). Mapping needs the run's Vite transform results (`coveredFiles` reads each environment's module graph), so it must happen in the Vitest process, inside the `ci record` hook. The hook is CommonJS with built-ins only; the mapper is not in it today. Vitest takes one coverage provider per instance: with Squeal's provider, a project's own `--coverage.enabled` report (cezar's `vitest-coverage-<sha>` artifact) is gone (inferred from Vitest's single `coverage.provider` option; not run).

**Conflicts.** 018 first slice, Non-goals: "Coverage records... Imported results carry none." 018 second slice, Non-goals: "Squeal's coverage provider in CI"; D8: "No coverage provider is added"; D10 tolerates coverage options because "CI runs without Squeal's provider". A gate also needs failures, and exports carry passes and skips only. Reading parts directly (they hold every outcome) avoids the export non-goals; the provider non-goal still has to be reversed.

### Q3. Changed functions against a base

**Mapping** (verified by experiment, `changed.mts`, 10 last first-parent commits of cezar main): 1,379 head functions in 41 changed files: 1,019 unchanged, 66 edited, 248 added, 34 moved (same body hash at base, new identity: D2's move, so not changed), 12 shifted. "Shifted" means an occurrence index moved because a same-named function was added before it: D2 reads it as an edit of a function whose body did not change. All 12 are anonymous callbacks in test files, 9 of them `<describe>.<it>.<waitForValue>` in one browser spec (`shifted` in `cezar-changed.out.json`). Matching by body hash inside one `(path, qualified name)` group removes them. A function moved and edited reads as added; the gate then measures it, which is the safe side. Gated: 314 functions, 211 (67%) in test files. Squeal's last 30 commits: 191 gated, 81 (42%) in test files. None of the 505 was over CC 20.

**Test files** (verified by experiment, `count-all.mts`): Squeal 3 of 29,689 test-file functions over 20 (1,724 files; CC 33, 25, 24); cezar 6 of 54,724 (1,842 files; 5 are `serve.<fn>` handlers in `packages/web` tests, CC 23 to 49). Counting every test file costs 4.6 s (2.7 ms a file) here and 8.2 s (4.5 ms a file) in cezar, about as much as the other files. A gate counts only changed files: 69 file versions took 0.55 s.

### Q4. Complete evidence

**Definition** (inferred, from D9 and the experiments). A changed function at head blob B has complete evidence when:

1. its file at B is counted at the current counter version, under `maxFileBytes`, and the function is outside every parse-error range;
2. its loader set is known: each selected test file's closure is known, and at least one test file loads the source. No loader is unknown, never 0% (today `fileCondition([], true)` is ready and the join gives `coverage: 0`; `orphan` at CC 3 read CRAP 12 in `cases.mts`);
3. each loader has a record from a run that completed the file whole, at the current provider and record versions, with the source at blob B and not `unread`. An older blob is stale and is not evidence;
4. the join resolves the function (`ran` is not `null`);
5. no selected test failed. A failed test blocks the verdict whatever the records say.

A **pass** may come from a subset of loaders, by D9's "pass proven early" bound: every own line counts, so the CRAP from records in hand is an upper bound. A **violation** needs every loader's record. Otherwise the result is incomplete.

**Child processes.** Visible (verified by experiment, `child.mts`): Node passes `NODE_V8_COVERAGE` to a child only from the parent's `process.env`, so the test sees it (`visible.json` held the directory). A child spawned with an explicit `env: { PATH }` still wrote coverage. The one test of this repository that failed on it now passes 9 of 9 with the variable set, because row 015-33 changed the test, not the mechanism. The one-shot gate does not change this: it is the same process tree. Mapping works with today's code: `ownRecord` mapped a tsx child through `source-map-cache` (`work`: ran, 50%, CRAP 4.13) and a plain `.mjs` child.

**cezar's last 10 PRs** (inferred, from `git grep` of each changed file's readers, not from a run): 14 of 314 changed functions (4.5%) are in scripts that tests only spawn (4 runner mocks under `packages/cezar/scripts/`, `scripts/release.mjs`, `scripts/release-snapshot.mjs`), in 2 PRs. 10 have CC 1 to 5, so CRAP at 0% is at most 30 and passes. 4 have CC 9, 16, 17 and 20: CRAP 90 to 420 at 0%, a false violation without child coverage or an unknown state. 20 more (6.4%) are in browser specs (`*.e2e.ts`), which the provider cannot measure: it takes coverage through `node:inspector` (`provider.mjs`; inferred, not run).

### Q5. Collection cases

Verified by experiment (`cases.mts`, `child.mts`) unless marked.

| Case | Verdict | Evidence |
|---|---|---|
| `x => (expr as T).field` | **gap** | V8 end column 47, counter 52 (the cast is removed): beyond the join's 2-column slack, `ran: null`. Unknown, never a false pass. |
| Curried arrow returning a call chain | **gap** | Two V8 functions and two counted functions end at one column; the outer joins, the inner reads `ran: null`. The `map`/`filter` callbacks join. |
| Three-stage multi-line arrow | **gap** (same cause) | Outer and middle join; the innermost reads `null`. |
| `vi.mock` factories | works | Expression factory and its `dep`, and an async block factory with `importOriginal` and its `hostname`: all ran, CRAP 1. |
| node:test `.ts` | works | Native type stripping and `--import tsx` both gave a record; `fromNode` 67%, CRAP 2.15; the test callback joined. |
| Mixed Vitest and node:test | works | Two records unioned: `fromVitest` and `fromNode` both ran. Each runner is its own adapter run. |
| Deadline, partial merge | works per run; **gap** across runs | `timeoutMs` 3,000: `timed-out`, `fast.test.ts` completed with its record, `slow.test.ts` none. One budget over several runs and batches does not exist. |
| Truncated child V8 file | not applicable today; works with `ownRecord` | Squeal collects no child coverage. In `child.mts` the cut file failed `JSON.parse` alone and was named; the other child's record stayed. Same for a cut node:test payload. The daemon's writer drops such a file as `map-error` (read in source code, `coverage/writer.ts`). |
| `testTimeout` floor | works | Squeal sets no `testTimeout` (read in source code: no match in `src/`); a 7 s test passed under the project's 30 s. |
| `--node-import tsx` | works | `nodeTest[].argv: ["--import", "tsx"]` goes to `node` as given, so Node resolves `tsx`. |
| Import-graph selection, no mapping | selection works; **gap** for no mapping | `affected(["src/shared.ts"])` gave its test; `src/orphan.ts` gave none and read CRAP 12 from 0%. |

### Q6. Exceptions

**cezar today** (read in source code, `7b726e2a2`). CI's `complexity-gate` job checks out the base commit, runs `complexity-gate.mjs` from it (never head code), refuses a changed function over 20 that is new or grew, and passes `--allow-growth` when the PR has the `baseline-growth` label, read live from the API. It does not check who added the label; "owner merge required" relies on branch protection. `baseline-growth.cjs` applies the same label to `.baseline.json` ratchets. Pre-PR (`references/pre-pr.md`, `issues.md`): a finding that predates the task and needs a larger refactor may be deferred with a `code-quality-improvement` issue that records baseline scores; "an uncertain origin remains an unresolved finding". Agents and reviewers check this; no code does.

**Proposed boundary** (inferred). Squeal takes an exceptions file: per entry, the function identity and body hash, the measure, the kind (`inherited` or `approved`), the issue URL, the approver, and the base commit. The consumer proves trust before it passes the file: trusted base-commit CI code, the label's actor and permission, never a file or label from the candidate branch alone. Squeal applies the policy: `inherited` holds only with complete base and head evidence and head ≤ base for that measure; CC at base costs a count, CRAP at base needs a base coverage run. `approved` covers new or worse findings. Both keep the measured scores and show as accepted. Missing evidence cannot use an exception.

### Q7. Provenance and delivery

**Stamps** (read in source code): `COUNTER_VERSION` 3, `COVERAGE_PROVIDER_VERSION` 3, `COVERAGE_RECORD_VERSION` 4, `KEY_FORMAT_VERSION` 21, `VITEST_ADAPTER_VERSION` "3", `NODE_TEST_ADAPTER_VERSION` "10", `PART_FORMAT` `squeal-ci-part/3`, the part header's `squealVersion` and `commit`, `squeal code --json` `v: 1`. No policy version and no gate-report version exist.

**Pinning** (verified by experiment). Release `squeal--v0.1.422` has `install.sh` and two runtime assets. The descriptor `squeal-codex-runtime.json` names `releaseCommit` `5be725a8e…`, equal to the tag's commit, and an artifact SHA-256 equal to the downloaded `.json.gz`. The artifact lists 39 files, among them `dist/cli/squeal.mjs`, `dist/coverage/provider.mjs`, `dist/code/tree-sitter-tsx.wasm`, `dist/ci/*`, `dist/node-test/recorder.cjs`. The trial of 018-08 ran `plugins/claude-code/dist/cli/squeal.mjs` from `git clone --depth 1 --branch squeal--v<version>` (read in `tasks/018-08-squeal-results-trial.yml`). So CI can pin either the tag clone, checked against the expected commit, or the runtime asset, checked against its SHA-256; both work offline from a cache. `install.sh` needs a harness on the PATH and fits neither.

## Recommendation for Squeal

**First slice: a local one-shot gate on in-process evidence.** One command (provisionally `squeal quality --base <ref> [--test <file>...]`) and one evaluator module the daemon can call later. It is useful alone: it replaces cezar's bundled `check.mjs` for every change whose functions tests run in-process. Rows:

1. Evaluator and versioned report: CC ≤ 20, CRAP ≤ 30, equality passes, pass / violations / incomplete, the Q4 completeness rules, golden tests.
2. Changed-function inventory against a base: D2 identities, moves by body hash, occurrence shifts matched by body hash, test files included.
3. One-shot collector: Vitest and node:test adapters, selection by `affected()` plus explicit files, loaders from `closure()`, one 600 s budget over all runs, records kept at the deadline.
4. Join repair for same-end nested arrows and cast-expression arrows. This also turns daemon states that read unknown today into judged states.
5. CLI, docs and exit codes.

Cost: 5 rows, about 5 worker sessions and one review. Per run, at most +32% CPU over the project's own test run on this sample (Q1). Limits: no CI evidence, no daemon reuse, no exceptions, no child or browser coverage; child-only functions with CC 6 or more read violations (cezar: 4 of 314 functions in 10 PRs) unless the gate reads them as unknown. Reverses, in the gate only: 015 D1 "test files are never counted" and D9's no-loader 0%. Item 4 amends D9's join for the daemon too.

**Later slices** (inferred):

| Slice | Rows | Cost | Reverses |
|---|---|---|---|
| 2. Daemon parity: the daemon calls the evaluator; the gate reuses current records and counts from the stores and runs only what is missing | 3 | +4.6 s first count here, +8.2 s in cezar, for test files | 015 D1 test-file exclusion in the daemon; D9 no-loader rule (overlaps #165) |
| 3. CI evidence: `ci record` adds the provider and records to parts; the gate reads parts | 4 | +8% CPU per shard (015) plus about 22 ms a test file to map (Q1) | 018 D8 "No coverage provider is added"; second-slice non-goal "Squeal's coverage provider in CI"; D10's coverage tolerance; a project's own `--coverage` report in the same run |
| 4. Exceptions file and policy | 2 | small; CRAP at base needs a base run | none; new |
| 5. Child coverage, opt-in per project | 2 | +13% to +16% CPU on child-heavy files (`child-processes.md`) | 015 non-goal "code that tests reach only through a child process"; D8's recorder deleting the variable |
| 6. Pinned runtime for CI, documented | 1 | none at run time | none |

## Open questions

1. Product: should a child-only function read "incomplete" or be measured at 0% until slice 5? The issue's rule "missing or partial evidence never passes" points to incomplete, which blocks cezar's 2 of 10 PRs.
2. Not determined: whether the `ci record` hook can add Squeal's provider before Vitest starts its workers. Its `setVitest` wrap runs after the config resolves; no probe tried it.
3. Not determined: browser-mode coverage (cezar's `*.e2e.ts`, 6.4% of its changed functions). The provider needs `node:inspector`.
4. Not determined: cezar's child-only count by running its tests. The 14 are from static readers; a run with `NODE_V8_COVERAGE` would confirm it.

## Sources

- Issue [#167](https://github.com/hearsay-tools/squeal/issues/167) and cezarion [#3096](https://github.com/hearsay-tools/cezarion/issues/3096), fetched with `gh issue view` on 2026-11-09.
- Squeal `fc58af3da`: `docs/vision.md`; spec 015 D1 to D9 and Non-goals; spec 018 Non-goals, D8, D10; `research/issue-167.md`, `child-processes.md`, `issue-144.md`, `issue-165.md`, `node-test-coverage.md`; `src/cli/{ci,ci-export,run}.ts`; `src/runners/vitest/{ci-record,coverage}.ts`, `ci-runtime/vitest-ci.cjs`; `src/runners/node-test/{adapter,coverage}.ts`; `src/core/code/{count/index,coverage/{mapper,own,record,runtime,provider.mjs},crap/{join,file,score}}.ts`; `src/core/ci/parts.ts`; `src/core/keys/key-format.ts`; `src/harness/codex/runtime-release/{descriptor,manifest,release}.ts`; `install.sh`; `docs/specifications/018-ci-and-shared-results/tasks/018-08-squeal-results-trial.yml`.
- cezar `7b726e2a2` (read only): `.ai/skills/check-code-quality/{SKILL.md,references/{tool,pre-pr,issues}.md,scripts/complexity-gate.mjs}`, `.github/scripts/baseline-growth.cjs`, `.github/workflows/ci.yml` (`complexity-gate`).
- Release assets of `squeal--v0.1.422`, from `gh release view` and `gh release download`.
- Probes and outputs: `probes/quality-gate/README.md`.
