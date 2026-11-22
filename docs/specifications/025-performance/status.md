# 025: Performance improvements - status

- **Stage:** in-progress (Wave 1 landed in `0.1.600`, 2026-11-22; approved by the human 2026-11-22: `/coordinator get it done`)
- **Coordinator:** `201d84ee`
- **Landed:** Wave 1 (`025-01`..`025-05`) in `0.1.600` (candidate CI `45074688588` green on `7633b6de4`, private CI `45074688553` green, Codex reviews `0.1.600-r2.md`, `0.1.600-r3.md`, and `0.1.600-validity.md` PASS; paired boat.dev scorecard `bench/results/2026-11-22-0.1.597-vs-0.1.600-default-AMD-Ryzen-7-9700X-8-Core-Processor/scorecard.md`: `ref` 71→88, `size-l` 46→61, `wt-3` 70→75, `store-7g-wt3` 63→68, Correctness PASS)

## Amendments

- 2026-11-22: Renumbered from `024-performance` (rows `024-01`..`024-05`) to `025-performance` (rows `025-01`..`025-05`) before landing on `main` because `024-antigravity-adapter` (`54e28826b`, `a7f479fdd`) landed on `main` first. Earlier Wave 1 worker notes, code comments, and review files (`0.1.600.md`, `0.1.600-r2.md`, `0.1.600-r3.md`) refer to the original `024` numbering. Rebased cleanly onto `0.1.599` (`3e30055c1`, zero shared `src/` or `test/` files with `0.1.599`).
- 2026-11-22: Initial spec (`D1` to `D5`) created from full repository performance audit against `bench/results/TREND.md` and `0.1.598` (`22be8a3c4`). Wave 1 rows `025-01` through `025-05` (originally `024-01`..`024-05`) dispatched in parallel.
- 2026-11-22 (coordinator `201d84ee`, during Wave 1 and review `0.1.600.md` repair):
  - **D2.4 (review B2):** `withStatusStore` stays strictly read-only for every schema version (older schemas report unavailable so a writer migrates them; never double-closes raw handles or masks `SQLITE_BUSY`).
  - **D3.1 & D3.3 (integration & review S1):** `provider.mjs` carries executed script paths directly on coverage batches so `coveredFiles` avoids disk JSON reads; `putPartsBatch` commits in two transactions separated by a `sent()` barrier (parts then manifests) so manifests never precede their parts under the store process.
  - **D4.2 & D4.4 (worker conflict & review B1):** Idle change-feed backoff keeps the 30 s `onDelivered` heartbeat on the queue (`FEED_LATE_MS` stays 60 s) while backing off full `git status` + tracked-path scans to 300 s; `recorder.cjs` deduplicates `realpath` per multi-kind `load()` call without cross-file caching so retargeted symlinks never attribute stale targets.
  - **D5.3 (worker Option A & review B3):** Wave 1 narrows bulk slicing to unchanged-file stat-cache updates in `reconcileBatch`; changed-file reconciliation, `startTier`, `#write`/`recordTier`, and zero-row prune slices are explicitly deferred to Wave 2 pending the paired boat.dev benchmark measurements on `0.1.600`.
