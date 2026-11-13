# 011-329: runner traits stated once per runner kind

Worker 6a5188b3, 2026-11-13. Brief: `tasks/wave-80.md` W1. Contract: `research/runner-traits.md`, the coordinator's calls.

## What moved where

- `src/core/types/runner-traits.ts` (no barrel): `RunnerTraits` (eight required members, each a function property), `TraitStatement` (what a kind states; any member may answer `undefined` for "not known"), `declareTraits` (every default and clamp), `NO_TRAITS`, `liveTraits` (forwards to the traits a holder has now; no default of its own).
- Each kind states its traits in `src/runners/<runner>/traits.ts`: `vitestTraits({ widths, omitted })` (widths decoded once per table identity by `decodeWidths`; a table that does not decode is none), `nodeTestTraits({ tierSize })`, `pytestTraits({ tierSize, batchSize })`.
- `RunnerAdapter` has a required `traits`; the eight optional members, `focuses` and `focusesFile` are gone. `focusesFile` in `composite-runner.ts` is gone.
- Holders: the sized Vitest adapter in `index.ts` (from its `VitestWidths` table and the count the bare adapter keeps); the bare `VitestAdapter` in `adapter.ts` implements `RunnerAdapter` less `traits` (see decision 7), the node:test adapter and its inner project adapter, the pytest adapter, the proxy (`hostTraits`, one `switch` over `HostRunner`; a missing case leaves the end reachable, a compile error, TS2366), the recovering runner (`liveTraits` over the live or parked adapter's traits, else its option `traits`, the kind's over no values), the composite (`declareTraits` over each owner's), and the layers that carry the object: the slow instance (`fast.traits`), `afterEachRun` (`runner.traits`, read for `lane` and `besideBacklog`), the idle-GC track and the remote lane (object spread).
- Readers, one call each: `tiers.ts` `laneOf`, `tierWidth`, `partOf`; `slots.ts` `backlogSlot`, the beside read; `slow-tier.ts` the slow width; `revision.ts` and `omitted-test-files.ts` the omitted count; `focused.ts` `mayFocus`; `code/gate/plan.ts:90`; `remote/lane.ts:265`.
- Wire unchanged: `HostValues` (`omittedTestFiles` now read through `traits`), `members`, and the start reply's `adapter.focuses`, now `built.traits.focuses` of a file of no project (each kind's focus holds for each of its files or none). The proxy no longer reads it. `runner-host/runners.ts` no longer imports `width.ts`.

## The table

Rows read `holder.traits` as the scheduler does; columns are the eight traits for one file (`answers` in `test/daemon/runner-traits-fixture.ts`: three slow files led by it, a grant of 8).

| File | Rows |
|---|---|
| `test/daemon/runner-traits.test.ts` | `declareTraits`: no statement, empty, all `undefined`, full, clamps below 1, part of a file, explicit `null` slot, grant 0, arguments passed; `liveTraits`. Each kind's statement: Vitest over no values, over a table and a count, over a table that does not decode; node:test over no values and at `tierSize` 4; pytest with no batch size and with 2; `tierSize` 4 to 6 and a new table read at each answer |
| `test/daemon/runner-traits-holders.test.ts` | The in-process adapter: Vitest (the real `createVitestAdapter` over a fixture at `maxWorkers: 2`, before and after its listing), node:test (`tierSize` 4 to 6). The proxy over sent values: Vitest before and after a `values` event (count 0 to 3), node:test, pytest with no batch size and with 2, each at `tierSize` 4 and 6. The recovering runner before creation: node:test, pytest (both batch sizes), Vitest; after an idle close (spec 021 D20.1: the parked adapter's until the next); after its host died (D7: the kind's over no values until the next adapter). The host's start reply `adapter` and `values` as exact text for each kind |
| `test/daemon/runner-traits-chain.test.ts` | The daemon's chain, assembled as `daemon.ts` assembles it (idle-GC track, `afterEachRun`, composite of the slow instance over Vitest's recovering runner, node:test, pytest, pytest batch 2): before a listing, each owner's file, a project no member owns, `tierSize` 4 to 6. Every layer carries the object it was given (slow instance, `afterEachRun`, idle-GC track, remote lane). The composite across two owners: lane, part, slow width, width, omitted sum, no owner |

The chain row assembles the chain from the same functions in the order `daemon.ts:555-790` uses; the daemon has no seam that hands its runner to a test. The remote lane is a row of its own (identity), since `withDaemonRemoteLane` reads the user's remote settings.

## Deleted tests and cases, each to its table row

| Deleted | Row that covers it |
|---|---|
| `test/daemon/tier-width.test.ts` | holders: recovering runner before creation, node:test and pytest, `tierSize` 4 to 6; chain: composite asks the owner's width, parts differ across owners; composite: `tierWidth` per owner, `tierPart` |
| `test/daemon/beside-backlog.test.ts` | holders: recovering runner before creation (node:test, pytest true; Vitest false); chain: through composite, slow instance and `afterEachRun` |
| `test/daemon/focuses-file.test.ts` | holders: before creation (pytest, Vitest true; node:test false); chain: through every layer and the idle-GC track, no owner false |
| `test/daemon/slow-width.test.ts` | holders: in-process Vitest and the proxy (width table); layers: the slow instance carries the fast instance's object (identity); composite: first owner's own files `[a,b,a]` 3, `[a,unit,b]` 1, `[unit,unit,a]` 2 |
| `test/scheduler/backlog-slot-runners.test.ts` | holders: before creation (node:test 1, pytest 5 and 2, Vitest `null`); chain: every wrapper |
| `test/daemon/runner-idle.test.ts`, "answers the synchronous members from the closed adapter until another exists" | holders: recovering runner after an idle close |
| `test/runner-host/host-proxy.test.ts`, the trait part of "answers members, and the synchronous ones from the values sent last" (renamed "answers members") | holders: the proxy over sent values, Vitest before and after a `values` event |
| `test/runner-host/node-test-host.test.ts`, "keeps runner.tierSize as its tier width, as in process" | holders: in-process node:test and the proxy, node:test at `tierSize` 4 and 6 |
| `test/daemon/composite-runner.test.ts`, "puts each file in its runner's lane (001 D5 as amended, task 001-140)" | chain: before a listing and after; composite: lane per owner and no owner |

## Read path only

Same cases, same expected values; only the trait read moved to `traits` (coordinator, 2026-11-13):

- `test/runners/vitest/width.test.ts` (17 reads)
- `test/runner-host/vitest-parity.test.ts`, `node-test-parity.test.ts`, `pytest-parity.test.ts` (their trait members kept; `focuses` is now `traits.focuses(<a file of the fixture>)`, compared in process against the host)
- `test/runners/vitest/exclude-files.test.ts`, `test-command-files.test.ts`, `focused.test.ts`; `test/runners/pytest/focused.test.ts`
- `test/keys/validity/harness/vitest.ts`: types only (`Omit<RunnerAdapter, "traits">` for its helpers). The key alarm runs this harness at the last release too. A first edit read `adapter.traits` in `hinted` and threw there in 27 Vitest cases (`c3cb70cd8`); `hinted` now reads `traits` when the adapter has one, else its own members. On the bare adapter both versions have neither, so `hinted` covers nothing now; whether to keep it is the key alarm's owner's call
- `test/daemon/composite-reconcile.test.ts`, `escaped-overlap.test.ts`, `escaped-run-mark.test.ts`
- `test/scheduler/tier-holds.test.ts` (the harness runner's width: `h.runner.traits = declareTraits(...)`)

The traits line of a hand-written fake or builder (`traits: NO_TRAITS`, `declareTraits(...)`, or the inner runner's): `catch-up-fixture.ts`, `wall-fixture.ts`, `claims-fixture.ts` (builder options keep their names and go through `declareTraits`), `recording-runner.ts`, `timed-runner.ts`, `test/kit/fake.ts`, `fake-channel.ts`, `lane-fixture.ts`, and the fakes in the other changed test files of the commits. Fakes cast to `RunnerAdapter` or built as a partial runner in a `SchedulerContext` cast (`runner: {}`, `{ focuses: true }`, `{ lane }`) typechecked before and would have failed at run time; each has its traits line now (commit `1363820e6`).

## The default grep

```sh
# optional calls of a trait member
grep -rnE '\b(omittedTestFiles|slowWidth|tierWidth|tierPart|besideBacklog|backlogSlot|focuses|focusesFile|lane)\?\.\(' src --include=*.ts
# a default beside a trait name
grep -rnE '\?\? (grant|testFiles\.length|own\.length|""|null|false|0)([^.0-9]|$)' src --include=*.ts \
  | grep -E 'traits|omittedTestFiles|slowWidth|tierWidth|tierPart|besideBacklog|backlogSlot|focuses'
```

Answer at `1363820e6`: only `src/core/types/runner-traits.ts` lines 97 to 107 for both, and `src/runners/vitest/width.ts:97`, which is Vitest's own width function (`tierWidth(want, ceiling, floor)` of `WidthAnswers.atOnce`, the kind's value for a project with no ceiling), not a trait default. `Math.max(1, …)` of a trait answer appears only in `declareTraits`; the `Math.max(1, ...)` in `tiers.ts:533,535` and `remote/admission.ts:207` takes the widest of several files, not a clamp of one answer.

## Decisions the record did not settle

1. **`TraitStatement` answers `undefined` for "not known".** Vitest's widths are absent before a start, and the composite has no owner for an unlisted project; both then answer the default from `declareTraits` instead of restating it.
2. **Clamps moved into `declareTraits`.** `tierWidth` at least 1 (was in `tiers.ts:541`), `backlogSlot` `null` or `max(1, floor(n))` (was `slots.ts:17`), `slowWidth` at least 1 (was `slow-tier.ts:668`). `plan.ts:90` and `lane.ts:265` now get the width clamp too; their grants are at least 1 (`vitestWidth()`, policy `tierSize` is a positive integer, admission grants 1 and the file count) and every kind answers at least 1 there, so no estimate or admission changes. `slowWidth([])` now answers 1, not 0; nothing reads it with no files.
3. **The recovering runner keeps one option, `traits`** (required): its kind's traits over no values. With an adapter it answers that adapter's traits. For node:test and pytest these are the kind's own statement over the same `tierSize` and batch size, so every answer is today's.
4. **The proxy's node:test and pytest width** is `options.policy().tierSize`, which `process-host.ts` fills from the same `concurrency` (the daemon's `runner.tierSize`) at each read; pytest's slot is `options.options.process.project.batchSize`. Not new wire data.
5. **Vitest's lane instances** (slow, group, beside) are recovering runners with `vitestTraits()`, so their focus answers true where the old option left it absent. Nothing reads their traits: the slow instance answers from the fast one, and lane instances only run.
6. **The host's `adapter.focuses`** is `built.traits.focuses({ project: "", path: "" })`. Bytes checked per kind in the holders table.
7. **Vitest's traits live in the sized adapter (`index.ts`), not in `adapter.ts`.** A first version built them in the bare `VitestAdapter` through an optional `VitestHints.table`. That put `runner-traits.ts`, `vitest/traits.ts` and `width.ts` into the Vitest adapter's key bundle: `test/keys/key-format.test.ts` then wanted a validity case for their unrun lines (and for the release's removed `omittedTestFiles` lines), and `test/keys/validity/adapters.test.ts` "fires none for a change to Vitest's width hints" failed (risk 3). Now (`fcef06272`) the bare class implements `Omit<RunnerAdapter, "traits">`, drops only its `focuses` field, and keeps `omittedTestFiles()` unchanged as the count's accessor, which the sized adapter's traits read. Tests that run a bare `VitestAdapter` as a runner give it Vitest's traits over no widths through `withVitestTraits` (`test/runners/vitest/helpers.ts`): `cancel-grace`, `crash-cancel`, `empty-closed`, `related`, `structural-fallback`, `test/scheduler/vitest-harness.ts`. This is the record's own reading: "width changes nothing a check stores, so `adapter.ts` holds none of it".
8. **`pytest/traits.ts` imports `DEFAULT_BATCH_SIZE` from `pytest/run/run.ts`.** Not an adapter, but not light either. The daemon loads `run.ts` already (`pytest-runners.ts` did), and the runner host does not load `proxy.ts`. Moving the constant into `traits.ts` would edit `run.ts`, outside this row.

## Files outside the brief's list

- `src/runners/node-test/adapter-project.ts`: one `traits` line, forced by the required field (the inner project adapter is a `RunnerAdapter`).
- `test/version-sensitive.txt`: one line in the header's "Exempt" list, `test/daemon/runner-traits-holders.test.ts` (coordinator's agreement, 2026-11-13). Its in-process node:test row builds the adapter on a missing `cwd`, so no node:test runs and its result does not depend on the Node version; the rule flags it by name (`createNodeTestAdapter`, `NodeTestProject`). The other two table files name no node:test project (variables renamed).
- `src/runners/vitest/width.ts`: `VitestWidths.slowWidth` and `tierWidth` removed (dead after the move, and they restated `?? grant` and `?? testFiles.length`); `table()`'s comment. The key alarm reaches no part of `width.ts` (record).

## The key alarm's covered-lines rule

`test/keys/key-format.test.ts` fails when a key component's bundle has changed lines no validity case runs. Besides Vitest's (decision 7), the node:test and pytest adapters now import their kind's traits, so `runner-traits.ts` is in those bundles; no case ran `declareTraits`' `backlogSlot` body (lines 103 to 105). As `hinted` does for Vitest's width hints, `traitsAsked` (`test/keys/validity/harness/shared.ts`) asks every trait of each run's files and drops the answers; the node:test and pytest harnesses call it after each run. An adapter of a release before this row has no `traits` and is asked nothing. Traits decide no stored row, so no case output and no adapter version moves. The record's call "they pass without a version raise when every case's output is unchanged" held for outputs; it did not foresee this rule.

## Type changes

- Added: `RunnerTraits`, `TraitStatement`, `declareTraits`, `NO_TRAITS`, `liveTraits`; `VitestTraitValues`, `vitestTraits`, `decodeWidths`; `withVitestTraits`, `traitsAsked` (test helpers); `NodeTestTraitValues`, `nodeTestTraits`; `PytestTraitValues`, `pytestTraits`.
- Required `RunnerAdapter.traits`; required `RecoveringRunnerOptions.traits`. `VitestAdapter` (the bare class) implements `Omit<RunnerAdapter, "traits">`; `createVitestAdapter`'s result has `traits`.
- Removed: `RunnerAdapter` `omittedTestFiles?`, `slowWidth?`, `tierWidth?`, `tierPart?`, `besideBacklog?`, `backlogSlot?`, `focuses?`, `focusesFile?`, `lane?`; `RecoveringRunnerOptions` `tierWidth`, `besideBacklog`, `backlogSlot`, `focuses`; `focusesFile` (composite); `Widths` and `widthsOf` (`runner-host/runners.ts`); `VitestWidths.slowWidth`, `tierWidth`; `SizedVitestAdapter.slowWidth`, `tierWidth`; `HostProxy.focuses`, `omittedTestFiles`, `slowWidth`, `tierWidth`; `VitestAdapter.focuses`.

## For the next worker

- Doc comments that still name a removed member, in lines this row did not own: `scheduler/backlog.ts:82`, `slots.ts:11,27,72`, `slow-tier.ts:626`, `slow.ts:95`, `tiers.ts:152` (`RunnerAdapter.<trait>`), `status/standing.ts:406` (`RunnerAdapter.lane`); `runner-host/protocol.ts:148-157` ("the synchronous members"). Each now means `RunnerAdapter.traits.<trait>`.
- 011-330 (the report merge) edits `merge` in `composite-runner.ts`; this row did not touch it.
- Card 10's seam is `remote/lane.ts:265`: `local.traits.tierWidth(file, grant)`.

## Verification at `c4dc78378` (2026-11-13)

The host rebooted near 19:52Z and stayed at load ~110 on 24 CPUs (another project's load). Many runs timed out in hooks or at 5 s; those are listed as such, not as passing.

- `pnpm run typecheck`: no errors. `pnpm run lint`: no findings.
- Squeal, current pass: the three traits table files, `test/runners/vitest/width.test.ts`, `test/code/gate/estimate.test.ts`, `plan.test.ts`, `test/runner-host/vitest-parity.test.ts`, `test/version-sensitive.test.ts` (also 7 of 7 in a direct run). `node-test-parity.test.ts` passed at revision 61 and `test/keys/validity/adapters.test.ts` (with "fires none for a change to Vitest's width hints") at revision 76; both were pending again at revision 79 after the harness edit.
- `test/keys/key-format.test.ts`: **no verdict.** Squeal's runs timed out in its `beforeAll` (the release tree's extraction), so its main test was skipped. A direct run (`hookTimeout` 300 s) passed 11 of 12 tests; the main test, "moves only when the validity path's outputs differ from the last release's", ran past its own 300 s limit (normal median 6 s, maximum 58 s) and did not complete. Its last completed run, at revision 69, failed on the two defects fixed since (`fcef06272`, `b6062735c`). The coordinator runs it after integration; CI runs it on the candidate.
- `test/runner-host/pytest-parity.test.ts`: fails at file level only, its `afterAll` cleanup timing out (10 s) at load 5 to 7 per CPU; its tests ran.
- Over `test/scheduler`, `test/code/gate`, `test/runner-host`, `test/keys`, `test/daemon` and `test/runners/{vitest,node-test,pytest}` (710 files): 366 pass, 2 fail (the two above), 304 pending, 38 unknown. `test/scheduler/busy-merge.test.ts` timed out once in a poll at load 7.7 per CPU and was pending a load retry. Other files that failed once in a hook or at 5 s at load 90 to 210 (`collect-inputs`, `touched-in-flight` passed on retry; `cancel-cause`, `imports`, `setup-rejection`, `coverage-default`, `observe*`, `overlap`, `keep-grown*`, `lock`, `reach`, `test-command-listing`, integration stamps files) had load retries queued.
- No full suite was run or requested.


## W2: review 0.1.473 S1, the holder table completed

Worker e8ca62ce, 2026-11-13. Brief: `tasks/wave-84.md` W2. Tests only; no product file changed. Commit `1b843fc07`.

### New rows in `test/daemon/runner-traits-holders.test.ts`

| Row | Holder | Expected |
|---|---|---|
| The in-process adapter: "is pytest's with no batch size at runner.tierSize, read per answer" | `createPytestAdapter` as `pytest-runners.ts` makes it: a missing `cwd`, no environment, `source: {}`, so no Python runs | `PYTEST` at `tierSize` 4, width 6 at 6 |
| The same, "with a batch size of 2" | project `batchSize` 2 and the option `batchSize: () => 2` | slot 2 |
| The recovering runner: "in a runner host is node:test's through open, an idle close and a replacement (spec 021 D20.1)" | `createNodeTestRunners` with `host: sourceHost(squealVersion())` and `idleMs` | `NODE_TEST` at 4 and 6: before creation, live, after the idle close, after the next host |
| The same, "pytest with a batch size of 2's" | `createPytestRunners` with the same options | `PYTEST` with slot 2, each phase |

All eight columns at `tierSize` 4 then 6 (`bySize`, beside the table's `tierSize`).

How the hosted rows reach each phase:

- Seams: the factories' `host` and `idleMs` options, and `sourceHost` from `test/runner-host/process-helpers.ts` (a real `squeal runner-host` from the sources, as the parity files use). The factories pass `idleMs` and `gone` only with a host, so a hosted runner is the only path through the factory to an idle close.
- Each host's adapter notes its missing `cwd` once ("is not a directory"). The count of these notes is the count of hosts started: 1 after `open`, 2 after the call that follows the idle close. No `/proc` read, so the rows hold on every platform.
- The idle close: `idleMs` answers 0 at `open`, then 1 for one `testFiles` call, whose end arms a 1 ms timer. A 50 ms timer started after it fires after it, so the next read is of the parked adapter. The second host shows that the first closed.

### Against the base (`73abdb9e1`)

- In-process pytest: the base adapter stated only `focuses: true` (`pytest/adapter.ts:348` there). The old fallbacks gave omitted 0, slow width 3 (the files), width 8 (the grant), part `""`, beside false, slot `null`, focus true, lane `""`. Now width 4 then 6, beside true, slot 5 or 2. These are the three answers N1 names; the other five columns are the base's.
- Hosted recovering runners: at the base the recovering runner took the width from its `tierWidth` option (`runner.tierSize`), beside and slot from its options (true; 1, or the batch size), and focus from its option (node:test none, so false; pytest true). Omitted, slow width and part came from the proxy (the host sent 0 and no widths: 0, 3, `""`). Lane was no member: `""`. Today's answers are the same in each phase. No difference outside N1.
- How this was checked: by reading the base's `runner.ts:247-254`, `pytest-runners.ts`, `node-test-runners.ts`, `proxy.ts:222-231` and `pytest/adapter.ts`. The base has no `traits` member, so the rows cannot run against it.

### What the rows prove, and what they do not

- They prove each holder's wiring. The in-process pytest adapter's `concurrency` and `batchSize` options reach its traits. The hosted proxy's width follows `runner.tierSize` at each answer through `process-host.ts`'s policy getter. Its slot follows the project's `batchSize` across the wire: no default gives 2.
- For node:test and pytest, the live, parked and option traits give the same answers by design (decision 3). So no row shows which one answers: a reversed order in `liveTraits(() => (inner ?? parked?.last)?.traits ?? options.traits)` still passes here. The unchanged Vitest idle and host-died rows are the ones that tell the order apart.

### Choices

- No hosted pytest row with no batch size. Each hosted case starts two hosts: node:test took 4.5 s to 6.0 s and pytest 6.2 s to 9.5 s, at host load about 74 on 24 CPUs. The proxy row already covers the default batch size, and the batch-2 row covers its path over the wire. A first version had the row; it passed at revision 3 in 7.0 s.
- The file is 359 lines, over the ~300-line signal. The brief keeps the rows in the existing table, and W2 owns no other file. A later split could move the start-reply section (about 45 lines) to a file of its own.
- `test/version-sensitive.txt` is unchanged. The file stays flagged (`createNodeTestAdapter`, `NodeTestProject`) and exempt. The hosted node:test case runs no node:test (missing `cwd`), and its host runs on the Node that runs the test.
- `test/daemon/runner-traits-fixture.ts` is unchanged. `bySize` stays in the table file, since it sets that file's `tierSize`.

### Verification

- `pnpm run typecheck`: exit 0. `pnpm run lint`: `Checked 3366 files in 15s. No fixes applied.`
- `squeal status --wait 60000 test/daemon/runner-traits-holders.test.ts test/version-sensitive.test.ts` at revision 5: no known failures, both current. Each new case passed (`--check`).
- Two known failures elsewhere in the worktree, both with no baseline result and neither importing these files: `test/code/delivery/cost.test.ts` (394 ms against 300 ms, a timing limit) and `test/commit/boundary-daemon.test.ts` (a real daemon). Host load was about 74 on 24 CPUs.
- No full suite, no `squeal run --all`, no build.
