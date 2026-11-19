# 011-404 notes: test slots stop capping busy CPUs; one refusal line per episode (gh-225)

Worker ca24b463, wave 123 W1, 2026-11-19.

## What changed

- `src/core/capacity/cores.ts` `gatedPermits`, background branch: the limit is `background.ceiling` alone, also when `busy` is `null` (then the marks' cores, `gatedCores`, count against it). `hostSlots` is no longer read there. The checkpoint branch (`cores < hostSlots || grants < hostSlots / 2`) is unchanged.
- `src/core/capacity/background.ts`: `ceilingRefusalLine` lost its test-slots clause. New class `RefusalEpisodes` keeps one refusal episode per pool.
- `src/core/capacity/pool.ts`: `#logRefusal` now goes through `RefusalEpisodes`, and a backlog grant ends the episode. The call moved after the grant is known (one call, so `acquire`'s complexity did not grow).
- Tests: `test/capacity/ceiling.test.ts`, `test/capacity/host-gate.test.ts`, `test/scheduler/pool-wait.test.ts`, `test/runner-host/remote/lane-admission.test.ts`.

## Readers that show the bar

- `src/core/ps/host.ts` and `src/core/ps/render.ts`: already show the ceiling alone (`background ceiling 18 busy CPUs`), computed from `backgroundShare` and the CPUs. No change needed.
- `src/core/runner-host/remote/admission.ts`: it forwards the pool's log line as the refusal. No code change needed. Effect of the episode rule: the remote machine's pool logs once per episode, so `admit` returns `refusal` only on the episode's first look, and the daemon logs `on its machine, ...` once per episode too (test in `lane-admission.test.ts`). The episode's end line arrives on a granted look, where `admit` ignores `refusal`, so the remote daemon's log has no end line. I left it so.
- `src/core/scheduler/pool-wait.ts`: its text never named a bar. `gateText` still reads `N of M cores in use; Squeal's daemons hold G of S test slots`, a count as the brief asks. No change.
- Does any text still call the slots a CPU bar? In code I own, no. In `src/core/capacity/pool.ts` the class comment still says a checkpoint's permit needs "the marks' cores below the slots or their grants below half of them": that is the checkpoint gate, which keeps the slots as its bar on purpose. Outside my files: spec 011 C10 Size (below) still says a backlog tier compares CPU "with the slots".

## Decisions the brief did not settle

1. **What an episode is.** The pool does not know when a tier stops waiting. An episode starts at a refused look and ends at a backlog grant (any backlog grant of this pool, the floor's included). A refused look more than 30 s (`SLOT_WAITER_FRESH_MS`, the wait's freshness, as 011 C10 "A pool wait is told" defines a wait) after the last refused look starts a new episode, so a tier that gave up and a later wait each log a line. One episode per pool, not per lane: the pool's backlog refusals are per daemon.
2. **The end line.** At a grant that ends an episode the log has one line: `the background ceiling let a backlog tier start after 30 s and 5 refused looks`. So an episode logs at most two lines. An episode that ends by silence logs no end line.
3. **Unread host.** Per the brief, the ceiling binds also when the host's busy cores are unread: the marks' cores count against it. Before, the slots bound it. On a 24-CPU host with 23 slots and one other mark of 1 core, a backlog tier with an unread host now gets 17 permits, not 22 (test updated).
4. **Test setup change in `pool-wait.test.ts`.** Its two `TierCapacity` tests relied on the slots (12) as the backlog bar with marks of 13 cores. They now set `backgroundShare` so the ceiling is 12 on any machine with 12+ CPUs (`Math.min(1, 12 / availableParallelism())`; on fewer CPUs the ceiling is lower and still refuses). What they test is unchanged.

## Type changes

- `CeilingRefusal` (`src/core/capacity/background.ts`) lost its `hostSlots` field. Not additive, but the type is internal to `src/core/capacity/**` (only `pool.ts` builds it). No other type changed.
- New export `RefusalEpisodes` in `background.ts`.

## Proposed spec amendments (the coordinator lands them)

**021 D18**, replace the "Rule" and log bullets with:

- Rule: a backlog tier or baseline takes a permit only while the host's busy CPUs, as the pool already reads them (row 011-182), are below the ceiling. The ceiling alone is the bar: `capacity.hostSlots` does not lower it (amended 2026-11-19, the human, row 011-404, gh-225: on a 24-CPU host, `hostSlots` 6 made the bar 6 busy CPUs). Where the host's busy cores cannot be read, the fresh marks' cores count against the ceiling. The slots still count test runs: the permit files and each daemon's fair share are sized by `hostSlots`. The `grants < hostSlots / 2` term in `src/core/capacity/cores.ts` goes. Edit tiers, named waits, checkpoints and agents' own runs stay outside it.
- The daemon log records one line per refusal episode by the ceiling, with the busy CPUs read and the ceiling (`the background ceiling refused a backlog tier: 19.4 busy CPUs, ceiling 18 (0.75 of 24 CPUs)`), not one per look (amended 2026-11-19, row 011-404, 021-19 recommendation 4: 490,833 lines in 4.5 days on this host). An episode starts at a refused look and ends at the pool's next backlog grant, with one line of its length (`the background ceiling let a backlog tier start after 30 s and 5 refused looks`), or after 30 s without a refused look, with none. `squeal ps` shows the ceiling.

**011 C10 Size**, append:

(amended 2026-11-19, row 011-404, gh-225, spec 021 D18) A backlog tier's CPU, as counted above, is compared with the background ceiling (`capacity.backgroundShare` of the CPUs) alone, not with the slots, also where the host's busy cores are not read; the slots keep sizing the pool's permits and the fair shares. The sentence "So on a host busy with other work a backlog tier takes a permit only while the grants are below half the slots" no longer holds for backlog tiers: it stays true for checkpoint tiers, whose gate is unchanged.

(The coordinator should also reword "the CPU compared with the slots is the larger of ..." to "the CPU compared with the ceiling is the larger of ...".)

## Checks

- `pnpm run lint`: `biome check .`, 3770 files, no fixes, exit 0.
- `pnpm run typecheck`: exit 0.
- Direct, with `timeout`: `pnpm exec vitest run test/capacity/ test/runner-host/remote/ test/ps/ test/scheduler/pool-wait.test.ts test/scheduler/capacity*.test.ts test/cli/status-wait-pool.test.ts test/scheduler/catch-up-cancel.test.ts test/scheduler/pytest-slots.test.ts test/runners/pytest/adapter-admission.test.ts`: 57 files, 506 tests passed.
- `squeal status --wait 60000 src/core/capacity/{cores,background,pool}.ts` at revision 10: 15 current, all pass (`ceiling`, `cores`, `crash`, `edit-mark`, `host-gate`, `pool-failure`, `pool` capacity tests and others); known failures 0. 1,188 files pending: the capacity files are read by about 1,190 test files, so the selection is close to the full suite. It waited for quiet and then catch-up; I did not wait for it or start `run --all` (no full suite for workers). Unknown, not passing.
- e2e: no file under `test/e2e/` names the changed paths or the refusal line text; none run.
- Fails before the change (by reading): with `hostSlots` 6 the old limit was `min(6, 18)` = 6, so 10 busy CPUs gave 0 permits; the new tests expect 8 and 4.

## Repair on candidate 0.1.570 (CI 44553135113), 2026-11-19

**Case (a): the tests assumed the machine.** No product defect in the floor or the gate.

- CI failed 14 test files across the Node 22, 24 and 26 jobs (not only the 6 named in the Node 24 job): `scheduler/{backlog-slots, edit-beside-backlog, batch-beside, batch-line, batch-tier, catch-up, edit-cut-route, fresh-worktree-durations, local-permits, promoted-tier, promoted-tier-expiry, step-reading}`, `lint/pass/parts`, `runner-host/remote/lane-admission`. (`test/broken.test.ts` and `test/fails.test.ts` in the log are fixture runs nested in other tests, not failures of the suite.)
- Cause: these fixtures build a pool with `hostSlots` 4 to 24 and either `host: null` or a host whose busy cores are not yet read at the look. Before 011-404 an unread host made the slots the bar; now the ceiling is the bar, 0.75 of the machine's CPUs. On a 4-CPU GitHub runner that is 3, so a tier that the test expects at 4 (or 24) workers gets 3 at most.
- Reproduction: a vitest setup file that mocked `node:os` `availableParallelism` to 4 (temporary, not committed) made the same 14 files fail on the candidate's tests (30 tests: `expected 0 to be greater than or equal to 4`, `no backlog run of h3`, `expected 18 to be 24`, ...). An instrumented look in `backlog-slots` test 2 at 4 CPUs showed `ceiling 3`, `busy null` and 3 permits of 4 wanted. The floor was not involved: the tier always got at least one permit; the poll showed 0 only because the files had ended by the time it gave up.
- Fix: `cpus` moved from `PermitPoolOptions` to `PoolCapacity` (additive for `CapacityOptions`), and `TierCapacity` passes it on (`src/core/scheduler/capacity.ts`, one line, outside W1's list: the only way a scheduler fixture can pin the machine). The fixtures pin `cpus: 64` (ceiling 48, above every fixture's slots), so the slots bind as each test intends: `slots-fixture.ts`, `catch-up-fixture.ts`, `wall-fixture.ts`, `vitest-harness.ts` (default beside `host: null`), and `edit-beside-backlog`, `fresh-worktree-durations`, `local-permits`, `lint/pass/parts`, `lane-admission` (the local pool only; the remote machine's pool keeps 24 CPUs).
- Evidence after: the 14 files pass with `availableParallelism` mocked to 2 and to 4 (56 tests each), and on this 24-CPU host without the mock with the capacity tests (27 files, 135 tests).

**The coordinator's question: is a named wait's batch newly under the ceiling?** Not newly; since 021-18 when the host's busy cores are read.

- A named wait's batch asks the pool as `kind: "backlog"`: `poolKind` (`src/core/scheduler/capacity.ts`) returns `"checkpoint"` only for a tier of an open explicit `run --all`; spec 011 C10 "A named wait's batch" (row 011-308, 2026-11-07) says the batch "asks the pool as a backlog tier".
- Before 011-404, `gatedPermits` capped a backlog tier at `min(hostSlots, ceiling)` whenever the host was read, and at `hostSlots` only when `busy` was `null`. On this host that is `min(24, 18)` = 18 for the batch-tier fixture with a host reading.
- `batch-tier` test 1 passed before because its look saw `busy` `null`: the fixture has `host: null`, and even with the host read (old `cores.ts`, `host` option removed, test run: passed with 24) the pool's first look after a tier starts has no fresh window yet (`#activate` resets the tree, so `#beyond` is unset). In production the same is true at a first look after idle; at later looks the window is fresh and the ceiling applied.
- So 011-404 removes the unread-host escape; it does not newly put named waits under the ceiling. The conflict with 021 D18 ("Edit tiers, named waits, checkpoints and agents' own runs stay outside it") dates from 021-18. A fix (for example `poolKind` returns `"checkpoint"` for a promoted batch tier, in `tier-pass.ts` / `tier-pick.ts`) is in scheduler files outside W1 and changes product behaviour, so I did not make it. Note that a refused or narrowed batch already starts at once as an edit's tier without a permit (011 C10 "A batch on a busy host"), so the ceiling narrows a named wait's batch but never delays it.
