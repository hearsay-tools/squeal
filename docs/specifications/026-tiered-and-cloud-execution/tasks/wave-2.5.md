# Spec 026 Wave 2.5 repair briefs (against `reviews/0.1.617.md`)

Prior review: `docs/specifications/026-tiered-and-cloud-execution/reviews/0.1.617.md` (`FAIL` on `58850cc2ab4be2e0586b095078513db742a9741f`, 3 proven blockers B1–B3, 0 should-fix, 0 nits).

All three repair workers below have strictly disjoint file ownership and run in parallel.
Workers: follow `/worker` skill, read `reviews/0.1.617.md` for your exact blocker section and probe schedule, test first (reproduce the red probe before fixing), do NOT run `pnpm run build`, do NOT bump versions, do NOT edit `docs/board.md`, and do NOT run a local full suite. Run `pnpm run lint`, `pnpm run typecheck`, `squeal status --wait 60000 <changed-paths>`, and targeted `pnpm exec vitest run <test-files>`.

---

## Repair 026-w2-r1: Fix B1 — shared remote connect queue & pending acquire on shutdown

- **Review finding:** `reviews/0.1.617.md` B1 (lines 93-140).
- **Model:** `claude` / `opus` / `high`.
- **File ownership:**
  - `src/core/runner-host/remote/machine-share.ts`
  - `src/core/runner-host/remote/daemon-lane.ts`
  - `src/core/runner-host/remote/lane.ts`
  - `test/runner-host/remote/machine-share.test.ts`, `test/runner-host/remote/daemon-lane*.test.ts`, `test/runner-host/remote/lane*.test.ts`, `test/runner-host/remote/vitest-lanes.test.ts`
  - Do NOT edit `tree-host.ts` (`026-w2-r2`), `daemon.ts`, `bootstrapped.ts`, or `status-stale.ts` (`026-w2-r3`).
- **Requirements:**
  1. Reproduce BOTH proven B1 failure schedules first in tests:
     - **Schedule 1 (held `startHost`, two eager lanes):** `createDaemonRemote()` with eager Vitest + `node:test`, fake provider, held first `startHost`. Close both lanes and call `remote.release()`. Release must wait for in-flight connect work to settle/cancel, close the started Vitest host, MUST NOT start the queued `node:test` host after shutdown begins, close the ControlMaster, and call `machine.release("daemon-exit")` ONCE at the end.
     - **Schedule 2 (delayed `provider.acquire()`):** delay `provider.acquire()`, call `share.release()` while `current()` is `null`, then resolve `acquire()`. `release()` must wait for the in-flight acquire (or immediately release/detach the machine once acquire resolves), MUST NOT leave an `"awake"` machine record or un-released machine, and must invoke `machine.release("daemon-exit")` once.
  2. Make shutdown (`release()` / lane `close()`) stop all new and queued connect/host-start work (rejecting or short-circuiting queued waiters without calling `reach()`, `wake()`, or `startHost()`), drain/settle in-flight `acquire`/`wake`/`startHost` operations, close every host that was started, close the SSH ControlMaster, and then call `machine.release("daemon-exit")` once and record `"detached"`.
  3. Ensure no host start, wake, SSH channel, or `"awake"` machine record can occur after `release()` completes.
- **Done when:**
  - Both new B1 regression tests fail before the fix and pass after.
  - All existing `test/runner-host/remote/` tests (`machine-share`, `vitest-lanes`, `lane`, `lane-sleep`, `daemon-lane`, `daemon-lane-sleep`, `lane-repair`, `lane-tiers`) stay green; `pnpm run lint` and `pnpm run typecheck` pass.

---

## Repair 026-w2-r2: Fix B2 — ownership-safe remote tree `install.lock` in `tree-host.ts`

- **Review finding:** `reviews/0.1.617.md` B2 (lines 142-184).
- **Model:** `claude` / `opus` / `high`.
- **File ownership:**
  - `src/core/runner-host/remote/tree-host.ts`
  - `test/runner-host/remote/tree-host.test.ts` (and `test/runner-host/remote/tree-install.test.ts` if needed)
  - Do NOT edit `machines-store.ts`, `machine-share.ts`, `daemon-lane.ts`, `lane.ts`, `daemon.ts`, or `status-stale.ts`.
- **Requirements:**
  1. Read `reviews/0.1.617.md` lines 142-184 AND `src/core/runner-host/remote/machines-store.ts` (our proven, review-passed S1 lock protocol!).
  2. Replace the unsafe `install.lock` directory + unserialized takeover + unconditional cleanup in `src/core/runner-host/remote/tree-host.ts:224-250` with an ownership-safe lock protocol:
     - Unique owner token (`${process.pid} ${nonce}\n`) published atomically (temp file + `linkSync`, with empty/uninitialized grace fallback if hard links are unsupported).
     - Serialized stale-lock takeover (e.g., short `<lock>.break` guard re-checking exact owner text before removing a dead or expired lock so a replacement live owner's lock is NEVER removed).
     - Owner-checked release in `finally` (only remove the lock if it still holds this process's own owner token; never remove a successor's lock).
     - Keep all package-manager work strictly inside the held lock interval.
  3. Add the deterministic two-process forced takeover test matching B2's exact probe schedule (seeded dead pid; process A reads dead pid and pauses before takeover; process B takes lock and runs held fake `npm ci`; resume A; assert A does NOT remove B's live lock and does NOT enter install until B releases), plus dead-owner and empty-owner recovery tests.
- **Done when:**
  - Deterministic two-process B2 forced-takeover test + dead-owner + empty-owner recovery tests fail before the fix and pass after.
  - Existing `tree-host.test.ts`, `tree-install.test.ts`, and `connect-process.test.ts` stay green; `pnpm run lint` and `pnpm run typecheck` pass.

---

## Repair 026-w2-r3: Fix B3 — revision-0 HEAD-only change no-daemon staleness notice

- **Review finding:** `reviews/0.1.617.md` B3 (lines 185-224).
- **Model:** `claude` / `opus` / `medium`.
- **File ownership:**
  - `src/core/daemon/bootstrapped.ts`
  - `src/core/daemon/daemon.ts` (ONLY the `markScanned(...)` call around line 1178 to pass the start scan's observed HEAD)
  - `src/cli/status-stale.ts`
  - `test/cli/no-daemon-stale.test.ts`
  - Do NOT edit `machine-share.ts`, `daemon-lane.ts`, `lane.ts`, `tree-host.ts`, or scheduler files.
- **Requirements:**
  1. Read `reviews/0.1.617.md` lines 185-224.
  2. Persist the HEAD commit observed by the daemon's initial start scan without inventing a content revision row: extend `markScanned` in `src/core/daemon/bootstrapped.ts` (e.g., optional `head?: string | null` stored under `worktreeMetaKey("daemonBootstrappedHead", worktreeId)`, plus `lastScannedHead(store, worktreeId): string | null`). Pass the start scan's observed HEAD (`this.#loop?.scheduler.status().head` or `readGitHead(root)` read during start) from `src/core/daemon/daemon.ts` where `markScanned` is called (and ensure a later start overwrites/clears it cleanly if detached/unborn).
  3. In `src/cli/status-stale.ts`, fall back to `lastScannedHead(store, id)` when `recorded?.head` is absent (`latest === null` and `commit === null`), so a HEAD-only commit (`git commit --allow-empty`) after a revision-0 daemon exits prints the staleness notice naming revision 0 and the new HEAD for `status`, `code`, and `lint`.
  4. Keep an unchanged revision-0 worktree completely silent, and preserve all read-only JSON output contracts unchanged.
  5. Add a real-daemon test in `test/cli/no-daemon-stale.test.ts` matching B3's exact probe: start daemon on a fresh unchanged edit-free worktree, let it exit with no edits (revision 0), run `git commit --allow-empty -qm head-only`, and assert `status`, `code`, and `lint` all lead with the notice naming revision 0 and the new HEAD (and `status --json` stays unchanged).
- **Done when:**
  - New revision-0 HEAD-only test fails before the fix and passes after.
  - Existing `test/cli/no-daemon-stale.test.ts` and `test/daemon/short-lived.test.ts` pass; `pnpm run lint` and `pnpm run typecheck` pass.
