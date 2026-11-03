# Spec 019 wave 2: a lane per group

From `research/lanes-survey.md` section 5 (rows L1 to L7). Step 2a runs four rows in parallel on disjoint files; step 2b starts when 019-10 lands. Product rows land as one candidate per step, after one review.

## Contracts (coordinator, 2026-11-03; every row codes against these)

- **Lane string.** The default `tests` group keeps today's runner lane (`"vitest"`, `"node-test:<project>"`, ...). The default `slow` group keeps `"slow:<runner lane>"`. A configured group is `"group:<name>:<runner lane>"`. `isSlowLane` becomes `isGroupLane` (true for both prefixes); every reader that branches on it today keeps its behaviour for `"slow:"`.
- **Activity row.** The default `slow` group keeps meta key `slow-tier:<worktree>`. A configured group writes `group-tier:<name>:<worktree>`, same shape (`SlowTierActivity`).
- **Request.** A new daemon request `{ type: "run-group", group: string }`. `run-slow` stays and means `run-group` with `group: "slow"`. An older daemon answers `run-group` with its unknown-request error.
- **Priority** (spec D3 as amended today): `"low"` is today's slow behaviour: pool lane `"slow"`, `ionice -c 3`, one file at a time while the worktree has `normal` work pending or the load is above `deferUnderLoad`'s bound (today's width rule), and a running tier runs to its end on a new edit. `"normal"` is today's fast behaviour: pool lane `"fast"`, no `ionice`, full width, and a Vitest tier may be cancelled by a new edit as today. Every test runs at `nice` 10 either way (011 C10). The default `slow` group is `low`; every other group defaults to `normal`.
- **Slot scope** (the human, 2026-11-03). A group's `maxParallel` slot counts per repository by default: slot files live under a directory named by the repository's common-dir identity. The host config `~/.config/squeal/config.json` key `capacity.groupSlotScope: "user" | "repository"` (default `"repository"`) switches every group, the default `slow` group included, to today's user-wide files. A configured group's files are `group.<name>.*.lock`; the `slow` group's names stay `slow.*.lock`.
- **Unchanged without `checks`.** With no `checks` key, lanes, tier order, activity rows, request handling and every text are byte-identical to today's. Each row proves it with a test that records today's output first.

## Step 2a

### 019-10 Scheduler lanes per group (survey L1)

Use /worker. Shape: slice, in two commits. Slice 1: `laneFor` and `Queue.setSlow` take 019-07's `groupOf`, with the default groups giving today's lanes; `pytest[].slow` marks its files (survey defect; 004 D1, 007 D1). Slice 2: one lane object per group other than `tests` (generalize `SlowTier`): moment (`edit` with `after` and `quietMs`, `pause`, `stop`, `commit` queued only on request), `after` order at the same moment, `deferUnderLoad`, slot, `maxWorkers`, priority; `requestGroup(name)`.

Read: `spec.md` D1 to D3; the contracts above; survey sections 1, 2 and 5 (L1); `tasks/019-07/notes.md`.

Owns: `src/core/scheduler/` `slow.ts`, `slow-tier.ts`, `slow-trigger.ts`, `slow-release.ts`, `scheduler.ts`, `queue.ts`, `ledger.ts`, `tiers.ts`, `slots.ts`, `options.ts`, `capacity.ts`, `checkpoint-requests.ts`; `src/core/types/scheduler.ts`; `src/core/slow/classify.ts`, `guard.ts`, `rank*.ts`, `state.ts`; `src/core/lint/pass/idle.ts`; `src/runners/pytest/describe.ts` (`slowProjects`); new tests under `test/scheduler/`. Leave `src/core/capacity/`, `src/core/slow/slot.ts` (019-11) and `src/core/daemon/` (019-12) alone; call their current interfaces.

Done when: spec Testing "Scheduler" bullets are tests; a fixture with no `checks` gives the same lanes and tier order as before (a recorded tier log); a `pytest` entry with `slow: true` runs in the slow lane; existing scheduler tests pass by `squeal status --wait 60000 <changed-path>...`; lint and typecheck pass.

### 019-11 Pool and slot per group (survey L2)

Use /worker. Shape: slice. Outcome: a named slot per group, and pool waiter order by priority. Seam: `PoolLane` (`src/core/capacity/pool.ts`), `permitFile` and `WAITER_PREFIX` (`src/core/slow/slot.ts`). Owns `src/core/capacity/*`, `src/core/slow/slot.ts`, their tests. Done when: the name `slow` writes the same files as today; two names' permits are independent; `low` and `normal` order waiters as `slow` and `fast` do now; an older daemon's mark reads as today; tests pass by `squeal status --wait`; lint and typecheck pass.

### 019-12 Runner instances and priority per lane (survey L3)

Use /worker. Shape: slice. Outcome: a Vitest instance per group lane, made on its first run and closed 60 s after its last, as the slow lane's is; `ionice` follows the run's priority, not the lane prefix. Seam: `withSlowInstance` (`src/core/daemon/slow-instance.ts`), `lower(..., isSlowLane)` (`src/core/daemon/low-priority.ts`). Owns those files, the instance wiring in `src/core/daemon/daemon.ts`, `src/runners/node-test/adapter-project.ts` and `src/runners/pytest/adapter-run.ts` (their slow-lane checks), `src/core/types/runner.ts` (lane helpers, a priority in `RunOptions`). Done when: tests show one instance per lane and its release; `ionice` by priority; the heap across 20 instance cycles in a live daemon is measured and written in `tasks/019-12/notes.md` (spec open question 7, survey open question 5).

### 019-13 Commit report core (survey L4)

Use /worker. Shape: slice. Outcome: spec D5 steps 2 to 4: on a `HEAD` move to a commit not yet reported, a report from keys of the committed blobs (partial staging = "not determined"), stored per commit SHA; the tool boundary reads `HEAD` and asks the daemon to `sync`, so the report is not 30 s late. Commit groups (step 1) come later, after 019-10's `requestGroup`. Seam: `recordHeadMove` (`src/core/scheduler/head-move.ts`). Owns `head-move.ts`, its call sites in `src/core/scheduler/batch.ts`, a new `src/core/commit/`, the `HEAD` read and `sync` in `src/harness/shared/deliver.ts`, tests. Done when: spec Testing "Commit" counts hold for a plain commit, a partial commit, an amend, a rebase and `core.hooksPath`: one stored report each, nothing denied; the report text is a pure function 019-16 will print.

## Step 2b (after 019-10 lands)

Briefs written when 019-10 lands, from its notes: 019-14 Stop for groups and `stop.maxHolds` (survey L5; folds review 0.1.395 S1 and S2), 019-15 `squeal run <group>` and the `run-group` request (L6), 019-16 texts per group and the commit line (L7). Then 019-17 proof: an end-to-end fixture with three groups through the shipped plugin, and a dogfood report.
