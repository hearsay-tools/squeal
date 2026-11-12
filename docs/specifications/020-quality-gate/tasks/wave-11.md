# Wave 11 (the human, 2026-11-12: #193 "Build it"; #194 "Trial, then research"; follow-ups "Build both")

Base: main at the commit that adds this file. Host load was 75 on 24 CPUs at dispatch: run targeted tests only, and run any live probe only when the one-minute load is below 24.

## 020-31: the gate's closure and module-hook notes speak to this check (#193)

Use /worker. Shape: slice. Read `research/issue-193.md` and spec D14.4, D7.
Outcome: after selection, the gate's stderr says how many of a project's incomplete-closure test files this check selected ("0 of 19 are in this check"); the gate JSON lists every such file per project, selected or not; the module-hook hint names the top-level `inputs` key in `squeal.config.json` and its shape (a glob list or a test-glob map).
Start: the notes come from the runner adapters at open (`src/runners/node-test/graph/preload-notes.ts`, `adapter.ts`, `src/runners/pytest/adapter.ts`); the gate prints them through its note sink before `select`. Lead: let the gate collect the closure lists from the sink and print one scoped line after selection.
Owns: `src/core/code/gate/report.ts`, `select*.ts`, `collect.ts`, `src/cli/code-gate.ts`, the runners' note text files above, their tests. Leave alone: `src/core/code/gate/keep.ts`, `keep-write.ts`, `stored.ts` (spec 021 row 021-20 runs there), `src/core/store/*`.
Done when: each note appears once per project per run; selected and unselected cases, more than three files, module hooks, plain and `--json`; verdict and exit unchanged; JSON stays valid on stdout.

## 020-29 and 020-30: two follow-ups from 0.1.447

Use /worker. Shape: repair.
- 020-29 (review `0.1.444-r2.md` N1): a child process of a no-provider Vitest worker installs no `node:inspector` watch and writes no log; with a provider, children still watch. Start: `src/runners/vitest/ci-runtime/inspector.cjs` (about line 84, the `.no-provider` file lookup by pid). Test in `test/runners/vitest/ci-inspector-watch.test.ts`.
- 020-30: `test/code/gate/keep-busy.test.ts`, "keeps the file once the lock is freed within the bound, and names the holder first", once read "the holder is not known" on Node 26. Make the test wait until its holder's lock is visible (as `lockHolders` sees it) before the gate starts. Test file only.
Owns: `inspector.cjs`, `ci-inspector-watch.test.ts`, `keep-busy.test.ts`. Leave alone: `src/core/code/gate/*` (spec 021 row 021-20), `src/core/store/*`.
Done when: the new child cases pass; the keep-busy case passes 20 times in a row on Node 24 and 26 (`node_modules/.bin/vitest run <file> --repeat` or a loop), at load below 24.

## 020-32: Cezar trial of the existing configuration for its packaged tests (#194; draft diff only)

Use /worker. Shape: survey, then a draft. As `tasks/020-26c/`: spec 018's coordinator (3739e45a) opens the Cezar pull request; this row writes only the diff and a README. Never edit `~/projects/cezar`; clone hearsay-tools/squawk under `/tmp`.
Outcome: a diff against squawk `origin/main` that adds a node:test entry for the packaged suite (`scripts/test-package.mjs`, `release.test.ts`) with a `prepare` command and `coverage.children: true` in `squeal.config.json` (spec D15, D12), and a dispatch-only CI step that runs `squeal code --base origin/main --json` on that config and uploads the report. Read `research/issue-194.md` (case 2, question 5), `research/build-wrapper.md`.
Find out first, from the clone: whether the suite splits into a build plus a plain `node --test` run; whether the TypeScript test runs under node:test; whether `scripts/release.mjs` runs unbundled in the child. Say in the README what the trial can and cannot show.
Owns: `docs/specifications/020-quality-gate/tasks/020-32/` only. Done when: the diff applies to squawk `origin/main`; Cezar's workflow tests pass in the clone; the README names every change and the dispatch command. Run no full Cezar suite locally.

## 020-33: research the two gaps #194 left open

Use /researcher. Read `research/issue-194.md` (cases 4, 6, 9 and Open questions) and `specifications/015-coverage-complexity/research/issue-144.md`.
Questions: (1) why the D14.4 pre-run hint is missing when a second node:test entry exists and no file is selected; (2) how the gate could select a test for an edit to a script that only a child process runs (overlap with #144): what evidence names that test, what it costs, and what it risks. Write `research/issue-194-gaps.md`; propose rows, no spec text. Probes in `/tmp`, own HOME, only below load 24; reuse `research/probes/issue-194/`.
