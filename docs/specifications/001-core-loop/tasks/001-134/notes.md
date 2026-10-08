# 001-134 notes: observed inputs keyed soundly

Evidence for the board row's done-when, and the seams a later worker needs. `first-seen.ts` is an evidence driver, not product code.

## B1: a path first seen during a run

- "Pre-run evidence" is the stat cache: a path whose hash or known absence it held when the tier was selected. `WorktreeKeys.beginRun` (called by `selectTier`) clears `#firstHashed`; every path `#seed` hashes afterwards joins it, whether `observedGrowth`'s own `track` after the run or a `trackUntracked` during it. `firstHashedDuringRun(path)` is the test.
- `observedGrowth` returns `firstSeen` per file: growth file paths first hashed during the run. Listings are not in it: D5 bounds a listing by the revisions during the run.
- `recordTier`: unstable inputs discard as before; otherwise a file with `firstSeen` stores nothing, its paths are merged (`addObserved`), `settle` moves it to the new key (looking it up first: another worktree's full-key result is legitimate), and `Ledger.rerunFirstSeen` counts the re-run with `discards`, so the third in a row is `unknown`.
- A path known absent before the run is not `firstSeen`: the stat-cache comparison sees it appear. A path the watcher reported during the run is not `firstSeen` either (the reconciliation, not `#seed`, put it in the cache), and `Ledger.tierChanges` discards the run.
- Probes: `test/scheduler/first-observation.test.ts`: the review's absence check unreported, read through a directory link nothing cached, and reported by a watch batch mid-run (an edit tier: a watch batch cancels a backlog tier, which would not probe anything); the second worktree with the file present has the same key, zero runs and `fail/current`. A test reading a new path every run runs three times and ends `unknown`. With the `firstSeen` branch disabled, the unreported, link and bound cases fail; the watched case passes either way (it was already covered by `tierChanges`).

## B5: recursive listings

- Node's recursive `readdir` walks below the public wrappers, so the recorder sees only the call. Agreed through the coordinator: 001-135's recorder records kind `r` (a directory listed with `recursive: true`, also recorded as `l`) and fills `ObservedInputs.recursive`; this row added that field (additive) and the expansion.
- `observedGrowth` expands each recursive root with `Listings.below`: its own listing path and the listing path of every directory below it that holds a tracked file. The observed set and the store encoding stay plain listing paths; no encoding version changes. A directory created later is an entry of its parent's listing, so it re-keys too; the next run expands again.
- Probe: `test/scheduler/recursive-listing.test.ts` supplies `recursive` for the tree test while the recorder does not report it, and never over what it reports, so it exercises the real recorder once 001-135 lands. A nested add re-keys and fails, its removal returns to the first key and its pass, a nested removal of an original file re-keys and fails; the shallow-listing test's key never moves. With the expansion disabled it fails.

## Cost on `cezar`

`first-seen.ts` (run as its header says: without the orchestrator's `CEZ_*` variables and with cwd in the clone, because `cezar`'s mock agents write to `CEZ_HANDOFF_FILE`, `CEZ_TODOS_FILE` and their cwd; a first attempt without that wrote `notes.md` into this worktree and lines into its handoff, all removed) on a fresh clone of `cezar` at `1c97556a` (the 001-132 measurement commit), `npm ci`, a fresh store; one daemon start through the real scheduler, policy defaults with `observe.runtimeInputs: true` and `runner.timeoutMs: null` (a first attempt at the default 600 s timed out its first 200-file tier under load 50, and a timed-out tier's files observe nothing). Linux, Node 24.21.0, 24 cores, load 4 to 50 from other sessions.

| Tier | Files | Wall |
| --- | --- | --- |
| 1 | 200 | 586 s |
| 2 | 200 | 479 s |
| 3 | 200 | 70 s |
| 4 | 85 (the last 40, and 45 re-runs) | 568 s |
| 5 | 1 re-run | 7 s |

- **46 of 640 files re-ran once** on first observation (45 `server`, 1 `web`); 594 ran once; none ran a third time, none ended `unknown`. Total 1,749 s wall from start to idle.
- Their second runs summed 1,909 s of file time, against 8,707 s for every file's first run (22%): they are the heavy `server` files that spawn mocks and walk the filesystem. Their first runs alone summed 3,598 s.
- What made them first-seen: 205 distinct paths, **all absent** after the run (checked on disk once it ended). Node's resolution probing `package.json` up the tree (`packages/cezar/src/package.json` in 82 files' observations, one per source directory), a root `tsconfig.json` (78), agent config lookups (`.cursor/cli.json`, `.pi/*`), and spawn arguments the recorder took for paths (`pr`, a JSON string; 001-135's recorder, not this row). Per re-run file, p50 2 such paths, max 145.
- 98 files observed such a path; only the 46 whose tier hashed it first re-ran. Once a tier hashes a path, later tiers hold it (known absent), so the cost is once per path per worktree. The observed set is shared, so a second worktree keys with those paths before its first run and re-runs nothing for them (the B1 probe's second worktree: zero runs; not measured on `cezar`).
- The offline attribution in the driver counts a path not listed by git as first-seen; snapshot paths are in every static closure (known absent before the run) and are excluded above by hand. The scheduler's own count is the 46.
- A decision the spec did not need and the coordinator may want: a first-seen path absent at prepare time could be accepted as stable, which on `cezar` would remove all 46 re-runs, at the price of missing a file created and deleted within one run. Not done: the brief decided to discard.

## Seams

- `src/core/scheduler/keying.ts`: `beginRun`, `firstHashedDuringRun`, `listingsBelow`.
- `src/core/scheduler/observed.ts`: `ObservedGrowth.firstSeen`, the recursive expansion.
- `src/core/scheduler/tiers.ts`: `selectTier` calls `beginRun`; `recordTier`'s `firstSeen` branch.
- `src/core/scheduler/ledger.ts`: `rerunFirstSeen`.
- `src/core/keys/observed.ts`: `Listings.below`.
- `src/core/types/runner.ts`: `ObservedInputs.recursive`.
