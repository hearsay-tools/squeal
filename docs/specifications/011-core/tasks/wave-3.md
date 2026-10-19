# 011 wave 3 (2026-10-19)

One row, the research 001-366 asks for before its code. Leave `docs/board.md`, `docs/specifications/*/status.md`, `spec.md`, `package.json` versions and `plugins/*/dist` to the coordinator. No product code.

## R1: 001-366, what a backlog tier's budget should bound when its files run in parallel

Use /researcher. Shape: research. Read the board row 001-366 (under Feature 011; it kept its 001 number at the split), spec 011 C4 step 5 and C10 Capacity, `../005-agent-adoption/lessons.md` proposed row 5, and `src/core/scheduler/backlog.ts`, `tiers.ts` (`selectTier`), `claims.ts` (`backlogSize`), `src/core/capacity/pool.ts`.

Outcome: a recommended budget rule, sized by the tier's expected wall time under the workers it will run with, and the interrupt-latency cost of it, with numbers.

Evidence the human saw on 2026-10-19 (cezar main daemon, 0.1.222, load 3 to 5 on 24 CPUs): a `run --all` tail ran tiers of 200, 163, 71, 36, 18, 9, then 7 to 2, then one file each (136 to 504 s), one fork busy, about 16 % of one CPU.

Questions:
1. Which latencies the 300 s serial budget bounds today, per runner: an edit's tier behind a backlog tier (Vitest's cancel, node:test's run to the end, pytest), a departing daemon waiting for its tier (D10), results stored only at tier end, a tier meeting `runner.timeoutMs` (001-179's split).
2. The grant is taken after the files are picked (`capacity.take(picked.length)`). Can the selection know its worker count first (the fair share, the project's `maxWorkers`, the floor of 2)? Which estimate of wall time holds, for example the longest file or the sum over workers, whichever is larger?
3. Measure today's rule against a prototype rule on a synthetic fixture of heavy, mostly idle test files (60 to 150 s, one Vitest and one node:test project): time to finish the backlog, and the delay of an edit landing mid-tier in each runner. A cezar scratch clone is optional, only below load 8 on 24.

Isolation: scratch clones by commit SHA, a scratch `XDG_RUNTIME_DIR`, `XDG_CONFIG_HOME` and store, never the real pool directory or a real session. Hold measurements while the one-minute load is above 8 on 24 and record the load beside every number. Related, out of scope: 001-381 (an edit splits a running backlog tier).

Owns: `docs/specifications/011-core/research/backlog-wall-budget.md`, `docs/specifications/011-core/research/probes/backlog-wall-budget/`.

Done when: the findings file answers 1 to 3 under the findings rules of `../001-core-loop/research/README.md` and ends with the rule, the C4 step 5 sentences it changes, and a slice's done-when as tests.

## W1: 001-366, a backlog tier fills one round, then 120 s of estimated wall time

Use /worker. Shape: slice. Read the board row 001-366, spec 011 C4 step 5 and C10 Capacity as amended 2026-10-19 (`status.md`), and `research/backlog-wall-budget.md`, its Recommendation above all.

Outcome: a backlog tier takes one file per worker it will run with, then more while `sum / W + (1 − 1/W) × longest` of last-known durations stays within 120 s (or half of `runner.timeoutMs`), so heavy files run side by side instead of one per tier.

Seams: `src/core/scheduler/backlog.ts` (`BACKLOG_TIER_BUDGET_MS`, `backlogBudget`), `selectTier` in `tiers.ts`, `src/core/scheduler/capacity.ts`, `src/core/capacity/pool.ts`. Lead: the research's `probes/backlog-wall-budget/prototype.patch`, a read-only `offer(want)` on the pool and the trim at the grant; replace its greedy makespan with the list-scheduling bound above and add the first round. W comes from the runner: a width hook on the adapter contract (`src/core/types/runner.ts`) answered by Vitest's `tierWidth` (`src/runners/vitest/width.ts`) and by `runner.tierSize` for node:test and pytest, whose backlog tiers then ask the pool for `min(files, runner.tierSize)` permits (`src/core/daemon/node-test-runners.ts`, `pytest-runners.ts`).

Owns: those files, their tests, new tests under `test/scheduler/`. Write `tasks/001-366/notes.md`. Leave the slot lanes of R2 alone.

Done when: the seven tests of the research's "Slice done-when" pass, each red on main first where it can be; `npm run lint`, `npm run typecheck`, `squeal run --all --wait` green, its output pasted.

## R2: 011-21, per-worker streaming lanes instead of tier barriers

Use /researcher. Shape: research. Read board row 011-21 and 001-381, spec 011 C4 (steps 4 and 5, the stability check, the completion barrier, claims), C9, C10 Capacity, and `research/backlog-wall-budget.md`.

Outcome: whether a lane can run as W slots, each starting the next queued file when it frees, results stored per file, an edit's file taking the next free slot, with no barrier between tiers; the design for node:test and pytest, and whether Vitest can follow.

Questions:
1. node:test and pytest (Squeal spawns their processes): what replaces the tier for the stability snapshot, the completion barrier, claims, the pool lease (held per slot, or a lease that grows and shrinks), checkpoint progress and the departure rule. Prototype it on node:test and measure an edit's wait mid-backlog against today's and against W1's rule.
2. Vitest: one run per instance (`runFiles` awaits `runningPromise`, 4.1.10 and 5.x). Weigh a custom pool that keeps workers and receives files, several instances per lane, and two instances alternating, by memory, startup, global setup and correctness. Measure what you prototype; cite source for the rest.
3. The gain over W1's rule on cezar's recorded tail (the research's `cezar-701f50.json`) and on its node:test lane.

Isolation and load: as R1. Owns: `research/streaming-lanes.md`, `research/probes/streaming-lanes/`.

Done when: the findings file answers 1 to 3 and ends with a recommendation per runner, the C4 sentences it would change, and a slice's done-when as tests.

## W2: 001-366, review of cand/0.1.223

Use /reviewer. Shape: review. Pinned to the `cand/0.1.223` SHA named in the spawn; the range is `origin/main..<sha>`: W1's six commits, the release commit (version 0.1.223 and the bundles) and this brief.

Read W1 above, spec 011 C4 step 5 and C10 Capacity as amended 2026-10-19 (`status.md`), `research/backlog-wall-budget.md` (Recommendation and Slice done-when) and `tasks/001-366/notes.md`. Check that:
- a backlog tier takes one round at its width, then files while `sum / W + (1 − 1/W) × longest` stays within `backlogBudget`, and edit tiers are unchanged;
- `offer` in `src/core/capacity/pool.ts` takes nothing and matches `acquire`'s arithmetic; a grant below the offer trims the picked tail and the lease, and a daemon waiting for capacity still holds no claim;
- node:test and pytest tiers hold and state a demand of at most `runner.tierSize`; slow tiers are unchanged;
- Vitest's width honours the project's own `maxWorkers` and the floor of 2;
- the seven done-when tests prove the rule (red on main where the notes say so), and `KEY_FORMAT_VERSION` 14 is right against the released 13.

Run `flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4` once in the candidate tree; a file that fails loaded and passes alone is named. Write `reviews/wave-3.md` with a PASS or FAIL verdict and commit it.

## W2r: 001-366, re-review of the repaired cand/0.1.223

Use /reviewer. Shape: review, bounded. Pinned to the `cand/0.1.223` SHA named in the spawn; the repair is `79f1d5fe..<sha>`. Read `reviews/wave-3.md` (B1, S1, the settled behaviour list) and append a "Re-review" section to it.

Check only that: B1 is closed (`RunnerAdapter.tierPart`, `BacklogWall` summing parts, the composite and every wrapper passing it through, the first round the first part's) and its regression test is red without the fix; S1 is closed; the single-part behaviour you settled is unchanged; the `KEY_FORMAT_VERSION` 14 re-pin and the regenerated bundles match the tree. New findings outside the repair are recorded for later rows, not blockers. The coordinator's gate on this SHA: 736 files passed, 1 skipped, 803 s. Run one `flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4` only if the repair delta gives you reason to doubt it, and say which.

## W2r2: 001-366, third round (the human, 2026-10-19), bounded to R1

Use /reviewer. Shape: review, bounded. Pinned to the `cand/0.1.223` SHA named in the spawn; the delta is `4b8a12ae..<sha>`. Read `reviews/wave-3.md` (B1, S1, Re-review R1) and append a "Third round" section to it.

Check only that R1 is closed: the first round is granted only while the tier holds one part (`BacklogWall.take` in `src/core/scheduler/backlog.ts`); the A, B, A case selects `[2, 1]` through the scheduler (`test/scheduler/backlog-wall.test.ts`) and is red on `dc3135bc`; single-part tiers keep the full first round, including a round over B; the smaller-grant replay uses the same rule; the `KEY_FORMAT_VERSION` 14 re-pin and the bundles match the tree. The coordinator's gate on this SHA is reported in the spawn. Anything outside R1 is recorded for a later row, not a blocker.
