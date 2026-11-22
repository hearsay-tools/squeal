# 024: Performance improvements - status

- **Stage:** in-progress (approved by the human 2026-11-22: `/coordinator get it done`)
- **Coordinator:** `201d84ee`
- **Target candidate:** `0.1.600` (coordinated with spec 023 coordinator `d36c4d53`, which holds `0.1.598` and `0.1.599`)

## Amendments

- 2026-11-22: Initial spec (`D1` to `D5`) created from full repository performance audit against `bench/results/TREND.md` and `0.1.598` (`22be8a3c4`). Wave 1 rows `024-01` through `024-05` dispatched in parallel.
- 2026-11-22 (coordinator `201d84ee`, during Wave 1 and review `0.1.600.md` repair):
  - **D2.4 (review B2):** `withStatusStore` stays strictly read-only for every schema version (older schemas report unavailable so a writer migrates them; never double-closes raw handles or masks `SQLITE_BUSY`).
  - **D3.1 & D3.3 (integration & review S1):** `provider.mjs` carries executed script paths directly on coverage batches so `coveredFiles` avoids disk JSON reads; `putPartsBatch` commits in two transactions separated by a `sent()` barrier (parts then manifests) so manifests never precede their parts under the store process.
  - **D4.2 & D4.4 (worker conflict & review B1):** Idle change-feed backoff keeps the 30 s `onDelivered` heartbeat on the queue (`FEED_LATE_MS` stays 60 s) while backing off full `git status` + tracked-path scans to 300 s; `recorder.cjs` deduplicates `realpath` per multi-kind `load()` call without cross-file caching so retargeted symlinks never attribute stale targets.
  - **D5.3 (worker Option A & review B3):** Wave 1 narrows bulk slicing to unchanged-file stat-cache updates in `reconcileBatch`; changed-file reconciliation, `startTier`, `#write`/`recordTier`, and zero-row prune slices are explicitly deferred to Wave 2 pending the paired boat.dev benchmark measurements on `0.1.600`.
