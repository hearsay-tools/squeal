# 011-15 worker notes

C6 as amended 2026-10-18 (gh-34). Commits `2519eda4`, `3b552b75`.

- One split, `splitByValidity` / `knownFailureCounts` / `earlierFailuresLines` in `src/core/status/checks.ts`; any validity but `current` and `pending` counts as stale (Stop's `unrun` bucket did the same). Status (`format-status.ts`), registration (`delivery/format.ts`) and Stop (`harness/shared/text.ts` `knownFailuresLine`, now taking `{ check, validity }`) call it. `newsText` in `stop.ts` passes known states, not checks.
- `status --json`: `knownFailureCounts { current, pending, stale }`, optional on `StatusSnapshot` (additive), set in `status/snapshot.ts`. The text derives from `knownFailures`, so older payloads render the same.
- Every FAIL entry stays listed under the count, naming its validity; `Earlier failures` sits right after `Known failures`, before the entries.
- `KEY_FORMAT_VERSION` raised to 12 rather than re-pinned: tag `squeal--v0.1.215` carries 11 at `c484…`. Parallel rows 011-16/011-17 will collide here; the integrator re-pins 12 once.
- Not changed, outside ownership: `src/cli/status-wait-lines.ts:272` (`Worktree: known failures N`) still counts every validity; `collapse.ts` `still failing:` too. A follow-up row could route both through `splitByValidity`.
- Out-of-row edits forced by the signature change: `test/runners/vitest/setup-failure.test.ts` (one call), `test/harness/session-start.test.ts` (the 40-failure cap test's failures are stale, so it now reads `Known failures: 0` plus the earlier line).
- Pre-existing in daemon runs in every worktree since 2026-10-17, pass under `npx vitest run`: `observe-fidelity.test.ts` and `node-test/run-reads-fidelity.test.ts` (001-390 recorder).
