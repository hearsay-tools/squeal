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

## Step 2b (from the integrated step 2a candidate)

Dispatched from the step 2a candidate's SHA once its integration checks pass, beside its review. Read `tasks/019-10/notes.md` first: its seam map and decisions 1 to 13 are the contract for these rows. The three rows run in parallel; 019-14 and 019-15 meet at one marked line (below).

### 019-14 Stop for groups and `stop.maxHolds` (survey L5)

Use /worker. Shape: slice. Outcome: spec D4 for every group: Stop requires the checks of every group with "Stop waits" (019-07's `stopRequires`), starts the ones not current, and may hold the agent up to `stop.maxHolds` times per turn, counted by Squeal, not by `stop_hook_active`.

Read: `spec.md` D4; `research/stop-wait.md` cases C1 to C3; review `reviews/0.1.395.md` S1 and S2; `tasks/019-10/notes.md`.

Seam and first edit: move `slowFilesNotCurrent` to a new `src/core/state/required.ts` that returns the not-current checks of every group Stop waits for. Then a hold count per consumer and turn (`src/core/delivery/turn.ts`; a turn starts at a user prompt) that both Stop entries read instead of `stopHookActive` for this requirement; other policies keep `stop_hook_active`. The request before the wait: `run-slow` for the default `slow` group; for configured groups leave one marked line, `// Row 019-15: run-group for <group> goes here.`; I connect 019-15's helper at integration. Fold in S1 (send no request when only the runner part is pending and no required check is open) and S2 (bound the request's socket time by the wait that is left).

Owns: `src/harness/shared/stop.ts`, `stop-slow.ts`, `src/core/slow/stop-wait.ts`, `src/core/delivery/turn.ts`, the new `required.ts`, tests under `test/harness/` and `test/delivery/`. Leave `src/core/daemon/` and `src/cli/` to 019-15, texts to 019-16.

Done when: spec Testing "Stop" bullets as tests on Claude Code and Codex fixtures: a not-run required check is queued; the wait passes 600 s on a fake clock; `maxHolds` 1 and 2 after a fast-failure message (C2) and after more edits (C3); SubagentStop and the no-edit exemption unchanged; affected tests by `squeal status --wait`; lint and typecheck.

### 019-15 `squeal run <group>` and the `run-group` request (survey L6)

Use /worker. Shape: slice. Outcome: `squeal run <group> [--wait]` runs one group now, whatever its moment (spec D6), through a new daemon request `{ type: "run-group", group }` that calls `Scheduler.requestGroup`. `run-slow` and `run --slow` are unchanged.

Seam: `runCommand` (`src/cli/run.ts`), `runLanes` (`src/cli/run-lanes.ts`), `run-slow` in `src/core/daemon/protocol.ts`. Owns `src/cli/run.ts`, `run-lanes.ts`, `run-slow.ts`; `src/core/daemon/protocol.ts`, `handlers.ts` (run cases), `run-slow.ts`, `front-desk.ts`, `desk.ts`, `desk-messages.ts`; `src/core/types/daemon.ts` (request types); tests. Also export one client helper, `requestGroupRun(socketPath, group)`, which 019-14's marked line will call.

Done when: `squeal run e2e --wait` gives the group's verdict at any moment; an unknown name exits 2 and lists the groups; an older daemon's unknown-request answer is worded; `run --slow` output is byte-identical; tests by `squeal status --wait`; lint and typecheck.

### 019-16 Texts per group and the commit line (survey L7)

Use /worker. Shape: slice. Outcome: spec D6: a status line per group that is not all current, by name; the primer names each moment's groups; the commit line from 019-13's stored report; the skill's policy reference lists `checks`, `stop.maxHolds` and `capacity.groupSlotScope`. With no `checks` key every text is byte-identical to today's (golden tests recorded first).

Read: `spec.md` D5, D6; `tasks/019-10/notes.md` (decisions 7, 10, and "Found, not fixed"); `tasks/019-13/notes.md` (the report text function).

Owns: `src/core/state/slow.ts`, `slow-text.ts`, `header.ts`; `src/core/status/*`; `src/core/delivery/header.ts`, `slow-told.ts` and the slow parts of `delivery.ts`; `src/harness/shared/primer.ts`, `coverage.ts`, `text.ts`; `src/cli/status-wait*.ts`, `warmup.ts`, `retry-queue.ts`; `src/core/ps/*`, `src/core/retry/*`; `plugins/claude-code/skills/squeal/` (source only; the copies are built). Switch these readers from `isSlowLane` to `isGroupLane` where they mean any group lane. Under the default per-repository slot scope (019-11, `tasks/019-11/notes.md`), slot files live in `<slot dir>/repo.<key>/`: make `squeal ps` (`src/core/ps/host.ts`) and the `Slow slot:` holders (`src/core/status/slot-holders.ts`) read that directory, through `slotFiles(group, scope).dir(...)`. Words for a lane waiting for an earlier group (019-10 decision 10) and for a `commit` group's pending files are yours; name them in your final message.

Done when: spec Testing "Texts" bullets for each moment and the commit line; golden tests unchanged without `checks`; tests by `squeal status --wait`; lint and typecheck. Do not run the build.

Then 019-17 proof: an end-to-end fixture with three groups through the shipped plugin, and a dogfood report in `lessons.md`.

## 019-18 step 2a integration (added 2026-11-03)

Use /worker. Shape: finish. Baseline: the coordinator's branch with 019-10 to 019-13 cherry-picked (no conflicts). Outcome: the four rows work together. Read `tasks/019-10/notes.md`, `019-11/notes.md`, `019-12/notes.md`, `019-13/notes.md`.

1. **Priority.** At the marked line in `executeTier` (`src/core/scheduler/tiers.ts`, "Row 019-12: `RunOptions.priority` from `tier.priority`"), set `RunOptions.priority` from `tier.priority`.
2. **Lane helpers.** At the four places marked "019-10 integration" (`src/core/daemon/slow-instance.ts` twice, `src/runners/node-test/adapter-project.ts`, `src/runners/pytest/adapter-run.ts`), use `isGroupLane` and `groupLane` from `src/core/types/scheduler.ts`.
3. **Slot.** `slotDirOf` (`src/core/scheduler/group-limits.ts`) becomes `slotFiles(group, scope).dir(base, commonDir)` from `src/core/slow/slot-files.ts`, and the slot calls in `slow-tier.ts` pass `group` (`acquireSlowSlot`, `slowSlotHeld`, `markSlotWaiter`, `clearSlotWaiter`, `othersWaitingForSlot`). The scope is `capacity.groupSlotScope` from the host config (`loadUserConfig`, `src/core/daemon/user-config.ts`): carry it with the capacity the daemon already reads (`capacityReader` / `Capacity`) into the scheduler's slow-tier options, with the repository's common dir. Default per repository (spec D3).
4. **One `poolLaneOf`.** Keep `poolLaneOf(priority)` in `src/core/capacity/pool.ts`; the scheduler's `poolLaneOf(group)` in `group-limits.ts` calls it with the group's priority.

Owns: the files named above, `src/core/scheduler/slow-tier.ts`, `src/core/types/capacity.ts`, the daemon's capacity reader and where it builds scheduler options, and tests. Done when: tests show (a) a `low` group's runner gets `priority: "low"` and a `normal` one `"normal"`; (b) a configured Vitest group lane gets its own instance; (c) two repositories' default `slow` groups hold independent permits under the default scope and share them under `"user"`, and a configured group's files are `group.<name>.*.lock`; (d) with no `checks` and scope `"user"`, slot paths are today's byte for byte; the test files of the four rows still pass by `squeal status --wait` on the changed paths (do not wait for the whole queue; report pending as pending); lint and typecheck pass. Do not run the build.
