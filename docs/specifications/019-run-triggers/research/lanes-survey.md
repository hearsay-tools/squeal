# Lanes per group: where the slow lane lives today, and a cut of wave 2

Row 019-08, survey. Source read at commit `a51dc345c` (2026-11-03). Probes under `probes/lanes-survey/` (throwaway), Vitest 5.0.3, Node 24.22.1, this host (24 CPUs). Two code maps were made by read-only subagents and spot-checked here (the pytest, head-move and lint-idle findings re-read by hand).

## Questions answered

| # | Question | Answer |
|---|---|---|
| 1 | Which code is slow-specific, and how does it become a lane per group? | About 3,100 lines in 25 files that are slow-only (a `slow` file name or `src/core/slow/`), plus slow checks (`isSlowLane`, `isSlow`, `slowView`, `slowPolicyView`) in 29 more. Every one of them is a yes/no test, "slow or not". One class, `SlowTier`, holds the trigger, `after`, the load guard, the slot, the idle width and the pool grant. It becomes one lane object per group that is not the default `tests` group. Table in 1. |
| 2 | How do lanes share the per-user pool and the cross-worktree slot? | The pool knows two lanes, `"fast"` and `"slow"`, and uses them only to order waiters. The slot is one set of lock files, `slow.*.lock`, shared by every repository of the user. For groups: `priority` maps onto the pool lane. A group's `maxParallel` needs a slot with its own file name and a scope (2). |
| 3 | Open question 7: the memory and start time of one more Vitest instance | An idle instance keeps **no worker processes**. In the daemon process, each instance that has run something adds 4 to 5 MB of heap on a synthetic fixture and 16 to 21 MB on 20 of this repository's test files. A new instance starts in 20 to 270 ms. Its first run is 0.2 to 8.4 s slower than its second (cold transforms). **But:** each create, run and close cycle kept about 4 MB of heap after close and GC. Timing was taken at a load of 15.6 to 21.1 on 24 CPUs (below the CPU count) and is noisy (3). |
| 4 | Seams for D4, D5, D6 | D4: `slowFilesNotCurrent`. No hold count exists, and "once" is only `stop_hook_active`. D5: `recordHeadMove` stores the last `HEAD` move and nothing reads it as an event. The tool boundary reads no `HEAD`. D6: `runCommand` with `runLanes`, the `run-slow` request, `readSlowTier` with `slowTierText`, and `slowSentences` (4). |
| 5 | Wave 2 rows | Seven rows in two steps, each with its own files: scheduler lanes, pool and slot, runner instances, commit report core; then Stop, `squeal run <group>`, texts (5). |

## 1. What is slow-specific, and its form per group

Read in source code, `a51dc345c`, unless marked otherwise.

| Concept | Where it lives today | Per group (D1 to D3) |
|---|---|---|
| Which files are slow | `slowFiles` and `slowGlobs` (`src/core/slow/classify.ts`). The predicate is built in three places: `slowView` (`scheduler/slow.ts:15`), `slowPolicyView` (`state/slow.ts:39`), and Stop's `slowFiles(project, slowProjects(project))` (`harness/shared/stop.ts:127`, `stop-slow.ts:117`). | 019-07's `groupOf`, compiled once per policy object (the `WeakMap` that `slowView` uses). |
| **Defect found:** `pytest[].slow` | The loader parses it (`daemon/policy-pytest.ts:25`), but every caller passes only `policy.nodeTest`, and pytest's `slowProjects` returns `[]` (`runners/pytest/describe.ts:68`). A pytest entry with `slow: true` therefore marks nothing slow. Spec 007 says that it marks every file of the entry. | Fixed for free once the scheduler, status and Stop classify through 019-07's resolver, which maps `pytest[].slow` to the default `slow` group (D2). Until then the key does nothing. |
| Lane | `laneFor` gives `SLOW_LANE_PREFIX + runnerLane` (`"slow:vitest"`). `isSlowLane` is checked in `scheduler.ts` (5 places), `slots.ts`, `slow-instance.ts`, `low-priority.ts:94`, `ps/processes.ts:135`, `status/tier-text.ts:20`, `status/standing.ts:216` and `next-step.ts:263`. | One lane string per (group, runner lane). The default `tests` group keeps the runner's lane and the default `slow` group keeps `slow:<lane>`, so `ps` marks and older daemons read the same. Any other group needs a third prefix, for example `group:<name>:<lane>`, since a group may be named `slow` or `beside`. |
| Queue class | `Queue.setSlow`, `isSlow`, `slowSize`, `orderedSlow` (`queue.ts:107` to `:505`). `orderedBatches` leaves slow files out. `Ledger.orderedSlow` (`ledger.ts:237`). It is a boolean: two classes. | The class becomes a group name. Only the default `tests` group keeps the fast machinery (batches, backlog, promotions, beside tiers). Each other group gets its own ordered list. |
| Tier kind | `TierKind` `"slow"`, which nothing cancels (`tiers.ts:148`, `:576`). | One kind for every group lane. Whether a group at `edit` may cancel, as a fast Vitest tier does, is not in the spec (open question 3). |
| Trigger (moment) | `policyTriggered` and `quietLeftMs` (`slow-trigger.ts`), plus `SlowTier.#trigger`: an open `run --slow`, or a file of an open `run --all`. | `edit` + `quietMs` is today's `"continuous"`, `pause` is `"idle"` (`consumersIdle`), and `stop` is `pause` plus Stop's request (D4). `commit` is queued by the commit report (D5), never by the pump. |
| `after` | `SlowTier.#fastFirst`: an edit's fast work is pending, or the fast backlog is pending and no `run --slow` was asked (004-60). `Scheduler.#slowMayStart`: no slow tier of **any** runner is in flight, and no edit's work. | `after: [names]` checks the named groups' lanes for work pending or running at the revision. Note: today a slow node:test tier and a slow Vitest tier never run at once (`#slowMayStart`). With a lane per group they would. The default `slow` group must keep the rule that the fast **backlog** goes first (004-60), and D1's "nothing pending or running" covers that. |
| Load guard | `waitForCapacity` and `loadPerCpu` (`slow/guard.ts`) are generic. `SlowTier.#budgetMs` is the per-pass budget. A marked waiter and `run --slow` skip the guard. | `limits.deferUnderLoad`, with a budget per lane per pass. |
| Width | `slow.maxParallel` files, but **only while the worktree has no fast work and the load is below the guard**. Otherwise one file at a time (`SlowTier.next`, `want`). This idle-width rule is **not among D3's limits**. | It must be named (open question 1). Otherwise a configured group with `maxParallel: 4` behaves differently from the default `slow` group with the same value. |
| `maxWorkers` | `perFileLease` (`capacity.ts`). The slow Vitest instance width is `max(slow.maxWorkers, slow.maxParallel)` (`daemon.ts:603`). | Per group. The instance is made per lane (row L3). |
| Priority | Every test process already runs at `nice` 10 (`TEST_NICE`, `low-priority.ts:12`; 011 C10 Priority). The slow lane adds only `ionice -c 3` (`lower(..., isSlowLane(lane))`) and the pool lane `"slow"`. | `priority: "low"` is `ionice -c 3` plus pool lane `"slow"`. D3's "runs under `nice` 10" is true of every group already (open question 2). |
| Instances | `withSlowInstance` (`daemon/slow-instance.ts:40`) holds two fixed fields, `slow` and `beside`, routed by lane prefix. So a daemon can already have three Vitest instances. `SlowRelease` closes the slow one 60 s after its last run (`slow-release.ts`). | A map from lane to `LaneInstance`. `SlowRelease` runs per lane. |
| Request | `Scheduler.requestSlowSuite` → `queueSlowSuite` (`slow-tier.ts:661`). The protocol has `run-slow` with no fields, and `run-all.lane` is `"fast"` or `"slow"` (`daemon/protocol.ts:26`, `:41`). `queueFullSuite`'s `only.lane === "slow"` (`checkpoint-requests.ts:63`). | `requestGroup(name)`, the same queueing per group. |
| Ranking | `SlowRanker` evidence tokens (004 D2, 004-72), one per worktree. | Can stay with the default `slow` group. It is optional for others. |
| Exit drain | `lifecycle.ts` reads `slowPending` and `slowWaiting` (`DRAIN_SLOW_WAIT_MS`, 60 s). | It covers every group at `pause` or `stop`. The method names can stay. |
| Lint | `lintIdleIn` (`lint/pass/idle.ts:21`) reads `slow.trigger` and `slow.quietMs` for the stale whole-program re-lint (017 D5). Lint parts take `take(1, "slow", 1, "backlog")` (`lint/pass/parts.ts:236`). | It follows the default `slow` group's moment (D2). Lint groups at `commit` need a moment hook in `parts.ts` (`idleIn`'s place). |
| State and texts | One `SlowTierActivity` row per worktree, meta `slow-tier:` (`slow/state.ts:17`). `readSlowTier` → `SlowTierState` → `slowTierText` (`state/slow-text.ts:104`), and the `slow-tier-told:` row (`delivery/slow-told.ts`). | One activity row per group, with the `slow-tier:` row kept for the default `slow` group. |

## 2. The per-user pool and the cross-worktree slot

Read in source code.

- **Pool** (`src/core/capacity/pool.ts`; files `pool.<i>.lock` in `$XDG_RUNTIME_DIR/squeal`). A backlog, checkpoint or slow tier takes a grant (`TierCapacity.take`). An edit's tier runs without a grant and only writes its mark (`running(workers)`). `PoolLane` is `"fast" | "slow"`. It sets two things only. First, the order of waiters: a fast waiter is ahead of every slow tier, and a slow waiter is ahead only of a younger slow tier (`pool.ts:219`). Second, the mark's `slow` flag (`marks.ts`, `share.ts` `slowFirst`). An open `run --slow` that finds no permit runs without one.
- **Slot** (`src/core/slow/slot.ts`). This is the cross-worktree `maxParallel`: `slow.lock`, `slow.<i>.lock` and waiter marks `slow.wait.<worktree>` in one per-user directory. It is shared by **every repository** of the user, with permits up to each daemon's own `slow.maxParallel` (004 D2). The file names are constants (`permitFile`, `WAITER_PREFIX`). `Slow slot:` reads the same directory (`status/slot-holders.ts:41`).

Proposed mapping (inferred, from the code above and D3):

1. **Grant.** A group's tier that an edit caused, at `edit`, with no `after` and no `quietMs`, is an edit's tier and runs without a grant, as the `tests` group does. Every other group's tier (a pause, Stop's queue, a commit, or `after`/`quietMs`) takes a grant as the slow tier does. An explicit request (`squeal run <group>`, Stop's request) runs without a grant when the pool refuses it, as `run --slow` does now. The machine's total stays bounded as today, except for explicit and edit work, which is unbounded today too.
2. **Order.** `priority: "low"` maps to pool lane `"slow"` and `"normal"` to `"fast"`. No pool change is needed for two priorities.
3. **Slot.** Only a group with `limits.maxParallel` takes a slot (D3: "a group without limits takes no shared slot"). The default `slow` group keeps the `slow.*` file names, so older daemons and `Slow slot:` stay correct. A configured group needs a name prefix in `SlowSlotRequest`. It also needs a **scope**, because a user-wide slot named `e2e` would join two repositories' unrelated `e2e` groups. Scoping by the repository root that `capacity.projects` already keys on (the main worktree's root) joins the worktrees of one repository, which is where fixed-port collisions happen (004 D10). This is open question 4.
4. **Lint** keeps its one-slot `"slow"` backlog grant.

## 3. Open question 7: one more Vitest instance

Verified by experiment. Script `probes/lanes-survey/instances.mjs`: in one Node process, it calls `createVitest("test", { watch: false })`, then `standalone()`, as the daemon does (`runners/vitest/adapter.ts:223`). Then it runs every selected file twice. The host had a one-minute load of 15.6 to 21.1 on 24 CPUs, below the CPU count, so timing was taken. The load came from other sessions; I added none on purpose. Fixture A: 200 chained modules and 20 test files, synthetic, under `$TMPDIR`. Fixture B: `git archive` of this repository at `a51dc345c` under `$TMPDIR`, 20 files of `test/code/`. Some of them failed there (not a git checkout), which does not change what loads.

| Run | Instances | Start (`createVitest` + `standalone`) | Daemon heap after its first run (baseline 17 MB) | Daemon RSS (baseline 97 to 99 MB) | Workers during a run | Workers after | First / second run |
|---|---|---|---|---|---|---|---|
| A, 2 workers | 5 | 104, 266, 66, 44, 20 ms | 24, 28, 33, 37, 41 MB | 149 → 245 MB | 3 to 4 processes, 170 to 180 MB | 0 | 3.9/2.5, 2.7/2.1, 3.9/2.1, 3.2/2.5, 2.8/2.6 s |
| B, 4 workers | 3 | 1,324 (first in the process), 74, 56 ms | 43, 64, 80 MB | 287 → 356 MB | 7 to 8 processes, 511 to 662 MB | 0 | 11.4/3.1, 5.6/2.7, 15.0/13.1 s |
| B, 4 workers | 2 | 142, 97 ms | 39, 60 MB | 164 → 316 MB | 6 to 7 processes, 632 to 684 MB | 0 | 17.0/15.5, 7.4/4.0 s |
| A, `cycles.mjs` | 1, made, run and closed 6 times | n/a | after each close and GC: 24, 28, 33, 37, 41, 45 MB | 150 → 250 MB | n/a | n/a | 2.9 to 3.6 s a cycle |

Findings:

- **An idle instance costs no processes.** Vitest's fork workers exit after each run. With five instances, the daemon had 0 worker processes between runs. What a run uses is its workers (170 to 680 MB here), and the pool's permits already bound that, whatever the number of instances.
- **The resident cost is in the daemon process**: the module graph and transforms of what the instance ran. That was 4 to 5 MB of heap per instance for the synthetic 20 files and 16 to 21 MB for 20 of this repository's files. It grows with the modules the group's files import. For five Vitest groups it is in the tens of MB. This is a lower bound: the daemon's instance also loads Squeal's reporter, observer and source plugins.
- **Start.** After the first instance in a process, a new one starts in 20 to 270 ms. Its first run pays the cold transforms again: 0.2 to 8.4 s over a warm second run here (noisy under this load). The slow lane already pays this at each pass, because `SlowRelease` closes the instance 60 s after its last run.
- **Close does not free everything.** Each create, run and close cycle kept about 4 MB of heap (24 → 45 MB over 6 cycles), and process listeners did not grow. The cause is not determined. The daemon's own instances were not measured. If it holds there, the slow lane leaks about 4 MB per pass today, and a lane per group multiplies the passes.

Verdict for open question 7: one instance per Vitest group lane fits in memory. The fallback, "one instance shared by the Vitest lanes, serialized", would let a long group hold back another group's results, which goal 3 and D3 rule out. So the fallback is not a fit (inferred). The row that builds the instances (L3) first measures the live daemon's heap across 20 slow passes. If it grows, that row decides between keeping instances open and closing them, with the numbers.

## 4. Seams for D4, D5 and D6

Read in source code unless marked.

**D4, Stop.**
- The required set is `slowFilesNotCurrent(states, keys, isSlow)` (`state/slow.ts:186`). It is called from `decide` in `harness/shared/stop.ts:244` (under `requireSlowSuite && !slowElsewhere && !unchanged`) and from `read` in `stop-slow.ts:158`. Per group, it becomes "checks of groups at `stop` that are not current".
- **No hold count exists.** "Once" is `stopHookActive` alone (`stop.ts:136`, `:234`, `stop-slow.ts:113`, parsed in `claude-code/input.ts:54` and `codex/input.ts:68`). The turn row (`delivery/turn.ts:138`) keeps only `handoff.at`. `stop.maxHolds` needs a count per consumer and turn there, reset where a prompt starts the turn.
- Stop's request: 019-09 sends `run-slow` before the wait. Per group, it sends the request of the groups at `stop`, in `after` order (L6's request).

**D5, commit.**
- `recordHeadMove` (`scheduler/head-move.ts:13`) runs only on a reconciliation pass that made no revision and was not a watch batch (`batch.ts:53`, `:83`): the pass every 30 s, a start, or a `sync`. It stores the latest move in one meta row (`headMove:<worktree>`) and **emits nothing**. A `HEAD` move that comes with file changes (a checkout, a rebase) is stored in the revision's own `head`. Its readers are `state/revision-commit.ts:30` (the `79 · 1bc146f0 + 3` text) and `code/pass/source.ts:31`.
- The tool boundary: `deliver` (`harness/shared/deliver.ts:62`) → `HarnessDelivery.onToolBoundary` (`delivery/delivery.ts:476`). It reads no `HEAD` today. `readGitHead` (`status/git-head.ts`) reads the git files without a spawn. Inferred seam: at the boundary, compare `readGitHead` to the store's last `HEAD` (`readRevisionCommit`). On a difference, send the existing `sync` request, whose pass reaches `recordHeadMove`. That is the D5 path that removes the 30 s delay.
- A commit report needs a "new commit" event after both stores (the head-move row and a revision whose `head` changed). It also needs, per check, whether any input of its closure differs between the commit and the working tree. `context.head()` gives only one `dirty` flag today.

**D6, run, status and primer.**
- CLI: `runCommand` (`cli/run.ts:72`) parses with `runLanes` and `LANE_FLAGS` (`cli/run-lanes.ts`). Positional words are rejected as unknown (`run.ts:82` to `:94`), and that is where a group name enters. `--slow` goes to `runSlowCommand` (`cli/run-slow.ts`), which polls `run-slow-status`. The daemon side: `handlers.ts:229` → `requestSlowSuite` (`daemon/run-slow.ts`).
- Status: `readSlowTier` (`state/slow.ts:102`) → `SlowTierState` → `slowTierText` (`state/slow-text.ts:104`). The header uses `delivery/header.ts:175` with `slowTierChanged` (`delivery/slow-told.ts:39`), `status/format-status.ts:101`, `standing.ts:405` (`{kind:"slow"}`), `next-step.ts:199` and the `status --wait` lines (`cli/status-wait-lines.ts`, `status-wait-slow.ts`). Each holds one optional slow field.
- Primer: `slowSentences` (`harness/shared/primer.ts:260`) from `Coverage.slow` (`coverage.ts:51`). Skill: `plugins/claude-code/skills/squeal/` (`SKILL.md`, `references/commands.md`, `policy.md`, `reports.md`), copied into the Codex seed and runtime and into Pi.

## 5. Proposed wave 2 rows

After 019-07 (the resolver) and 019-09 (Stop's request) land. Before dispatch, the coordinator writes three contracts into the wave brief: the lane string per group (1), one activity row per group (meta key), and the name of the group request. Row names are placeholders; the coordinator numbers them.

**Step 2a, in parallel:**

| Row | Starting seam | Owns | Done when |
|---|---|---|---|
| L1 Scheduler lanes per group | `SlowTier` (`scheduler/slow-tier.ts:123`). First edit: `laneFor` and `Queue.setSlow` take 019-07's `groupOf`, and the default groups give the same lanes. Slice 2: one lane object per non-`tests` group with moment, `after`, `quietMs`, `deferUnderLoad`, slot and `maxWorkers`, plus `requestGroup(name)`. | `src/core/scheduler/` `slow.ts`, `slow-tier.ts`, `slow-trigger.ts`, `slow-release.ts`, `scheduler.ts`, `queue.ts`, `ledger.ts`, `tiers.ts`, `slots.ts`, `options.ts`, `capacity.ts`, `checkpoint-requests.ts`; `src/core/types/scheduler.ts`; `src/core/slow/classify.ts`, `guard.ts`, `rank*.ts`, `state.ts`; `src/core/lint/pass/idle.ts`; new tests under `test/scheduler/`. | Spec Testing "Scheduler" bullets as tests. With no `checks` key, a fixture gives the same lanes and tier order as before (a recorded tier log). `pytest[].slow` marks its files. Existing scheduler tests pass by `squeal status --wait`. |
| L2 Pool and slot per group | `PoolLane` (`capacity/pool.ts:58`); `permitFile` and `WAITER_PREFIX` (`slow/slot.ts:233`, `:272`). | `src/core/capacity/*`, `src/core/slow/slot.ts`, their tests. | A named slot with its scope: the `slow` name writes the same files as today, and two names' permits are independent. `priority` low and normal order waiters as slow and fast do now. An older daemon's mark reads as today. |
| L3 Runner instances and priority per lane | `withSlowInstance` (`daemon/slow-instance.ts:40`); `lower(..., isSlowLane)` (`daemon/low-priority.ts:94`). | `src/core/daemon/slow-instance.ts`, the instance wiring in `daemon.ts` (about `:555` to `:655`), `low-priority.ts`, `src/runners/node-test/adapter-project.ts` and `src/runners/pytest/adapter-run.ts` (their slow-lane checks), `src/core/types/runner.ts` (lane helpers, a priority in `RunOptions`). | A Vitest instance per lane, made on its first run and closed by `releaseLane`. `ionice` follows the run's priority, not the lane prefix. The heap across 20 instance cycles in a live daemon is measured and written in the row's notes (3). |
| L4 Commit report core (D5 steps 2 to 4) | `recordHeadMove` (`scheduler/head-move.ts`). | `head-move.ts`, its call sites in `scheduler/batch.ts`, a new `src/core/commit/` (report from keys and the dirty paths, stored per SHA), and the `HEAD` read plus `sync` in `harness/shared/deliver.ts`. | Spec Testing "Commit" counts for a plain commit, a partial one, an amend, a rebase and `core.hooksPath`: one stored report each, and nothing denied. Commit groups (step 1) come in a second slice after L1's `requestGroup`. |

**Step 2b, after L1, in parallel:**

| Row | Starting seam | Owns | Done when |
|---|---|---|---|
| L5 Stop for groups and `stop.maxHolds` | `slowFilesNotCurrent` (moved to a new `src/core/state/required.ts`), the `stopHookActive` checks. | `src/harness/shared/stop.ts`, `stop-slow.ts`, `src/core/slow/stop-wait.ts`, `src/core/delivery/turn.ts` (hold count), the new `required.ts`. | Spec Testing "Stop" bullets: a not-run required check is queued; the wait passes 600 s on a fake clock; `maxHolds` 1 and 2 after a fast-failure message (C2) and after more edits (C3); Claude Code and Codex fixtures. |
| L6 `squeal run <group>` and the request | `runLanes` (`cli/run-lanes.ts`), `runCommand` (`cli/run.ts:72`), `run-slow` (`daemon/protocol.ts:26`). | `src/cli/run.ts`, `run-lanes.ts`, `run-slow.ts`; `src/core/daemon/protocol.ts`, `handlers.ts` (run cases), `run-slow.ts`, `front-desk.ts`, `desk.ts`, `desk-messages.ts`; `src/core/types/daemon.ts` (request types). | `squeal run e2e --wait` runs one group now at any moment and gives its verdict. `run --slow` is unchanged. An unknown group name exits 2 and lists the groups. An older daemon answers with an error the CLI words. |
| L7 Texts per group | `readSlowTier` / `SlowTierState`; `slowSentences` / `Coverage.slow`. | `src/core/state/slow.ts`, `slow-text.ts`, `header.ts`; `src/core/status/*`; `src/core/delivery/header.ts`, `slow-told.ts` and the slow parts of `delivery.ts`; `src/harness/shared/primer.ts`, `coverage.ts`, `text.ts`; `src/cli/status-wait*.ts`, `warmup.ts`, `retry-queue.ts`; `src/core/ps/*`, `src/core/retry/*`; the skill and its copies. | Spec Testing "Texts" bullets for each moment, plus the commit line from L4's stored report. With no `checks` key, every text is byte-identical to today's (golden tests). |

Then a proof row (spec Testing "Proof"): an end-to-end fixture with three groups through the shipped plugin, and a dogfood report.

L1 is the largest row and the critical path: L5, L6 and L7 need its lanes and request, and L4's second slice needs `requestGroup`. Collisions checked: `scheduler.ts`, `types/scheduler.ts` and `state/slow.ts` each have one owner. L3 is the only row that edits `daemon.ts`. L1 keeps the names `slowPending()` and `slowWaiting()`, so `lifecycle.ts` needs no owner.

## Recommendation

- Build lanes as L1 to L7. Cut L1 into a refactor slice that changes nothing visible, and then the group slice.
- One Vitest instance per group lane, closed 60 s after its last run, as the slow lane does. Not the serialized fallback.
- Have 019-07's coordinator confirm that `pytest[].slow` maps to the default `slow` group. Today the key does nothing, so a fix row or L1 should say so in `status.md`.

## Open questions

1. Is the slow tier's idle width a limit? Today it runs one file at a time while the worktree has fast work or the load is high, and up to `maxParallel` files otherwise. D3 does not list this rule. Owner: the coordinator, before L1.
2. `priority: "low"` differs from `"normal"` only by `ionice -c 3` and the pool's waiter order, since every test already runs at `nice` 10. Should D3 say so? Owner: the coordinator.
3. May a group at `edit` cancel its tier on a new edit, as a fast Vitest tier does, or does it run to its end, as the slow tier does? Owner: the coordinator, before L1.
4. The scope of a configured group's `maxParallel` slot: the user, or one repository (all its worktrees). Owner: the human.
5. Why a closed Vitest instance keeps about 4 MB of heap: not determined. L3 measures it in the daemon.

## Sources

- `docs/specifications/019-run-triggers/spec.md` D1 to D7 and open question 7; `tasks/wave-1.md`; `research/README.md`.
- `docs/specifications/004-slow-suites/spec.md` D2, D3, D7 to D10; `011-core/spec.md` C10 (Capacity, Priority, Lint parts); `007` (pytest `slow`).
- Source at `a51dc345c`: the files named in each section.
- Probes: `probes/lanes-survey/make-fixture.mjs`, `instances.mjs` and `cycles.mjs`, run on 2026-11-03 against Vitest 5.0.3 (`node_modules/vitest/package.json`), with the fixtures under `$TMPDIR`.
