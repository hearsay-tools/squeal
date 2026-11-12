# Wave 13 (the human, 2026-11-12: 020-34 "Build it"; 020-35 "Match it to what the daemon does"; 020-36 "Record them"; no-daemon case "Measure first")

Base: main at the commit that adds this file. Spec 011 row 011-319 (coordinator bef76bfb, cand/0.1.452) edits `src/core/code/gate/keep.ts`, `keep-expected.ts`, `src/core/scheduler/record.ts`, `tiers.ts` and adds `src/core/run-evidence/**`; row 020-37 (worker 7d46cc8f) edits `keep-write.ts` and `src/core/store/lock-holders.ts`. No row here touches those. Targeted tests only; live probes only below load 24.

## 020-34 and 020-35: the gate's selection and its hint (#194)

Use /worker. Shape: slice. Read `research/issue-194-gaps.md` (Q1, Q2, probes G1 to G7) and spec D3.1, D12.6, D14.4 as amended on 2026-11-12.
- 020-35: selection also takes every test file whose declared `inputs`, read at the base, name a changed path, with the daemon's rules: reuse `createDeclaredInputs`/`selectDeclaredInputs` in `src/core/keys/closure.ts` (read only). Map form per test glob; list form gives every test file the listed globs. The selection line names files chosen this way apart. Start: `src/core/code/gate/collect.ts` selection, where `affected()` results are joined.
- 020-34: `src/core/code/gate/prerun.ts:96` treats every path as excluded when `coverage.children` is on. Print today's no-loader line when no selected test file runs; a weaker line when some do.
Owns: `src/core/code/gate/{collect,prerun,plan,select-closures,report,types,runners,evaluate}.ts`, `src/cli/code-gate*.ts`, their tests, the three `commands.md` copies. Leave alone: `keep*.ts`, `stored.ts`, `src/core/keys/*`, `src/core/store/*`, `src/runners/**`.
Done when (tests): G4's map-form declaration selects the test and the child-only script passes; the list form selects every test file; a wrong declaration adds runs and leaves `no-loader`; the hint with children on in the no-run and some-run cases; verdict and exit unchanged otherwise; `QUALITY_POLICY_VERSION` raised only if a state rule changes (say why).

## 020-36: node:test child processes are recorded

Use /worker. Shape: slice. Read `research/issue-194-gaps.md` (G6, G7) and spec D12.6 as amended.
Outcome: the node:test recorder reaches the processes a test starts, through `NODE_OPTIONS` as Vitest's does, so a daemon run records a child's reads and `squeal reach` shows the test reaching a script only its child runs. Start: where the node:test adapter passes the recorder on the command line (`src/runners/node-test/adapter-project.ts`, `src/runners/node-test/run/*`). Keep a project's own `NODE_OPTIONS` (018-36's preload case) working.
Raise `NODE_TEST_ADAPTER_VERSION` once with a validity case that shows a child's read entering the key (`test/keys/validity/cases/adapter/node-test.ts`).
Owns: `src/runners/node-test/**`, `src/runners/process/node-options.ts` if needed, their tests, the validity case. Leave alone: `src/core/run-evidence/**`, `src/core/scheduler/*`, gate files.
Done when (tests): G6 reproduced red before and green after (daemon records the child's read; reach shows it); key-format passes with the raised version; existing node:test adapter, recorder and 018-36 tests pass.

## 020-38: measure reuse where no daemon ever ran

Use /researcher. Read the board row keep-observed-without-daemon and `docs/specifications/011-core/research/run-evidence.md` (Difference 1). Question: in a clone where no daemon ever ran, how many completed files does a second `squeal code --base` read from the stores, against a clone with a daemon's observed reads; what each fix option costs (keeper records observed reads; daemon request when one serves; nothing). Probes in `/tmp` copies with their own HOME, below load 24, on the released Squeal. Write `research/no-daemon-reuse.md`; propose, do not decide.
