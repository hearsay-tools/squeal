# 017-33 notes: lint status names its wait for CPU (gh-238)

Worker 4dbd17eb, wave 123 W5, 2026-11-19. Baseline includes 011-404 (the background bar is the CPU ceiling alone).

## What changed

- `src/core/lint/pass/cpu-wait.ts` (new): the lint store's `lint-cpu-wait:<scope>` meta record, one per tool scope: `{ since, at, busy, limit }`. `refusedCpu` writes it at the first refusal and again at most every 10 s (`CPU_WAIT_REFRESH_MS`) while refusals go on, keeping `since`. `grantedCpu` drops it. `readCpuWait` reads it as of `now`; a record not written within 30 s (`SLOT_WAITER_FRESH_MS`, the pool wait's freshness) reads as no wait.
- `src/core/lint/pass/parts.ts` `takeSlot`: after the backlog `take`, a refusal records the gate (`capacity.backgroundGate()`), a grant drops the record. Edit parts (`running(1)`) and no pool record nothing. No scheduling change: the same `take`, the same recheck.
- `src/core/lint/pass/types.ts`: `LintCapacity` gains the optional `backgroundGate()`.
- `src/core/lint/surface/snapshot.ts`: `progressOf` gains an optional `now` (default `Date.now()`) and adds `cpuWait` (new `cpuWaitOf`: with two tools waiting, the one that waits longest).
- `src/core/lint/surface/format.ts` `lintingWords`: `linting, 0 of 3,457 files; waiting for CPU (21 busy, limit 18)`. Without busy CPUs read: `waiting for CPU (limit 18)`. Busy CPUs round to whole numbers, the limit to 0.01. Status and registration both use it.
- `src/core/lint/surface/deliver.ts` `registerLint`: passes its `at` as `now`.
- Outside W5's files, by agreement with coordinator 4abb5168 (request 18f8ec0c, own commit): `src/core/scheduler/capacity.ts` `TierCapacity.backgroundGate()`; `src/core/types/lint-delivery.ts` `LintProgress.cpuWait?` and `LintCpuWait`.
- Test: `test/lint/surface/cpu-wait.test.ts` (4 tests).

## Type and JSON changes (all additive)

- `LintProgress.cpuWait?: LintCpuWait`, new `LintCpuWait { since: EpochMs; busy: number | null; limit: number }` (`src/core/types/lint-delivery.ts`).
- Status JSON: `lint.linting.cpuWait = { since, busy, limit }` while the wait lasts; absent otherwise. The registration's `linting` carries it too. W3's "Status JSON" reference (011-407) may want to name it.
- `TierCapacity.backgroundGate(): { busy: number | null; limit: number } | null`: `busy` is the pool's `PoolGate.busyCores` at the last look, `limit` is `backgroundCeiling(backgroundShare, cpus)`, the same ceiling the pool compares (`TierCapacity` resolves the share as the pool does).
- `LintCapacity` = `SharedCapacity & { backgroundGate?() }`. `SharedCapacity` itself is unchanged.
- New lint store meta key `lint-cpu-wait:<scope>`. No schema version change: meta is key/value.

## Decisions the brief did not settle

1. **Where the wait lives.** Status runs in another process, so the pass writes the wait to the lint store's meta, as 011's pool wait does in the main store. The pass is recreated at each nudge, so it compares with the stored record, not with memory.
2. **Freshness and refresh.** Same as 011's pool wait: rewrite every 10 s, forget after 30 s without a rewrite. A pass that ends (lint off, nothing left) leaves at most 30 s of a stale wait; a daemon restart has the same bound. I did not tie it to the daemon's start time (the lint store has no such stamp at hand).
3. **Only while `linting` is shown.** `cpuWait` is a field of `LintProgress`, so it shows only while a first or config keying's files wait (D7, D8). A refused idle re-lint of stale whole-program files records the wait but status does not show it: there is no `linting` line then. I judged a line for that case out of scope.
4. **No gate, no wait.** If the pool gives no gate (a `SharedCapacity` without `backgroundGate`, or no look yet), the refusal records nothing. With the scheduler's `TierCapacity` this does not happen after a `take`.
5. **`busy` is the gate's counted cores**, the same number the pool's refusal log line names (the larger of the host's busy cores and the marks'), not raw load.
6. **`squeal lint` details** (`src/cli/lint-report.ts`, `Linting, N of M files.`) do not show the wait: not my file. Its JSON carries `cpuWait` if that reader passes `LintProgress` through (it uses `progressOf` via `report.ts`).

## Proposed spec amendments (the coordinator lands them)

**017 D7**, append to the last paragraph:

(amended 2026-11-19, row 017-33, gh-238) While the pool refuses a part's backlog lease, the pass records the wait with what the pool read: the busy CPUs it counted and the background limit (spec 021 D18). It writes the record at the first refusal and at most every 10 s while refusals go on, and drops it at a grant; a record not written for 30 s is not a wait. Status and registration then read `Lint: linting, 0 of 3,457 files; waiting for CPU (21 busy, limit 18).`, and `--json` adds `linting.cpuWait: { since, busy, limit }` (`busy` null when the host was not read). The wait changes no scheduling.

**017 D9**, add a row:

| The pool refuses a part's backlog lease (CPU above the background limit) | the part's files stay `pending` | status and registration name the wait: `linting, N of M files; waiting for CPU (21 busy, limit 18)`, JSON `linting.cpuWait` (row 017-33) |

## Checks

See the final report in the task; summary:

- `pnpm run lint`: `biome check .`, 3778 files, no fixes, no warnings.
- `pnpm run typecheck`: exit 0.
- `pnpm exec vitest run test/lint/surface/ test/lint/pass/parts.test.ts test/delivery/registration-form.test.ts`: 17 files, 79 tests passed.
- New test fails before the change by construction: `linting.cpuWait` and `backgroundGate` did not exist.
- e2e: no file under `test/e2e/` names the changed paths or the `linting, ` text; none run.
- `squeal status --wait 60000 <changed paths>` at revision 14: no verdict; the selection is about 1,203 test files (the changed files are read by most of the suite) and Vitest had not listed revision 14 after 61.8 s; known failures 0. Unknown, not passing.
