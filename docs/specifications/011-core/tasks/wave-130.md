# Wave 130: one request and activity read per header (row 011-427)

The human, 2026-11-27 (session bca5dbc3): "Start the approved rows". Coordinator b468025e. One worker, one candidate with a version raise, review on the exact `cand/<version>` SHA.

## Row 011-427 (worker; shape: slice)

**Outcome.** One header read reads the published requests and lane activity once, and `onRequestFiles` and `groupTiersOf` share that read; a new header read reads them fresh again.

**Evidence.** `reviews/0.1.650.md` S1 and `reviews/0.1.652-r2.md`: with a held group, +0.257 ms per header read (1.007 to 1.263 ms) at 98 held files of 2,000; none without a held group.

**Read.** `docs/styleguide.md`; spec 011 C6; `src/core/state/header.ts` (`headerWith`, line 112), `src/core/state/groups.ts` (`groupTiersOf`, `requestedOf`, `onRequestFiles`), `src/core/state/slow.ts` (`liveActivity`), `src/core/status/snapshot.ts` (full status calls `onRequestFiles` again, around line 172). Lead: read requests and activity once in `headerWith` into a small per-read context and pass it to both callers.

**Owns.** `src/core/state/`, `src/core/status/snapshot.ts`, their tests, `docs/specifications/011-core/tasks/011-427/`. Not `docs/board.md`, `package.json`, bundles, `spec.md`. No change to text or JSON output.

**Done when.**
- A test counts the request and activity store reads per header read with a held group: one each (fails before, passes after); a second header read after a new request sees it.
- `pnpm run lint`, `pnpm run typecheck`, `squeal status --wait 60000 <changed-path>...` read and reported. A direct `vitest run` names its files and runs under `timeout 600`. No build, no full suite, no bench run (the coordinator runs the paired `@hooks` cells on boat.dev).
- Commits on the worker branch; the final message lists decisions the spec did not settle and any type change.

Use /worker.

## Review of candidate 0.1.660 (reviewer; shape: review)

Candidate `cand/0.1.660` at `6d18c2ec6` (row 011-427 commits plus the 0.1.660 bundle commit) against base `b80ed26c0` (main when integrated). Read this brief, `reviews/0.1.650.md` S1 and `reviews/0.1.652-r2.md`. Check: one request and activity read per header read; a new request between two header reads is seen; callers without a shared read (`status-wait-settled.ts`, `readGroupTiers`, `readLane`) read fresh; no text or JSON output change; the worker's open point on several groups (activity read once per group name). Use Squeal results and CI run 46061876349; targeted checks only, no full suite. Write `reviews/0.1.660.md` with verdict, evidence, blockers, should-fix, nits.

Use /reviewer.
