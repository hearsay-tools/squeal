# Wave 7: triage round 9

The human, 2026-10-21: widen 001-381 to any running tier a newer revision supersedes or a named wait is stuck behind, and dispatch it; approve gh-55 as 011-50. Catch-up speed stays the first priority (the human, 2026-10-19: agents ignore a Squeal that lags). R1 and W1 touch disjoint files and run in parallel.

## R1: 001-381, a running tier yields to a newer revision or a named wait

Use /researcher. Shape: research. Read board row 001-381 (cases a to c), spec 011 C4 (step 5, claims, the four-tiers turn) and C15 (Rank), `research/issue-63.md`, `research/issue-51.md`, `research/catch-up.md`, and issue [#69](https://github.com/hearsay-tools/squeal/issues/69) with its comment. Base: main at 9ba34257 or later.

Outcome: the rule by which a running tier yields at a file boundary, and the C4 and C15 sentences that say it.

Questions:
1. The seam. Where a running Vitest tier can stop at a file boundary today (`src/runners/vitest/gate.ts`; `#cancelBacklogs` in `src/core/scheduler/scheduler.ts`; `cancelsBacklog` in `backlog.ts`; 001-179's timeout split), and what a cancel costs on real child processes.
2. The rule. For each of cases a to c: split, cancel or leave; what finished files keep under the stability check; the fairness bound that stops repeated saves from cancelling the same files without end.
3. The frequency. How often an edit or a named wait lands mid-tier: replay cezar's store read-only from recorded durations. File-level `durationMs` may record only a fraction of a file's wall time (gh-62, `013-vitest-runner/research/issue-62.md`): check it against the run logs and say how far it biases the replay.
4. The gain on cezar: time to the named file's verdict under each rule.

Isolation and load: scratch clones by commit SHA, a scratch `HOME`, `XDG_RUNTIME_DIR`, `XDG_CONFIG_HOME`, `XDG_STATE_HOME` and store; a real store only read-only (`node:sqlite`, `readOnly: true`). No live measurement above a one-minute load of 8 on 24 CPUs; record the load beside every number; replays from recorded durations need no hold. Owns: `research/running-tier-yields.md`, `research/probes/running-tier-yields/`. Not yours: product code, `spec.md`, `status.md`, the board.

Done when: the findings file answers 1 to 4 and ends with a recommendation, the C4 and C15 sentences it would change, the question the human must decide, and the slice's done-when as tests.

## W1: 011-50, file-level `why` returns in seconds

Use /worker. Shape: slice. Read board row 011-50 and `research/issue-55.md`. Base: main at 9ba34257 or later.

Seam: `resolve()` in `src/core/status/why.ts`, the `findIndex` filter that removes repeats from `named`. First edit: keep a `Set` of each check's identity (what `sameCheck` compares) and drop repeats in one pass, in order of first appearance as now.

Tests first, red before: a new `test/status/why-scale.test.ts` seeds about 20,000 known checks plus one test file of 10 checks with 35 results each, and holds `why <that file>` to a bound that fails on the quadratic code (29 s measured) and passes on this host above a load of 70.

Owns: `src/core/status/why.ts`, the new test. Not yours: other `src/core/status/` files, the store, spec text, the board. No version bump and no key-format change: the coordinator bundles the row and raises the version.

Done when: the new test is red before and green after; `test/status/why-*.test.ts` pass unchanged; `npm run lint`, `npm run typecheck` and `squeal run --all --wait` pass, their output in your summary.

## W2: 011-51, a running tier yields to a newer revision or a named wait

Use /worker. Shape: slice. Read board row 011-51, spec 011 C4 step 5 and C15 (Rank, the wait's reasons) as amended 2026-10-21, and `research/running-tier-yields.md` (sections 1, 2 and "The slice's done-when, as tests"). Base: main at or after the commit that adds this brief.

Do the rule as C4 step 5 now states: a fast Vitest tier in flight is cancelled by a revision that re-keys every unfinished file of it; any tier but the backlog's turn yields, once per file and key, to an edit's work, a promoted file or a runner part waiting for the run, when its estimated remainder exceeds 30 s. Seam: `selectTier` and `#cancelBacklogs` in `src/core/scheduler/scheduler.ts`, `cancelsBacklog` in `backlog.ts`, `cancel` in `tiers.ts` (today `null` for an edit's tier). First edit: give an edit's tier a cancel and route both rules through one decision beside `cancelsBacklog`. Cut files are re-queued with their class (edit's work, catch-up, promoted), which the re-queue drops today. The wait's text: `src/core/status/next-step.ts`.

Tests first, red before: tests 1 to 9 of the findings' list, in `test/scheduler/` (test 9 with real Vitest child processes, as `lanes.test.ts`; it runs at any load). Test 10's live replay is the coordinator's after landing, not yours.

Owns: `src/core/scheduler/`, `src/core/status/next-step.ts`, their new tests. Not yours: `src/core/status/why.ts` (011-50, in review), the runners' adapters beyond the cancel they already expose, spec text, the board. No version bump and no key-format change.

Done when: tests 1 to 9 are red before and green after; the existing `test/scheduler/` tests pass unchanged or each change is named in your summary with its reason; `npm run lint`, `npm run typecheck` and `squeal run --all --wait` pass, their output in your summary.
