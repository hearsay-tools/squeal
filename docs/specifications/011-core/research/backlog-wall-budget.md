# 001-366: what a backlog tier's budget should bound when its files run in parallel

Researcher R1 of 011 wave 3, 2026-10-19. Brief: `tasks/wave-3.md` R1 (moved from 001 wave 19 at `036be0a0`). Read: `docs/vision.md`, `docs/styleguide.md`, 011 C4 step 5, C9, C10 Capacity, `../005-agent-adoption/lessons.md` proposed row 5, board rows 001-366 and 001-381.

Versions: Squeal `fb6d3164` (0.1.222), the scheduler and runners as read at `036be0a0` (no `src/` change between them). Vitest 5.0.3, Node v24.21.0, 24 CPUs. The live probe ran a scratch clone of `fb6d3164` built with `npm run build`, its bundle `plugins/claude-code/dist/cli/squeal.mjs`, with HOME, `XDG_RUNTIME_DIR`, `XDG_CONFIG_HOME` and `XDG_STATE_HOME` under `/tmp/bwb/s-<arm>` and each fixture's store in its own `.git/squeal`; no real pool, store or session was written. Cezar's store was only read, through a `readOnly` connection. The one-minute load is given beside each measurement; it stayed between 2.58 and 7.83 on 24, below the brief's hold at 8.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Which latencies the 300 s serial budget bounds today, per runner | Not an edit's in Vitest: the cancel bounds it to at most about 6 s whatever the tier (0.36 s measured). An edit's wait in node:test and pytest, which run to the end; a departure (C9); a result's wait for its tier's end; another daemon's wait for its share (C10); the margin to `runner.timeoutMs`. Because the sum is serial, each is bounded by about `max(longest file, 300 s / W)` in practice, and heavy files run one round per tier, serially | read in source code, verified by experiment |
| 2 | Can the selection know its worker count first; which wall estimate holds | Yes, but not from today's API: the pool computes the share only inside `acquire`, the project ceiling is the Vitest adapter's, node:test and pytest ignore the grant and run `runner.tierSize` wide. `max(longest, sum/W)` underestimates (a 54-file node:test tier on cezar: 93 s estimated, 168 s measured). `sum/W + (1 − 1/W) · longest` holds for any start order | read in source code, verified by experiment, inferred |
| 3 | Today's rule against a prototype on heavy idle files | Backlog 830 s today against 250 s with the prototype. An edit mid-tier: Vitest current after 0.36 s in both; node:test after 97.7 s today and 149.9 s with the prototype | verified by experiment |

## Findings

### 1. What the 300 s serial budget bounds today

The budget (`src/core/scheduler/backlog.ts:14`, `backlogBudget` at `:42`) is `min(300 s, runner.timeoutMs / 2)` of last-known file durations summed serially; unknown durations count 0, the first file is always taken (`tiers.ts:172`). The tier's grant is then `capacity.take(picked.length)` (`tiers.ts:181`), so a tier of n files runs at most n wide. Wall time is therefore at most the serial sum, and for n ≤ W it is the tier's longest file. *read in source code.*

- **An edit's tier behind a backlog tier, Vitest.** The edit cancels the backlog tier in its lane (`cancelsBacklog`, `backlog.ts:27`): `cancelCurrentRun`, forced after 1 s, the instance abandoned 5 s later (`src/runners/vitest/run.ts:18`, `:20`). The wait is at most about 6 s plus the edit's own run, whatever the budget. Measured: the edit's Vitest result was current 0.36 s after the write in both arms (finding 3). What scales with the tier is the work a cancel throws away: files in flight are re-queued uncounted (`recordTier`). *read in source code, verified by experiment.*
- **node:test and pytest.** Neither receives the cancel: both adapters pass only `runOptions.stop` as their signal (`src/runners/node-test/adapter-project.ts:170`, `src/runners/pytest/adapter-run.ts:75`), so an edit in their lane waits for the rest of the tier. Both run `runner.tierSize` processes at once (`src/core/daemon/node-test-runners.ts:140`, `pytest-runners.ts:162`; pytest in batches of 5, `001-core-loop/research/host-capacity.md`), not the grant. This is the one latency the budget bounds for an edit: today at most the serial sum, about `max(longest, 300 s / 4)` in practice. *read in source code.*
- **A departing daemon (C9).** "A tier in flight finishes and stores its results, then the daemon exits" in every lane; `squeal stop` cancels instead (001-367). Bounded by the tier's wall time. *read in source code (spec).*
- **Results stored at tier end (C4).** Every file of a tier waits for its slowest: a checkpoint's progress and a file's verdict move only at tier boundaries. Today's shortest-first order with a serial budget keeps a tier's files of similar length; a wall budget lets short and long files share a tier. *read in source code; inferred for the effect.*
- **Another daemon's share (C10).** "A running tier is never preempted … a warmup … waits at most one of its backlog tiers (D5 step 5's bound) for its share." Bounded by the holder's tier wall time. *read in source code (spec).*
- **`runner.timeoutMs` (001-179).** Half the timeout caps the serial sum, so with known durations a tier times out only when its files run more than twice as slow as last time; unknown durations count 0, so a first baseline's tier is not bounded by the budget at all and the split is its only net. *read in source code.*

Cezar's main worktree, checkpoint `701f50` at 0.1.222 (store, read-only; `probes/backlog-wall-budget/results/cezar-701f50.json`): from 12:59:52Z the Vitest lane ran tiers of 200, 200, 163, 71, 36, 18, 9, 7, 5, 4, 4, 3, 2, 2, then 1 file each from 13:15:35Z, the last still running at 13:49:12Z. Every finished tier ended `completed`: the decay is the serial budget, not the timeout split. Each tier from 9 files on lasted exactly its longest file (43 s for 9 files whose longest took 42 s; 410 s for one file), and its files' times summed to 132 to 305 s, the budget. The 11 single-file tiers that ended took 84 to 410 s each, 2,015 s in all, one fork busy. *verified from the store.*

### 2. Knowing the worker count before the files are picked

- **The fair share** is computed only inside `LockFilePool.acquire` (`src/core/capacity/pool.ts:127`) from the marks and the held leases. A read-only `offer(want)` with the same arithmetic, taking nothing, is 19 lines (prototype, `probes/backlog-wall-budget/prototype.patch`). It can race another daemon's take; the prototype then trims the picked tail to fit the budget at the grant actually taken, before `startTier`, so a waiter still holds no claim. Taking first instead would make a tier whose picks all settle as inherited hits wait for capacity. *read in source code, verified by experiment (the prototype ran).*
- **The project's `maxWorkers` and the floor of 2** live in the Vitest adapter: `tierWidth(grant, ceiling)` is at least 2 and never above the project's own value, 1 kept as 1 (`src/runners/vitest/width.ts:11`). The scheduler sees neither, so the width must come from the adapter: a run of one file still gets 2 Vitest workers, a project that set 4 never gets 23. Projects of different `sequence.groupOrder` run one group after another (`Widths`), which a single estimate does not model. *read in source code.*
- **node:test and pytest ignore the grant** but ask the pool for one permit per file: the probe's prototype arm published `want 26, grant 23` (17 Vitest files and 9 node:test files) while 4 node:test processes ran (`ps`, every 5 s). On cezar the Vitest lane's tier after 13:00:06Z started at 13:02:55Z, the second the 54-file node:test tier ended; that tier asked for up to 54 permits and ran 4 wide. Whether its permits were what held Vitest back is not determined: other worktrees ran tiers of 4 meanwhile. *verified by experiment (the ask); inferred (cezar's wait).*
- **Which estimate holds.** node:test starts its files in the tier's order (`run.ts`, a shared queue `concurrency` wide), Squeal's shortest first, so the longest starts last. Vitest re-sorts with its own sequencer: failed first, then longer first from its results cache, unknown first, larger files first (`BaseSequencer.sort`, `vitest/dist/chunks/index.DpLw24bj.js:13385`, 5.0.3). Squeal's instance keeps that cache: the fixture's `node_modules/.vite/vitest/<hash>/results.json` held every file after the baseline (*verified by experiment*). The lower bound `max(longest, sum/W)` underestimates: replayed over cezar's 54-file node:test tier (sum 296 s, longest 93 s, W = 4) it gives 93 s against 168 s measured; the greedy schedule in Squeal's order gives 117 s, `sum/W + (1 − 1/W) · longest` (list scheduling's bound, any order) 144 s. The per-file times there are sums of check durations, which omit process start and collection, so all three are low. In the offline model the lower bound let tiers run to 354 s against a 300 s budget; the list-scheduling bound never exceeded it. *read in source code, verified by replay (`model.mjs`, `cezar-replay.mjs`).*

### 3. Today's rule against the prototype, on heavy idle files

Fixture (`make-fixture.mjs`): 16 Vitest files sleeping 60 to 150 s and 8 node:test files sleeping 60 to 150 s, one quick test file per runner; baseline first (durations unknown, one tier per lane), then `run --all --force --wait` with every duration known; in the edit arms both quick sources are edited 100 s into it. Prototype: take while the greedy schedule's makespan over the lane's width stays within 300 s, width = `max(2, offer)` for Vitest and `runner.tierSize` for node:test (`SQUEAL_PROTO_WALL=1`). A lone daemon: the offer is 23.

| Arm (load at start, end) | Vitest lane | node:test lane | Backlog done | Edit 100 s in: Vitest current after | node:test current after |
|---|---|---|---|---|---|
| today, no edit (2.86, 4.66) | 7 tiers: 5, 3, 2, 2, 2, 2, 1 files; 830 s | 4 tiers: 4, 2, 2, 1; 485 s | 830 s | | |
| prototype, no edit (2.86, 5.29) | 1 tier of 17; 150 s | 1 tier of 9; 250 s | 250 s | | |
| today, edit (4.27, 3.62) | 9 tiers; the tier 78 to 100 s cancelled, 3 files re-queued | 2 files 86 to 198 s, then the edit's | 852 s | 0.36 s | 97.7 s |
| prototype, edit (4.27, 6.86) | the 17-file tier cancelled at 100 s: 8 kept, 9 re-run 100 to 251 s | 1 tier of 9, 0 to 250 s, then the edit's | 251 s | 0.36 s | 149.9 s |

Raw output: `probes/backlog-wall-budget/results/{today,proto}-{noedit,edit}.json`; pool marks and node:test process counts every 5 s: `results/marks.log`. The one-minute load stayed between 2.58 and 7.83 on 24 CPUs.

The prototype's Vitest lane filled one tier of 17 files and finished in 150 s, its longest file; today's took 830 s in 7 tiers, the model's 828 s. The node:test lane, 4 wide either way, went from 485 s to 250 s. The costs: an edit 100 s into the backlog waited 149.9 s in node:test for the lane's one tier to end, against 97.7 s today; and the Vitest cancel threw away 9 files in flight, so that lane took 251 s instead of 150 s, where today's cancel cost 22 s (830 to 852 s).

The offline model (`model.mjs`, `sweep.mjs`, same order and widths; light and medium suites added) gives the cost per suite shape. "Round": a tier always takes one file per worker, then more while `sum/W + (1 − 1/W) · longest ≤ B`. Totals are the lane's backlog time, the longest tier bounds every wait in finding 1, and the mean is the wait of an edit landing at a random moment in a lane that runs to the end:

| Suite, W | today (serial ≤ 300 s) | wall ≤ 300 s (prototype) | round, B = 120 s |
|---|---|---|---|
| cezar's tail, 47 files live, 23 | 2,092 s; longest 409; mean 102 | 908; 409; 161 | 507; 409; 175 |
| cezar's tail, 6 | 2,157; 409; 101 | 1,228; 409; 159 | 951; 409; 122 |
| 30 files 80 to 145 s, 23 | 1,644; 145; 60 | 238; 238; 119 | 274; 145; 69 |
| 30 files 80 to 145 s, 4 | 1,644; 145; 60 | 940; 287; 124 | 940; 145; 60 |
| 400 files 2 to 40 s, 23 | 460; 40; 14 | 242; 198; 85 | 296; 113; 44 |
| 400 files 2 to 40 s, 4 | 1,423; 95; 40 | 1,287; 299; 132 | 1,404; 118; 55 |
| 600 files 0.1 to 3 s, 23 | 25; 15; 5 | 23; 16; 6 | 23; 16; 6 |
| fixture node:test, 8 files, 4 | 484; 150; 63 | 249; 249; 124 | 249; 150; 65 |

*verified by replay; the model assumes every file takes its last-known time and the workers never idle while files wait.*

## Recommendation for Squeal

Budget a backlog tier by its expected wall time under the workers it will run with, and let it always fill one round. The tradeoff that decides it: a wall budget of 300 s finishes a heavy backlog 1.7 to 7 times sooner but lets every tier grow toward 300 s, which a node:test or pytest edit, a departure and another daemon's share then wait for; one round plus a 120 s budget keeps nearly all of the gain (cezar's tail at 23 workers: 2,092 s to 507 s) and bounds the tier by `max(120 s, its longest file)`, never longer than today's `max(300 s, its longest file)`.

**The rule.** A backlog tier's width W is what its runner will run at the grant the pool offers before selection: Vitest `tierWidth(offer, the projects' smallest ceiling)`, node:test and pytest `runner.tierSize`, never more than the files. It takes queued files in C4 order up to `runner.backlogTierSize`: the first W always (one round), then a file while `sum/W + (1 − 1/W) · longest` of the last-known durations stays within 120 s, or half of `runner.timeoutMs` when less; a file of no known duration counts 0. After the take, a grant below the offer trims the tail to the same rule at the grant. node:test and pytest backlog tiers ask the pool for `min(files, runner.tierSize)` permits.

**C4 step 5 sentences it changes.**

- "takes every queued file up to `runner.backlogTierSize` (default 200) and up to 300 s of last-known file durations, or half of `runner.timeoutMs` when that is less, summed as if the files ran one after another" becomes: "takes every queued file up to `runner.backlogTierSize` (default 200): one per worker it will run with, then more while their last-known durations' estimated wall time, `sum / W + (1 − 1/W) × longest` over W workers, stays within 120 s, or half of `runner.timeoutMs` when that is less. W is the runner's width at the grant the pool offers (C10): Vitest's `maxWorkers` for it, at least 2 and never above the project's own; node:test's and pytest's `runner.tierSize`."
- "The budget limits the files' last-known run time, not the tier's wall-clock time: a file with no known duration counts 0, the first file is always taken whatever its duration" becomes: "The budget limits the tier's estimated wall time, not its real one: a file with no known duration counts 0, the first round is always taken whatever its durations".
- "so a departure waits for the running backlog tier however long it takes; the budget bounds only its files' last-known run time" becomes "…; the budget bounds only its estimated wall time, at most `max(120 s, its longest file)`".
- C10's "waits at most one of its backlog tiers (D5 step 5's bound)" stands, with the bound above.

**Slice done-when, as tests** (`test/scheduler/`, fake runner with fixed durations, injected pool):

1. A backlog of 16 files of 60 to 150 s last-known, offer 23: one tier of 16 files, the grant at least 16.
2. The same backlog, offer 4: the first tier holds 4 files and every tier's `sum/W + (1 − 1/W) · longest` is within 120 s or it holds one round only.
3. A grant below the offer: the started tier is the prefix that fits at the grant, the rest stays queued in order, the lease shrunk to it.
4. Vitest width from the adapter: a project with `maxWorkers: 4` and an offer of 23 gives W = 4; an offer of 1 gives W = 2.
5. A node:test backlog tier of 9 files with `runner.tierSize` 4 holds at most 4 permits, and a Vitest tier of the same daemon starts beside it with the rest.
6. Light files: 600 files of 0.1 to 3 s still make tiers of 200 (no regression), and a file of no known duration counts 0.
7. The latency bound: with a node:test tier of the rule in flight, an edit of a node:test file is current within `max(120 s, the tier's longest file)` plus its own run (real node:test, scaled durations); a Vitest edit still cancels within its graces.

## Open questions

- The value of B is the human's. 120 s comes from the sweep (`sweep.mjs`): 60 s is up to 43 % slower (cezar's tail at 23 workers, 723 s against 507 s); 300 s saves at most 18 % (400 medium files at 23 workers, 242 s against 296 s), is slower on cezar's tail (639 s), and lets the longest tier reach 198 to 295 s. Measure it on cezar once 001-379 (shrink under CPU pressure) lands, since wider tiers of CPU-bound heavy files may run slower than last time.
- node:test and pytest could stop starting files at an edit and let the running ones finish (their run loops check a flag before each start, `run.ts`), which would bound their edit wait by one file. That is 001-381's question.
- Vitest projects of different `sequence.groupOrder` run one group after another; the estimate should sum per group. Not measured.
- Cezar's 13:00 to 13:02:55Z Vitest wait behind the node:test tier: whether its 54-permit ask caused it is not determined, because the pool's marks are not kept.

## Sources

- Squeal `fb6d3164` / `036be0a0`: `src/core/scheduler/backlog.ts`, `tiers.ts` (`selectTier`, `startTier`, `recordTier`), `claims.ts` (`backlogSize`), `capacity.ts`; `src/core/capacity/pool.ts`; `src/runners/vitest/{run,width,adapter}.ts`; `src/runners/node-test/{adapter-project.ts,run/run.ts}`; `src/runners/pytest/adapter-run.ts`; `src/core/daemon/{node-test,pytest}-runners.ts`.
- Spec 011 C4 step 5, C9, C10; `../005-agent-adoption/lessons.md` row 5; `../001-core-loop/research/host-capacity.md`.
- Vitest 5.0.3 `dist/chunks/index.DpLw24bj.js` `BaseSequencer` (npm tarball, installed in the probe).
- Cezar main worktree store, `runs` and `results` of checkpoint `701f50`, 2026-10-19, read-only.
- Probe: `probes/backlog-wall-budget/` (README, `make-fixture.mjs`, `drive.mjs`, `prototype.patch`, `model.mjs`, `sweep.mjs`, `cezar-replay.mjs`, `summarize.mjs`, `results/`).
