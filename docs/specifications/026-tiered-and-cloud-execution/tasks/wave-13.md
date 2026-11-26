# Spec 026 Wave 13: Fix remote permit-pool deadlock and worker-grant scaling (Row `026-33`, `#292`)

Spec: `docs/specifications/021-remote-store-and-execution/spec.md` (D18), `docs/specifications/026-tiered-and-cloud-execution/spec.md` (D8.1, D12), `docs/specifications/011-core/spec.md` (C10, C14).
Issue: `#292` (reopened; Jev auto-closed it as a false duplicate of `#95`).
Shape: **slice**.

## Problem

On a 4-vCPU remote VM (`defaultHostSlots() = 3`), any single-project 4-file `node-test` tier (`runner.tierSize = 4`) deadlocks forever in `remoteAdmission()`:
- `nodeTestTraits.tierWidth(_, grant)` ignores `grant` and returns `tierSize` (`4`), because `src/runners/node-test/adapter-project.ts` ignores `runOptions.workers`. (`pytestTraits` and `src/runners/pytest/adapter-run.ts` do the same.)
- `admitRun()` sends `{ want: 4, least: 4 }` for every remote tier (including edit and promoted tiers, all submitted as `kind = "backlog"`).
- `LockFilePool.acquire()` does not clamp `fewest` to `this.#hostSlots` (or `project.slots`). With `hostSlots = 3` and `fewest = 4`, `backlogShareSlots(ceiling, 3, 4) = 3 < 4`, `#take()` takes at most 3 permits and drops them (`permits.length < fewest`), `#logRefusal()` returns early (`target < fewest`), and `admit()` returns `{ grant: 0 }` with no refusal forever until daemon exit.

## Ownership

Own these files (touch nothing outside them; in particular do **not** touch `src/runners/jest/` because peer coordinator `017fb3d3` owns `028-06`, and do **not** run `pnpm run build` in the worker worktree):
- `src/core/capacity/pool.ts`
- `src/core/runner-host/remote/admission.ts`
- `src/core/runner-host/remote/lane.ts`
- `src/runners/node-test/traits.ts`
- `src/runners/node-test/adapter-project.ts`
- `src/runners/pytest/traits.ts`
- `src/runners/pytest/adapter-run.ts`
- `test/capacity/least-floor.test.ts`
- `test/daemon/runner-traits.test.ts`
- `test/runner-host/remote/admission.test.ts`
- `test/runner-host/remote/lane-admission.test.ts`
- `test/runners/node-test/adapter.test.ts` (or a new focused test file under `test/runners/node-test/`)
- `test/runners/pytest/adapter.test.ts` (or a new focused test file under `test/runners/pytest/`)

## Requirements

1. **Single-owner pool invariant (`src/core/capacity/pool.ts`):**
   - In `LockFilePool.acquire()`, clamp `fewest` to the pool's maximum acquirable permits (`poolMax = project !== undefined && project.slots >= 1 ? Math.min(this.#hostSlots, Math.floor(project.slots)) : this.#hostSlots`), so `fewest = Math.min(wanted, poolMax, Math.max(1, Math.floor(least)))`.
   - No caller (local or remote, including runners whose minimum floor exceeds `hostSlots` or `project.slots`) can ever deadlock `acquire()` with `fewest > poolMax`.
   - Confirm `#logRefusal()` still logs ceiling refusals accurately when the host is busy above the ceiling and another background tier runs.

2. **Honor `RunOptions.workers` and scale `tierWidth` by `grant` (`node-test` and `pytest`):**
   - `src/runners/node-test/adapter-project.ts`: for non-group runs (`!groupRun(runOptions.lane)`), cap `runNodeTest`'s `concurrency` by `runOptions.workers` when provided (`Math.min(tierSize, workers)` when both exist, or `workers` when `options.concurrency` is undefined, at least 1). Keep group runs starting every file as before (`groupRun(runOptions.lane)`).
   - `src/runners/node-test/traits.ts`: `tierWidth: (_, grant) => (tierSize === undefined ? undefined : Math.min(tierSize(), grant))` (remember `declareTraits` already floors at `Math.max(1, ...)` and defaults `undefined` to `grant`).
   - `src/runners/pytest/adapter-run.ts` and `src/runners/pytest/traits.ts`: apply the exact same `runOptions.workers` cap (for non-group runs) and `tierWidth(_, grant)` scaling.
   - Update `test/daemon/runner-traits.test.ts` to assert both `grant >= tierSize` (capped by `tierSize`) and `grant < tierSize` (capped by `grant`, e.g., `grant = 1` returns `1`).

3. **Non-background remote admission stays outside the background CPU ceiling (`src/core/runner-host/remote/admission.ts`, `src/core/runner-host/remote/lane.ts`):**
   - Add optional `readonly kind?: PoolTierKind` to `AdmitAsk` (defaulting to `"backlog"` in `createHostAdmission` when omitted, preserving compatibility with existing tests and callers).
   - In `admitRun()`, set `kind: run.background === true ? "backlog" : "checkpoint"` (or omit when `"backlog"` so existing `asks` equality assertions for background runs stay clean and minimal — check `test/runner-host/remote/admission.test.ts` and `lane-admission.test.ts`!).
   - Result: remote edit tiers, focused runs, named-wait batches, and slow/group runs still acquire remote `hostSlots` permits, and are not stalled by the remote machine's background CPU ceiling while background Vitest tiers run (matching Spec 021 D18: edit tiers, named waits, and checkpoints stay outside the background ceiling).

4. **Tests (TDD: write failing tests first):**
   - `test/capacity/least-floor.test.ts`:
     - `createPermitPool({ hostSlots: 3, cpus: 4 })` with `acquire(4, "fast", 4, "backlog")` grants `3` instead of deadlocking at `null`.
     - `createPermitPool({ hostSlots: 8, cpus: 8, project: { id: "p", slots: 2 } })` with `acquire(4, "fast", 4, "backlog")` grants `2` instead of deadlocking at `null`.
     - `createHostAdmission` on 4 CPUs / 3 slots with `admit({ want: 4, least: 4 })` grants `3`.
   - `test/runner-host/remote/admission.test.ts` & `test/runner-host/remote/lane-admission.test.ts`:
     - Remote edit tier (`background` absent) on a 4-vCPU / 3-slot remote host with 4 `node-test` files (`tierSize = 4`) is admitted immediately (even above the background CPU ceiling while another background tier runs!) and receives `workers <= 3`.
     - Remote background tier (`background: true`) still respects the background CPU ceiling.
   - `node-test` and `pytest` adapter tests:
     - Passing `runOptions.workers = 1` (or `2`) with `concurrency: () => 4` caps actual concurrent child processes to `1` (or `2`), while omitting `workers` still runs up to `concurrency()`.
     - `groupRun` (`lane: "group:..."` / `"slow:..."`) keeps starting all files in the tier.
   - Verify no key changes (`pnpm exec vitest run test/keys/key-format.test.ts`), `pnpm run lint`, `pnpm run typecheck`, and Squeal affected status (`squeal status --wait 60000 <changed-paths>`). Do **not** run a full test suite or `pnpm run build`.

Use /worker.
