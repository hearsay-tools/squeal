# 004 wave 0 briefs

Two rows in parallel. Read `docs/vision.md`, `docs/styleguide.md`, `docs/specifications/004-slow-suites/spec.md` (approved, with the 2026-10-08 amendments in `status.md`) first. Another coordinator works on spec 001 in this repository: stay out of `src/core/scheduler/`, `src/core/keys/`, `src/core/watcher/`, `src/runners/vitest/`. Do not run `npm run build`. Keep scratch in one `/tmp` directory of your own and remove it; no CPU burners; never delete or kill what you did not start.

## 004-10 slow policy keys

Outcome: a project can declare its slow suites and tune them, and the daemon can ask whether a test file is slow.

Read: spec 004 D1 and D7; spec 001 D11; `src/core/types/policy.ts`, `src/core/daemon/policy.ts`, `src/core/daemon/policy-node-test.ts` (the per-entry pattern), `plugins/claude-code/skills/squeal/references/policy.md`.

Shape: slice. Test first. Seam: `src/core/types/policy.ts`: `Policy.slow: { include: readonly string[]; maxWorkers: number; maxLoadPerCpu: number; maxDeferMs: number }` with defaults `[]`, 2, 1.0, 600000; `NodeTestProject.slow?: boolean`; `Policy.stop.requireSlowSuite: boolean` (default false). Validation in a new `src/core/daemon/policy-slow.ts` used by `loadPolicy`, by 001 D11's rules (a bad value is one problem and its default; an unknown key under `slow` is a problem; an `include` glob that does not compile is dropped with a problem). Then `src/core/slow/classify.ts`: `slowFiles(policy, projects)` returning `isSlow(testFile: TestFileRef): boolean`, true when the path matches `slow.include` or the file's project is a `nodeTest` entry with `slow: true`. `squeal init` writes the defaults through `DEFAULT_POLICY` as today. One row per key in the skill's `references/policy.md`.

Owns: `src/core/types/policy.ts`, `src/core/daemon/policy.ts` (the call), `src/core/daemon/policy-slow.ts`, `src/core/daemon/policy-node-test.ts` (the `slow` field only), `src/core/slow/classify.ts`, `plugins/claude-code/skills/squeal/references/policy.md`, `test/policy/**`, `test/slow/classify.test.ts`. Leave alone: `src/core/slow/` other files (004-11), everything listed in the preamble.

Done when: loader tests accept the full object and each default, reject each bad value with one problem; `isSlow` on globs, a slow `nodeTest` project and a file matching neither; the `DEFAULT_POLICY` pin updated; lint, typecheck, full suite green. Report every type change.

Use /worker.

## 004-11 the slow slot and the load guard

Outcome: two building blocks the slow tier will use: a per-user slot that lets one slow file run at a time across every worktree on the host, and a load guard that defers a slow file under pressure for a bounded time.

Read: spec 004 D2 (the slot), D3 (the guard), D10; spec 001 D10 (the per-user directory `/tmp/squeal-<uid>` and its owner and mode checks, `src/core/daemon/paths.ts`); `research/slow-suite-runtime.md` 1 and 2.

Shape: slice. Test first. Seam: a new `src/core/slow/slot.ts`: `acquireSlowSlot({ dir, owner, signal }) -> { release() } | null` over an exclusive lock file `slow.lock` in the per-user directory (an `O_EXCL` create holding the owner's pid and worktree id, or `node:sqlite` exclusive locking as 001's daemon lock does: pick the one that frees itself when the holder dies, and say why); a lock held by a dead pid is reclaimed. Then `src/core/slow/guard.ts`: `waitForCapacity({ maxLoadPerCpu, maxDeferMs, recheckMs = 15000, load = os.loadavg, cpus = os.availableParallelism, sleep, now }) -> { waitedMs, ranUnderLoad: number | null }` that returns at once below the threshold, rechecks while above, and returns at the deferral bound with the load it ran under. Inject time and load for tests. No scheduler wiring.

Owns: `src/core/slow/slot.ts`, `src/core/slow/guard.ts`, `src/core/slow/index.ts`, `test/slow/slot.test.ts`, `test/slow/guard.test.ts`. Leave alone: `src/core/slow/classify.ts` (004-10) and everything listed in the preamble.

Done when: two processes take the slot in turns (a test that spawns two children); a holder killed with SIGKILL leaves a slot the next taker gets; the slot directory's owner and mode are checked as 001 D10 does; the guard returns at once below the threshold, defers while above, and returns at the bound with the load, with fake time; lint, typecheck, full suite green.

Use /worker.
