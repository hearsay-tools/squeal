# 015 wave 16: tests without coverage never leave a stale verdict, and say nothing to the agent

Briefed by coordinator 52e58f23 on 2026-10-26, from issue #106 and `research/issue-106.md`. The human chose the full fix the same day ("Full fix") and added: "make sure node test files don't spam anything to the agent when coverage is on", then "Not saying it should send nothing. But maybe it should say it once". One worker and one researcher, on disjoint files.

## W1: 015-75

Use /worker. Shape: repair. Starts from main 0.1.352. Outcome: a source that only tests without coverage (node:test today, pytest too) load reads `unknown` with its reason, never a kept `untested` or CRAP verdict, and the agent hears it once, at the session start, and never again in that session.
- Read `research/issue-106.md` (all of it, and `probes/issue-106/`), board row 015-75, spec 015 D9 (First judgement, Pending and unknown, Joining) and D6.
- **Part 1, the stale verdict.** Lead: `src/core/code/crap/walk.ts:65-67`. When a source turns `pending` or `unknown` and its loader set differs from the one its last judgement saw, its `crap` and `uncovered` states go to `pending` or `unknown`, with no transition line.
- **Part 2, preload-only modules.** A path in a node:test project's preload closure counts as loaded by each test file of that project (`loaders.ts:180`). If this needs a runner change outside your files, ask before you make it.
- **Part 3, the wait.** A node:test-only source turns `unknown` within D9's 36 s in a live daemon, with no restart (`pass/index.ts:298-312`, `retryLater`). Start with a fake-clock test over `createCodePass`.
- **Part 4, words.** `squeal code` prints `not measured: <runner> gives no coverage` for such a function, and no CRAP value. The agent hears it once per session, at the start (the coordinator's decision, 2026-10-26, after the human's "maybe it should say it once" and "think about it and decide"): when coverage is on and the project has a node:test or pytest project, the session-start code line (the one that says `Complexity: N functions over 20; squeal code lists them`) adds one sentence, for example `Coverage comes from Vitest runs only; functions that only node:test or pytest tests run read not measured.` No later hook message (PostToolUse, PostToolBatch, Stop, the told summary) names, counts, or says "waits for coverage records" about these sources. Why: the agent cannot act on the fact, passing results already stay silent, and the session start already gives the code status once, so no new per-session state is needed.
- **Owns.** `src/core/code/**`, `src/core/delivery/code-*.ts`, `src/cli/code*.ts`, `src/harness/shared/stop-code.ts`, and `test/code/**`. Leave `src/runners/**` alone unless the parent agrees.
- **Done when.** Regression tests, each red first: the `e-order` save order; a preload-only module; the live wake within 36 s; a node:test-only project with coverage on whose session start gives the one sentence and whose later hook messages hold no coverage text about these sources. Notes in `tasks/015-75/notes.md`, with the D9 and D6 text you propose (the coordinator amends the spec). Lint, typecheck, and `squeal status --wait 60000 <changed-path>...`; paste both. No full suite. Do not build bundles or raise the version.

## R1: 015-76 research: coverage under node:test

Use /researcher. Outcome: the evidence to decide whether, and how, Squeal takes coverage from its node:test runs.
- Read `research/coverage-collection.md` Q3 and Q4, spec 015 D8 (the record), spec 003 D5 (one process per file), and `src/runners/node-test/`.
- **Questions.** (1) `NODE_V8_COVERAGE` per process or the `test:coverage` reporter event: which maps to D8's record (blob id, covered lines bitset, function hit bits) with less work? (2) A project that loads TypeScript through a loader (tsx, as in `test/fixtures/node-test/`): are the offsets right, or are source maps needed? (3) Child processes inherit the variable: how are their records kept out, or counted? (4) The cost per test file against a run without coverage, on 20 to 40 files of this repository's node:test fixtures.
- **Rules.** Isolated `HOME` under `/tmp/r-015-76/`; no `evals/bin` script; make no load on purpose; start no measured run while the one-minute load is over 24, and give the load per run. Write `research/node-test-coverage.md` and probes under `research/probes/node-test-coverage/`; commit both. No product code, no spec, status or board edit.

## 015-77: review of candidate 0.1.354 (wave 16)

Use /reviewer. Candidate `cand/0.1.354`, pinned to the SHA in the spawn, on main 0.1.352: six 015-75 commits, and the version and bundles. Write `reviews/0.1.354.md` in this spec and commit it on your branch.

Read row 015-75, W1 above, `tasks/015-75/notes.md` (its decisions and the proposed D9 and D6 text), `research/issue-106.md`, and spec 015 D6 and D9.

Check, with proof where you can:
1. **The stale verdict.** The `e-order` save order (`research/probes/issue-106/`) ends `unknown`, with no kept `untested` or CRAP, without a restart; an upgrade from a summary with no loader set clears it. A `pending` source keeps its states, so a Vitest `FAIL untested` then `PASS` still tells both lines.
2. **Runners without coverage.** A node:test or pytest test file makes its sources `unknown` at once, not after 36 s; a preload-only module counts as loaded by its project's test files; `RECORDING_RUNNERS` is the one place that says which runners give records.
3. **The wake.** A source waiting for a record turns `unknown` within 36 s in a live daemon.
4. **Said once.** The session-start code line gives the one sentence only while coverage is on and such a runner is configured; no later hook message names, counts or says "waits for coverage records" about these sources; `squeal code` prints `not measured: <runner> gives no coverage` with no CRAP value.
5. **Shared files.** The `ClosureIndex.environment` and `keyIndex()` edit is additive and changes no scheduler behaviour.
6. **Keys.** No key, store-format or policy change; the summary stays version 1.

Checks (`docs/process.md`): lint, typecheck, Squeal's affected results or targeted `npx vitest run` of files you name. No full suite. Do not run `npm run build` in your tree. Name the candidate's CI result or say it is pending. Label findings proven, plausible or unverified. Verdict PASS or FAIL; only a proven break blocks.
