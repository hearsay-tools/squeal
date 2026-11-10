# Survey 020-07: daemon parity

Researcher 26dfa2d5, 2026-11-10. Brief: `../tasks/wave-2.md`, "survey-020-07". Squeal `1e8b506ed` (0.1.423 plus docs), Node v24.22.1, Vitest 5.0.3. Read-only on the product. Probes: `probes/daemon-parity/` (throwaway; pure functions and read-only store reads; no daemon, no test run). One-minute load 24 to 28 on 24 vCPUs during every probe; 74 at session start, when nothing ran.

## Questions answered

| # | Answer | Tag |
|---|---|---|
| 1 | Complexity states come from `pass/` (`judge.ts`). `crap` and `uncovered` come from the coverage step: `crap/loaders.ts` (each loader's condition), `crap/file.ts` (`fileCondition`, `coverageOf`), `crap/walk.ts` (ready, early, drop, beside a skip), `crap/judge.ts` (`measuresOf`, `kindOf`). The gate already shares the counter, the join (`join.ts`/`match.ts`) and `crapScore`. It shares no completeness rule and no state decision. | read in source code |
| 2 | Not by calling `evaluate()` itself: it takes a whole `ChangedSet` and `Evidence` and returns a report. Extract its per-function rule (`judgementOf`, `measuresOf`, the exclude branch) into one pure function both call. The daemon keeps its transitions, early pass, drop and views. Four rules differ today (table in Q2); three need a decision. | verified by experiment (`parity.mts`); design inferred |
| 3 | +29,029 functions (+161% over the 17,995 counted now) in 1,562 test files, 3 over CC 20. Counting them takes 4.7 to 5.0 s of CPU once per repository. A test file must become its own loader, or every test callback reads 0% and untested. The listing hold of 015-52 can go. | verified by experiment; read in source code |
| 4 | A no-loader source reads `unknown` with a new cause. In this repository no judged function changes: every no-loader file outside `coverage.exclude` has no functions. #165 is resolved. One trap: `walk.ts` keeps an unknown file's old states when its loader set is unchanged, so the 0% failures would stay. | verified by experiment (store read); read in source code |
| 5 | Reuse coverage records and results by result key; do not reuse counts (about 3 ms a file). Keys must be computed with no store write. 78% of this repository's current keys have a record, and 100% have results. Whether the gate's keys equal the daemon's is not verified. | verified by experiment (store read); inferred |

## Findings

### Q1. Where the daemon's code states come from

Read in source code at `1e8b506ed`.

- **Complexity** (`measure = complexity`): `pass/pass.ts` runs a pass per revision. `pass/plan.ts` and `pass/included.ts` choose the files. `included.ts` leaves out every path in `testFiles` (the runner's listing), `node_modules` and ignored files. `pass/judge.ts` gives `pass`/`fail` against the threshold, `unknown` inside a parse error, and moves by body hash. A file not counted yet is `pending`. Complexity never waits for a test (015 D5).
- **CRAP and untested** (`crap`, `uncovered`): `crap/step.ts` runs the coverage step within `STEP_BUDGET_MS`.
  - `crap/loaders.ts` `LoaderBuild` gives each listed test file's condition at its current key: ready (record stored), pending (`imports`, `run`, `record`) or unknown (`no-record`, `skipped`, `unkeyed`, `unread`). A test file is never its own loader: `if (path === row.testFile.path) continue;` (line 199).
  - `crap/file.ts` `fileCondition` folds the loaders: no loader at all is `ready`, with an empty set ("A source no test file loads is ready with no loader"). `coverageOf` joins the ready loaders' records (`join.ts`, D4's `match.ts`).
  - `crap/walk.ts` judges ready files. A file that is not ready is judged early (015-57: only a `fail` its records prove `pass`; 015-78: any pass beside a skipped test). It drops kept states only when the loader set changed (015-75, line 56).
  - `crap/judge.ts` `measuresOf` gives `crap` (`fail` above `crap.threshold`) and `uncovered` (`fail` when `runBy` is empty), or both `unknown` when the join is unresolved. `kindOf` gives the transition, none into or out of `pending`/`unknown`.
- **The gate** (`gate/evaluate.ts`): `judgementOf` and `measuresOf`, over `standing()` per test file. It calls `joinCoverage` and `crapScore`, the daemon's own.

### Q2. One evaluator for the daemon and the gate

**The rules differ in four places** (verified by experiment, `parity.mts`, `parity.out.json`: the same function and records, through `fileCondition`/`coverageOf`/`judgeFiles` and through `evaluate`):

| Case (CC 7 unless named) | Daemon today | Gate today |
|---|---|---|
| A. No test file loads the source (CC 3) | `crap pass 12`, `uncovered fail` | `incomplete (no-loader)` |
| A. No test file loads the source | `crap fail 56`, `uncovered fail` | `incomplete (no-loader)` |
| B. A loader ran it; a test failed | `crap pass 7`, `uncovered pass` | `incomplete (test-failed)`, CRAP 7 |
| C. A loader ran it; a test skipped | `unknown (skipped)`; 015-78 can still prove the pass | `pass`, CRAP 7 |
| C2. A loader ran none of it; a test skipped | `unknown (skipped)` | `violation`, CRAP 56 |
| E. A loader ran none of it | `crap fail 56`, `uncovered fail` | `violation`, CRAP 56 (agrees) |

There is one more difference, read in source code: the gate has no `uncovered` measure. A function no test runs, with CC 5 or less, passes the gate (CRAP at 0% is CC² + CC ≤ 30, and equality passes) and fails the daemon's untested check.

**Why `evaluate()` itself does not fit** (read in source code). It needs a `ChangedSet` (base and head commits, changed functions) and a one-shot `Evidence`, and it returns a report with a verdict. The daemon judges every counted function of a revision, waits on pending loaders, and records transitions per measure. Its delivery rules (015-57 early pass only for failures, 015-75 drop, 015-78 beside a skip, `kindOf`, quiet recounts) decide when a state is written and told, not what it is.

**Proposed shape** (inferred). A pure `judgeFunction(input, policy)` in `src/core/code/gate/rule.ts`:

- Input: complexity; excluded (`coverage.exclude`); the loaders, expected and measured; the first missing gap (`no-loader`, `not-finished`, `no-record`, `skipped`, `pending`); the joined coverage or `null`; `failed`.
- Output: the gate state and gap, CRAP, and the per-measure outcomes `crap` and `uncovered`. The gate reads the state. The daemon maps `pass` and `violation` to `pass`/`fail` per measure, and `incomplete` to `unknown` or `pending`.
- `evaluate()` keeps its signature and calls it per function. The golden tests of 020-01 must not change; that proves the extraction.
- The daemon's `crap/judge.ts` `measuresOf` calls it. `walk.ts` builds the input from `FileCondition`.

**Decisions needed for parity:**

1. **Failed tests (case B).** The gate makes every function `incomplete` when any selected test failed. In the daemon that would flip every judged function of a source to `unknown` during each red phase of TDD. Options: (a) the rule takes `failed` as input; the gate passes "a selected test failed", the daemon passes `false`, because test failures are delivered as test transitions. (b) The daemon passes "a loader of this source failed". Then the source reads `unknown`, quietly, until the test passes. Recommendation: (a). It changes nothing the daemon delivers.
2. **Skipped tests (C, C2).** The gate gives a violation from a record whose file skipped a test. 015 D9 reads that as unknown, because the skipped test could run the function. Recommendation: the gate adopts 015's rule. A loader with a skipped test can prove a pass (015-78) and never a violation; gap `skipped`. `TestFileEvidence` gains `skipped: boolean`, filled by `collect.ts` from the adapter's outcomes. This changes the gate's verdicts, so `QUALITY_POLICY_VERSION` rises (020-09 takes it to 2; this makes 3).
3. **`uncovered`.** Keep it as a daemon measure computed by the same rule (`ran` from the join). The gate report may leave it out. This changes nothing in either today.

### Q3. Counting test files in the daemon

**Functions and cost** (verified by experiment, `count-tests.mts`, 3 runs, `nice -n 10`, load 26 to 28). The worktree lists 1,562 test files (10.1 MB). Counting all of them gives 29,029 functions: 28,680 with CC 1 to 5, 302 with 6 to 10, 44 with 11 to 20 and 3 over 20. The 3 are `test/lint/oxlint/replay.test.ts` `replay` 33, `test/harness/latency.test.ts` `<describe>.<it>` 25 and `test/presence/presence.test.ts` `<describe>.<anonymous>` 24. One file has a parse error (`test/fixtures/node-test/edge/test/syntax.test.ts`, on purpose). The runs took 4,952, 5,325 and 4,986 ms of CPU (4.7 to 5.0 s wall), about 3.2 ms a file, after the grammar's start. That matches 015-126's 4.6 s. Counts are stored by blob, so this is paid once per repository and counter version, not per worktree.

**Store** (verified by experiment, store read). One worktree holds 17,995 complexity states and 13,227 each of `crap` and `uncovered`. The code store holds 1,031,531 state rows over 24 worktrees. Test files add 29,029 complexity rows per worktree. Here `coverage.exclude` holds `test/**`, so no coverage rows are added. A project without that exclusion gets 58,058 more coverage rows per worktree.

**What must change** (read in source code; consequences inferred):

- `pass/included.ts` stops leaving out `testFiles`.
- **A test file is its own loader.** Every closure here holds its own test file (1,563 of 1,563, store read), and records hold the test file as a source; `daemon.ts:692` skips only the provider. But `loaders.ts:199` drops the test file from its own loader list. Without a change, each test callback has no loader: today it would read 0% and untested; after Q4 it would read unknown.
- **The listing hold can go.** 015-52 (`pass/listed.ts`, 217 lines, and `holdUnlisted`, `waitingPaths` and the `onListed` nudge in `plan.ts`, `scheduler.ts`, `runner-work.ts` and `daemon.ts`) exists only because a file must not be counted before a listing proves it is not a test file. The listing fact (`listingMetaKey`, written in `scheduler/ledger.ts`) has no reader outside `pass/` (read in source code). When test files are counted, a new file is counted at once and nothing waits for a broken listing. The coverage step still waits for a listing (`fileCondition(…, listed)`).
- **Rollout.** A Squeal upgrade does not change the policy, so no recount starts. The row needs one `include` recount (`RecountReason`), for example by putting a counting-rules version in the recount check. That gives one summary line (here "73 functions over 20", up from 70), never a delivery per function (015 D6).
- **Delivery.** After the rollout, an edit that takes a test callback over CC 20 is told like any function. Here that is 3 of 29,029 functions. #167 asks for this.

### Q4. A file with no loader reads unknown

**The change** (read in source code). `fileCondition([], true)` returns `unknown` with a new cause, for example `no-loader`, in place of `ready`. A file that does not parse completely keeps its own rule.

**Effect here** (verified by experiment, `no-loader.mjs`, store read). Of 1,701 counted files, 95 have no loader in any listed test file's closure: 84 are under `coverage.exclude` (83 in `test/fixtures`). The other 11 (6 under `.github/scripts`, 3 under `evals/lib`, 2 Vitest configs) hold no functions. So no judged state of this repository changes. Its 2 untested failures (`scripts/check-version-bump.ts` `<map>`, `scripts/package-codex-runtime.ts` `<filter>`) have loaders that do not run them, and they stay.

**States and lines** (read in source code; inferred where marked):

- **States**: `crap` and `uncovered` go `unknown` with no transition (`kindOf` makes none into `unknown`). A told failure leaves `--told` and the "Code:" tail quietly, as 015-75's drop does. Nothing is delivered.
- **The trap** (inferred from `walk.ts:56`): `drop = kept.state === "unknown" && kept.loaders !== before?.loaders`. A file judged at zero loaders turns unknown with the same empty loader set, so it keeps its 0% failures. The row must drop states judged with no loader, for example by giving the empty set its own marker in `loaderSet`.
- **`squeal code <path>`**: the function line changes from `untested: no test runs it in the test's own thread` to a not-measured line. `notMeasuredBy` (`cli/code-coverage.ts:103`) names only runners today (`not measured: pytest gives no coverage`). It needs a reason with no runner, for example `not measured: no test Squeal runs loads this file`, the words 015-103 chose for `NOT_LOADED`. The summary's `N functions untested` falls, and `N files not measured` rises.
- **`squeal status`**: the Coverage line's untested count falls by the same functions.
- **Deliveries**: the `NOT_LOADED` FAIL wording (`delivery/code-coverage.ts:93`) can no longer occur, because a source with no loader no longer fails. It can be removed.
- **#165 (Python)**: a `.py` file that no configured runner loads reads not measured, with no CRAP. That is the fix the issue asks for. A `.py` file pytest loads is already `unknown` (`no-record`, pytest). #149: a source with no in-process loader reads not measured. A source whose loaders do not run it (a child process) still reads untested, as 015 D9 says.

### Q5. `--base` from the stores, with no daemon

**Counts by blob: do not reuse** (verified by experiment; inferred). Both sides key counts by the git blob id: `gate/changed.ts` `blobHash(bytes, format)` and the daemon's `createFsHasher` (`hashFile`). So a lookup in `counts (blob, language, counter_version)` would work. But counting costs about 3.2 ms a file (Q3), so a 50-file PR saves at most 0.3 s. Base blobs are often absent, and test files are absent until Q3 lands. The lookup is not worth a second read path.

**Coverage and results by result key: reuse** (inferred, from source):

1. For each selected test file, compute its key in this worktree as a daemon would. `ci export` already does this with no daemon (`core/ci/export.ts` `openKeys`, `keyFiles`), with `WorktreeKeys` over a scratch store.
2. Read the real store, read-only: the results at the key (`results.byKey`), and the record at `(key, COVERAGE_RECORD_VERSION)`. A record is stored only for a file that completed whole with all its tests selected (015 D8), so a record means `completed: true`. The results give `failed` and the skips.
3. Run only the files with no record or no result at their key. Report which files came from the store (`runs[].fromStore`).

**Two risks:**

- **Store writes.** `WorktreeKeys.bootstrap` and `reconcile` write a revision, `writeSeen` writes meta (`scheduler/keying.ts`). D3.5 forbids writes to a store. Keying over a scratch store, as `ci export` does, misses the daemon's observed reads (`addObserved`), so such files key differently and run again; that is safe, but the hit rate falls. A read-only overlay over the real store keeps them. Its cost is not determined.
- **Key equality** (not verified). The gate runs Vitest with `cache: false`. Vitest 5.0.3's `serializeConfig` has no `cache` field (read in source code, `vitest/dist/chunks/index.DpLw24bj.js:9835`), and `canonicalConfig` keys the provider as a marker, not a path (`runners/vitest/environment.ts`). So the keys should be equal. The row's first failing test must prove it on a fixture: the gate's key equals the daemon's for the same file.

**Hit rate here** (verified by experiment, `reuse.mjs`). In 3 worktrees with an idle daemon, all 1,562 keys have results, and 1,215 (78%) have a record at version 4 (2.66 MB). A fourth worktree, mid-edit, has 316 pending keys and 884 records (57%). The 347 keys with results and no record are all `.ts` Vitest files across `test/` (`no-record.mjs`). Why they have none is not determined: candidates are inspector closures run with coverage off (015 D8), writer drops (015-79) and records pruned before their results.

**With a daemon running** (inferred): read-only reads in WAL mode do not block it. D1's "neither talks to it nor uses its store" is slice 1's rule and changes in this row.

## Recommendation for Squeal

Spec D10, 020-07:

1. **One rule, not one report.** `judgeFunction` in `gate/rule.ts` decides a function's state from its evidence. `evaluate()` and the daemon's coverage step both call it. The daemon's transitions, early pass, drop, skip and views stay outside it, so delivery keeps 015 D6.
2. **No loader reads unknown**, cause `no-loader`, not measured in text and JSON. States judged at zero loaders are dropped once.
3. **Test files are counted** in the daemon, and each test file is its own loader. The listing hold of 015-52 is removed. One `include` recount at upgrade, with one summary line.
4. **`--base` reuses records and results** by result key, computed with no store write. Counts are not reused.
5. Decisions for the coordinator: failed tests (Q2.1, recommend the gate-only rule); skipped tests (Q2.2, recommend the gate adopts 015's rule, policy version 3).

**Row split** (order: 020-07a first; then 020-07b and 020-07c in parallel, on disjoint files):

| Row | Files | Tests first |
|---|---|---|
| 020-07a one rule, no-loader unknown | new `src/core/code/gate/rule.ts`; `gate/evaluate.ts`, `gate/types.ts` (`skipped`, gap), `gate/collect.ts` (skips only); `crap/{file,judge,walk,loaders}.ts` (the `no-loader` cause, the drop); `cli/code-coverage.ts`; `delivery/code-coverage.ts` (remove `NOT_LOADED`) | `parity.mts`'s table as golden tests through both paths; the 020-01 goldens unchanged; a file judged untested at 0 loaders reads unknown after the step, with no transition and out of `--told`; a #165 fixture (`.py`, no Python runner) reads `not measured`; a gate run with `it.skip` reads `incomplete (skipped)`, not a violation |
| 020-07b test files counted | `pass/{included,plan,listed,types,cursor}.ts`, `crap/loaders.ts` (own loader), the `onListed` callers in `scheduler/`, `daemon/daemon.ts` | a test callback over CC 20 is a first-seen fail on edit; a new test file is counted before its listing; a test callback is judged from its own file's record; an upgrade gives one recount summary and no per-function delivery |
| 020-07c `--base` reads the stores | new `gate/stored.ts`; `cli/code-gate.ts`; `gate/report.ts` (`fromStore`) | the gate's key equals the daemon's for one fixture file; a file with a record and results at its key is not run; a file with a result and no record runs; a stored failure makes the verdict `incomplete`; the store's bytes and mtime are unchanged after the command |

Cost: one count of all test files per repository (5 s here); about 29k more complexity rows per worktree here; no added test run. 020-07c saves the runs of every selected file whose record is current: up to 78% here, and less while a daemon is mid-edit.

## Open questions

1. Not determined: whether a read-only overlay of `WorktreeKeys` over the real store costs less than the runs it saves. It is needed to keep the daemon's observed reads in the key.
2. Not determined: why 22% of this repository's current keys have results and no record (Q5).
3. Not determined by experiment: key equality between the gate's Vitest adapter and the daemon's (Q5). It is read from source only.
4. Spec open question 2 (slice 2 timing): this survey proposes that `squeal code` without `--base` keeps 015's session view, and only the state rule moves.
5. Not examined: node:test test files as their own loaders (the node:test closure's shape), and pytest files once counted (CC only; no record).

## Sources

- Spec 020 D1 to D10 and `status.md`; spec 015 D1, D4 to D9 (`../../015-coverage-complexity/spec.md`); research `../../015-coverage-complexity/research/quality-gate.md` (015-126) and `issue-165.md`, at `1e8b506ed`.
- Code at `1e8b506ed`: `src/core/code/gate/{evaluate,types,changed,collect,policy,report}.ts`; `src/core/code/crap/{file,judge,walk,loaders,step,checks,summary}.ts`; `src/core/code/pass/{judge,included,plan,listed,types}.ts`; `src/core/code/coverage/{mapper,writer,record,types}.ts`; `src/core/code/count/index.ts`; `src/core/ci/export.ts`; `src/core/scheduler/keying.ts`; `src/core/hash/hasher.ts`; `src/runners/vitest/environment.ts`; `src/cli/code-coverage.ts`; `src/core/delivery/code-coverage.ts`; `src/core/daemon/daemon.ts:692`.
- Vitest 5.0.3: `node_modules/vitest/dist/chunks/index.DpLw24bj.js` `serializeConfig` (line 9835).
- Stores: `/home/agent/projects/squeal/.git/squeal/{store,code}.sqlite`, read-only, 2026-11-10 10:4x to 11:0x Europe/Warsaw.
- Probes and outputs: `probes/daemon-parity/README.md`.
