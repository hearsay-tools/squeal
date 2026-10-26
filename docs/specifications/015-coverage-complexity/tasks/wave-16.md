# 015 wave 16: tests without coverage never leave a stale verdict, and say nothing to the agent

Briefed by coordinator 52e58f23 on 2026-10-26, from issue #106 and `research/issue-106.md`. The human chose the full fix the same day ("Full fix") and added: "make sure node test files don't spam anything to the agent when coverage is on", then "Not saying it should send nothing. But maybe it should say it once". One worker and one researcher, on disjoint files.

## W1: 015-75

Use /worker. Shape: repair. Starts from main 0.1.352. Outcome: a source that only tests without coverage (node:test today, pytest too) load reads `unknown` with its reason, never a kept `untested` or CRAP verdict, and the agent's hook messages say nothing about it.
- Read `research/issue-106.md` (all of it, and `probes/issue-106/`), board row 015-75, spec 015 D9 (First judgement, Pending and unknown, Joining) and D6.
- **Part 1, the stale verdict.** Lead: `src/core/code/crap/walk.ts:65-67`. When a source turns `pending` or `unknown` and its loader set differs from the one its last judgement saw, its `crap` and `uncovered` states go to `pending` or `unknown`, with no transition line.
- **Part 2, preload-only modules.** A path in a node:test project's preload closure counts as loaded by each test file of that project (`loaders.ts:180`). If this needs a runner change outside your files, ask before you make it.
- **Part 3, the wait.** A node:test-only source turns `unknown` within D9's 36 s in a live daemon, with no restart (`pass/index.ts:298-312`, `retryLater`). Start with a fake-clock test over `createCodePass`.
- **Part 4, words.** `squeal code` prints `not measured: <runner> gives no coverage` for such a function, and no CRAP value. The agent hears it once (the human, 2026-10-26: "maybe it should say it once"): the first hook message that would count such sources gives one line, for example `coverage not measured for files only node:test tests load; squeal code lists them`, and no later hook message (PostToolUse, PostToolBatch, Stop, the told summary) repeats it, counts these sources, or says "waits for coverage records" about them. Reuse the once-per-session rule an existing notice uses, if there is one.
- **Owns.** `src/core/code/**`, `src/core/delivery/code-*.ts`, `src/cli/code*.ts`, `src/harness/shared/stop-code.ts`, and `test/code/**`. Leave `src/runners/**` alone unless the parent agrees.
- **Done when.** Regression tests, each red first: the `e-order` save order; a preload-only module; the live wake within 36 s; a node:test-only project with coverage on whose hook messages give the one line once and no other coverage text. Notes in `tasks/015-75/notes.md`, with the D9 and D6 text you propose (the coordinator amends the spec). Lint, typecheck, and `squeal status --wait 60000 <changed-path>...`; paste both. No full suite. Do not build bundles or raise the version.

## R1: 015-76 research: coverage under node:test

Use /researcher. Outcome: the evidence to decide whether, and how, Squeal takes coverage from its node:test runs.
- Read `research/coverage-collection.md` Q3 and Q4, spec 015 D8 (the record), spec 003 D5 (one process per file), and `src/runners/node-test/`.
- **Questions.** (1) `NODE_V8_COVERAGE` per process or the `test:coverage` reporter event: which maps to D8's record (blob id, covered lines bitset, function hit bits) with less work? (2) A project that loads TypeScript through a loader (tsx, as in `test/fixtures/node-test/`): are the offsets right, or are source maps needed? (3) Child processes inherit the variable: how are their records kept out, or counted? (4) The cost per test file against a run without coverage, on 20 to 40 files of this repository's node:test fixtures.
- **Rules.** Isolated `HOME` under `/tmp/r-015-76/`; no `evals/bin` script; make no load on purpose; start no measured run while the one-minute load is over 24, and give the load per run. Write `research/node-test-coverage.md` and probes under `research/probes/node-test-coverage/`; commit both. No product code, no spec, status or board edit.
