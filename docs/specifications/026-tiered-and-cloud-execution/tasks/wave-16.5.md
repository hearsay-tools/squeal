# Spec 026 Wave 16.5: repair row `026-43` after review 0.1.667 FAIL

Review `reviews/0.1.667.md` (FAIL on `5f1a55e7c`) proved two ways the unused prune deletes a machine a live daemon uses. Shape: **repair**, on worker `0a8f9945`'s branch. Use /worker.

**B1. Unknown liveness keeps the machine.** `recordedDaemon` (`daemon/ensure.ts`) returns `null` on a store-open failure, so `liveDaemonRecorded` says "no daemon". Give the prune a three-way read: alive, confirmed absent, unknown. Unknown keeps the machine at selection and at the recheck, and the prune says why. Leave the Boolean helper as it is for its other callers.

**B2. Prune and daemon reuse exclude each other.** Lead: a claim in the registry, under its lock. The prune moves a record to a new status `deleting` only if its id, status and timestamps are unchanged and liveness is confirmed absent. It then releases and forgets that exact claim. A daemon's acquire or reuse (`machine-share.ts` `reachOnce`, about line 291, and the providers' acquire paths that read the record) also claims under the lock, before it wakes the machine: an `awake` claim beats a later `deleting` CAS. A daemon that finds `deleting` does not reuse that id; it acquires a new machine. A `deleting` record left by a prune that died is released again by the next prune. Keep abort propagation and the async lock wait. No store-schema or key change.

**N1 (fold in).** An old scopeless awake or sleeping record that the automatic prune claims is judged in the same run, with the same liveness guard.

**Owns:** as wave 16 W1, plus `src/core/daemon/ensure.ts` for an added three-way reader. Do not edit `docs/`. Do not run `pnpm run build`.

**Done when:** the review's two probes are tests through the real liveness reader and separate processes: a fresh daemon with an unreadable store keeps its machine; a reattach of the same id after selection and before release keeps the machine and its record; a daemon that meets `deleting` gets a new machine; a stale `deleting` record is released by the next prune; N1 in one run. The eight affected files from the review pass. Lint, typecheck, `squeal status --wait 60000 <changed paths>`.
