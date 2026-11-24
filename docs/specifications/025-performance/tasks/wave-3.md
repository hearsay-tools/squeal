# Spec 025 Wave 3 briefs (`025-10` to `025-13`)

Coordinator: `0266d2c5` · Date: 2026-11-24 · Base: `main` after `0.1.628` (Wave 2).

Shared rules for every worker in Wave 3:
- Work strictly inside your listed file ownership. Message the coordinator before editing any unlisted file.
- Never edit `docs/board.md`, `package.json`, `install.sh`, `plugins/*/dist/*`, or `plugins/codex/hooks/hooks.json`.
- Never run `pnpm run build` or `pnpm run build:codex-adapter` in a worker tree (the coordinator owns the single integration rebuild).
- Never bump `SCHEMA_VERSION`, `CODE_SCHEMA_VERSION`, `KEY_FORMAT_VERSION`, or `RECORDER_VERSION`.
- Verify with Squeal affected-test results (`squeal status --wait 60000 <changed-paths>`), plus `pnpm run typecheck`, `pnpm run lint`, `pnpm run check:private`, and targeted `pnpm exec vitest run --maxWorkers=2 <explicit test paths>`. Never run a local full suite.
- Commit clean, well-scoped commits on your branch, write brief worker notes at `docs/specifications/025-performance/tasks/<row>-notes.md` (except `025-12`, which writes its research report), and report commands and exact observed results in your final summary.

---

## Row `025-10`: Deferred bulk write slicing guided by `025-09` write-wait data (D10)

**Model:** `claude` `opus` `high` (`--skill worker`).

**Evidence from paired `0.1.623` vs `0.1.626` `@hooks` benchmark (`stress@0.1.626/logs/`):**
D9 measured 8 long hook write waits (257–827 ms) in `stress@0.1.626`. The daemon logs pin the exact write-lock offenders on `store.sqlite`:
1. `#write < Ledger.commit < retryWhileBusy; 11501 rows written` — **542–628 ms** (secondary-worktree startup baseline adoption / initial `Ledger.commit`).
2. `reconcileBatch < #pass < withBusySlice; 8005 rows written` — **430 ms** (broad edit on `src/core.ts` invalidating 500 test files in one transaction).
3. `#write < #record; 28–122 rows written` — **250–369 ms** (tier/slot recording under 6-worktree lock contention, including `startTier` / `recordTier`).
4. `SlicedPrune` (`src/core/daemon/sliced-prune.ts` + `src/core/store/prune*.ts`) — slices that delete 0 rows still take a write lock and sleep `turnGapMs`.

**Goal:** Cut >250 ms SQLite write-lock holds and front-desk hook write-wait tails without weakening atomicity or revision-classification coherence:
1. **Startup / bulk `Ledger.commit` slicing (`src/core/scheduler/bootstrap.ts`, `src/core/scheduler/ledger.ts`):**
   - Inspect how `bootstrap` / `applyBaseline` builds and commits the initial 11,500+ rows (key rows + known states + stat cache).
   - Slice the bulk write into bounded chunks (e.g., `WRITE_SLICE_FILES = 200` files per transaction with `setImmediate` event-loop yields between slices, letting front-desk hook writes run between slices), while keeping readers coherent (do not expose a half-populated worktree as listed/settled before the final slice commits the baseline marker/revision!).
2. **Broad-edit `reconcileBatch` slicing (`src/core/scheduler/batch.ts`, `src/core/scheduler/ledger.ts`):**
   - Preserve the D5 review B2 invariant: readers must NEVER observe a new revision whose classification lags.
   - Where `reconcileBatch` currently writes stat-cache updates for changed files and hundreds of rekeyed `test_file_keys` + `known_states` rows in one 8,005-row transaction, reduce transaction hold time safely (for example: pre-flush non-revision-coupled updates or batch/slice `known_states` / `file_hashes` writes safely, skip redundant unchanged writes, or split large bulk ledger commits across bounded slices when revision visibility is gated on the final commit). Document the exact crash/reader invariant you preserve in `025-10-notes.md`.
3. **`startTier` and `#write` / `recordTier` write-lock hygiene (`src/core/scheduler/tiers.ts`, `src/core/scheduler/record.ts`, `src/core/scheduler/tier-start.ts`, `src/core/scheduler/slow-tier.ts`):**
   - Move any pure CPU / snapshot / disk / preparation work out of `store.transaction(...)` (e.g., `copyInputs`, `runEnd`, `tierRecord`, `recordOutcome` prep that does not depend on lock-time writes, while keeping lock-time claim checks and `heldNow` semantics exact).
   - Avoid unnecessary redundant writes inside `recordTier` / `startTier` transactions and slice large multi-file tier commits if safe without exposing partial run-finish states.
4. **Zero-row prune slices (`src/core/daemon/sliced-prune.ts`, `src/core/store/prune*.ts`):**
   - When a prune slice has nothing to delete (read check outside the write lock finds 0 candidate rows, or a slice returns `0` / no write occurred), skip acquiring a write transaction and skip the inter-slice `turnGapMs` sleep so idle prunes do not hold the write lock or stall unnecessarily.
   - Preserve all existing prune safety rules (`isGone` recheck under lock, `hasIndexes`, `BUSY_SLICE_MS` retry, corruption fault handler).

**File ownership (exclusive):**
- `src/core/scheduler/{batch,bootstrap,ledger,record,tiers,tier-start,slow-tier}.ts`
- `src/core/daemon/sliced-prune.ts`
- `src/core/store/{prune,prune-keyed,prune-unused,prune-rules,prune-vacuum,prune-checkpoint}.ts`
- New/updated tests under `test/scheduler/`, `test/store/`, `test/daemon/` covering sliced bootstrap/reconcile/tier writes, reader coherence during slices, and zero-row prune skipping.
- `docs/specifications/025-performance/tasks/025-10-notes.md`

**Done when:**
- Unit and integration tests prove bounded slice sizes, reader coherence (no half-baked revision or baseline), preserved `startTier`/`recordTier` claim/hold/withhold semantics, and zero-row prune skipping.
- `pnpm run typecheck`, `pnpm run lint`, `pnpm run check:private`, and all targeted scheduler/store/prune tests pass (including `test/keys/key-format.test.ts` if any touched file is in its closure).

---

## Row `025-11`: Replace full `knownStates.list(worktreeId)` in `snapshot.ts` with targeted SQL aggregations + file-scoped reads (D11)

**Model:** `claude` `opus` `high` (`--skill worker`).

**Goal:** Eliminate full `store.knownStates.list(worktreeId)` row materialization from `squeal status` (`buildSnapshot` / `buildSnapshotWithReads`) and named waits (`src/cli/wait/named.ts`) so `status` latency stays flat even on 20,000+ check repositories, while keeping EVERY field, ordering, edge case, and byte of `StatusSnapshot` (text and `--json`) and `NamedWaitEnded` 100% identical.

**CRITICAL ARCHITECTURAL GUARD:**
- Place all new SQL aggregation queries in a **NEW** module `src/core/store/status-reads.ts` (following the exact pattern of `src/core/store/view-seed.ts`), NOT inside `src/core/store/repos/states.ts` or any module imported by the key-format validity bundle!
- Verify `pnpm exec vitest run --maxWorkers=2 test/keys/key-format.test.ts` passes with ZERO changes to `KEY_FORMAT_VERSION` or `SCHEMA_VERSION`!

**Required design:**
1. **`src/core/store/status-reads.ts` (new):**
   - Read-only SQL aggregation queries over `known_states` (and `checks` / `results` as needed), guarded by `readTransaction` and safe on older/read-only stores without writing or creating indexes:
     - `countWorktreeStates(store, worktreeId)`: validity counts (`current`, `pending`, `stale`, `unknown`), file-level validity counts (`check.kind = 'file'`), `currentByOutcome`, `fileLevelByOutcome`, `inheritedCount`, `inheritedFileLevelCount`, `importedCount`, and `inheritedSources` grouped by `(origin worktreeId, origin commit)` (excluding `check.kind = 'setup'`).
     - `listNonCurrentOrFailingStates(store, worktreeId)` (or targeted queries for: failing `known_states` via the `025-06` `known_states_non_pass` index, `pending`/`stale`/`unknown` states, and failed `setup` checks) — on a healthy worktree this returns ~0 rows instead of 20,000!
     - `filesWithChecks(store, worktreeId)`: distinct `(project, test_path)` pairs that have at least one non-setup check (for `testFilesWithoutChecks`, `breakdown`, `unknownTestFilesOf`, `countSlowPending`), plus per-file validity/pending-phase summary (`perFileStateSummary`) so `headerPart`, `laneCounts`, `groupLaneCounts`, `countNotCurrent`, `pendingPhasesOf`, and `unknownTestFilesOf` never need the full 20,000-row `KnownState[]` array!
     - `importCountsByFile(store, worktreeId)`: only queried when `listImports(store).length > 0`! Returns per-file current check count and per-`(file, import_id)` current count so `readImports` does not scan all `KnownState` objects when there are no imports (and stays SQL-aggregated when there are imports).
2. **`src/core/status/snapshot.ts`, `src/core/state/{header,header-part,file-class,groups,slow}.ts`, `src/core/status/{imports,outstanding,phase-files,unknown-files,standing}.ts`, `src/cli/{wait/named,verdict}.ts`:**
   - Update `snapshot()` to call the new `status-reads.ts` aggregations instead of `store.knownStates.list(worktreeId)`.
   - Keep `readHeader(...)` and `headerPart(...)` backward-compatible for any callers outside `snapshot.ts` that still pass `states: readonly KnownState[]`, while wiring `snapshot.ts` to the aggregated path.
   - Update `WorktreeReads` (`src/core/status/standing.ts`), `outstandingOf` (`src/core/status/outstanding.ts`), `readNamedFiles`, `src/cli/verdict.ts`, and `src/cli/wait/named.ts` so:
     - `outstandingOf` only materializes `KnownState` rows for non-current files (or uses the per-file summary directly, since current files without retries contribute nothing to `Outstanding:`).
     - Named waits (`src/cli/wait/named.ts`) use file-scoped `store.knownStates.list(worktreeId, files)` (never triggering a full-worktree `knownStates.list(worktreeId)`).
     - Any fallback consumer still expecting `WorktreeReads.states` either uses file-scoped reads or a lazy getter so normal `squeal status` never materializes all rows!
3. **Verification & equivalence proof:**
   - Write a thorough equivalence test in `test/status/snapshot-aggregation.test.ts` comparing the new SQL-aggregated `buildSnapshot` against a full-`knownStates.list` reference across: empty worktree, all-current passing checks, failures (file/test/setup), pending (queued/running + open run override), stale, unknown (with/without checks, unkeyed), inherited from multiple worktrees/commits, imported (with/without imports), slow tier and configured check groups, holds, and retries.
   - Add a SQLite/spy assertion confirming `buildSnapshot` does NOT call `store.knownStates.list(worktreeId)` with no file filter!

**File ownership (exclusive):**
- `src/core/store/status-reads.ts` (new)
- `src/core/status/{snapshot,imports,outstanding,phase-files,unknown-files,standing}.ts`
- `src/core/state/{header,header-part,file-class,groups,slow}.ts`
- `src/cli/wait/named.ts`, `src/cli/verdict.ts`
- Tests under `test/status/`, `test/state/`, `test/cli/` (add `test/status/snapshot-aggregation.test.ts`)
- `docs/specifications/025-performance/tasks/025-11-notes.md`

**Done when:**
- `buildSnapshot` never calls unfiltered `store.knownStates.list(worktreeId)`.
- Equivalence test + all existing status, state, header, outstanding, imports, named-wait, and `test/keys/key-format.test.ts` tests pass.
- `pnpm run typecheck`, `pnpm run lint`, `pnpm run check:private` pass.

---

## Row `025-12`: Research — Vitest `runner-host` idle exit & `cli/status.mjs` post-cache delta (D12)

**Model:** `claude` `opus` `high` (`--skill researcher`).

**Goal:** Produce hard measurements on Squeal's own repository so the coordinator and human can make evidence-based go/no-go decisions on two Wave 4 candidates:
1. **Vitest `runner-host` idle exit policy:**
   - Measure live Vitest `runner-host` memory (`VmRSS` + V8 `getHeapStatistics` + one V8 `.heapsnapshot` or `heap.getHeapSpaceStatistics()` / top retainers breakdown) right after a warm test run and after 60 s idle on Squeal's own repository (~1,800 test files).
   - Measure cold-start + first-edit latency of restarting `runner-host` from scratch (host spawn + Vitest init + first 1-file edit run) vs warm `runner-host` 1-file edit run (at least 3 trials each, reporting min/median/max and load average).
   - Check how Spec 026's existing `daemon.unusedExitMinutes` and moment-aware runner keying (`026-05`, `026-09`) interact with an idle `runner-host` exit policy.
   - Recommend clearly: ship an idle `runner-host` exit timer (and if so, what timeout & invariants) or reject/defer with exact numbers.
2. **Dedicated lightweight `cli/status.mjs` bundle on top of `NODE_COMPILE_CACHE` (`025-07`):**
   - Measure `squeal status`, `squeal status --json`, and `squeal status --wait 60000 <single-test-file>` (cold compile-cache vs warm compile-cache, with and without `NODE_USE_ENV_PROXY=1`) using the shipped `plugins/claude-code/bin/squeal` wrapper on `0.1.628`!
   - Break down the wall-clock time into: POSIX `sh` wrapper, Node boot + ESM parse/eval of `dist/cli/squeal.mjs` (cold vs warm compile cache), SQLite store open + `buildSnapshot` read, and stdout formatting.
   - Prototype-measure (without modifying committed `src/` or `plugins/` — use a scratch bundle in `$TMPDIR`) the size and parse/eval time of a minimal `status`-only esbuild bundle vs the full `dist/cli/squeal.mjs` bundle under warm `NODE_COMPILE_CACHE`.
   - Recommend clearly: does a separate `cli/status.mjs` bundle save enough ms to justify maintaining a second CLI entry point, or does `NODE_COMPILE_CACHE` + `025-11` make it unnecessary?

**File ownership (exclusive):**
- `docs/specifications/025-performance/research/runner-host-and-status-bundle.md`
- Optional reproducible probe scripts under `docs/specifications/025-performance/research/probes/`
- Do NOT edit any `src/`, `test/`, `bench/`, `plugins/`, or `docs/board.md` files. Clean up any temporary processes or `$TMPDIR` fixtures before finishing.

**Done when:**
- Report commits all raw measurements, methodology, environment details (Node version, CPU, load), and explicit go/no-go recommendations for both questions.
- `pnpm run check:private` passes (no home paths or private material in the report!).

---

## Row `025-13`: Review `0.1.626.md` S1 & S2, secondary-worktree code-store settle, and Codex `cache-fixture.ts` teardown hardening

**Model:** `claude` `opus` `medium` (`--skill worker`).

**Goal:** Close four concrete defects surfaced by Wave 2 review (`0.1.626.md` S1, S2), the Wave 2 paired `@hooks` benchmark, and Node 22 CI:
1. **Review S1 — `hooks/run` accepts `node | */node` (`plugins/claude-code/hooks/run`, `plugins/antigravity/hooks/run`):**
   - Replace `if [ "$1" = node ]; then` with `case $1 in node | */node)` (keeping POSIX `sh` compatibility!).
   - When rewriting `set --` for `NODE_USE_ENV_PROXY` carry, preserve the caller's exact Node executable (`node_cmd=$1; shift; set -- "$node_cmd" --import ... "$@"`) instead of hardcoding `node`.
   - Never touch `plugins/codex/hooks/hooks.json` or `plugins/*/dist/*`.
   - Add tests in `test/cli/startup-env.test.ts` verifying that both `plugins/claude-code/hooks/run` and `plugins/antigravity/hooks/run` enable `NODE_COMPILE_CACHE` and carry/restore `NODE_USE_ENV_PROXY` when invoked with an absolute `process.execPath` (`*/node`) as well as bare `node`.
2. **Review S1 — Benchmark shipped-path parity (`bench/session.mjs`, `bench/run-cell.mjs`):**
   - In `bench/session.mjs` and `bench/run-cell.mjs`, invoke the CLI through `join(plugin, "bin/squeal")` (the shipped POSIX wrapper that activates D7 `NODE_COMPILE_CACHE` + `NODE_USE_ENV_PROXY` carry) when `existsSync(join(plugin, "bin/squeal"))`, falling back to `[NODE, "--disable-warning=ExperimentalWarning", join(plugin, "dist/cli/squeal.mjs")]` only if `bin/squeal` is absent. Ensure `PATH` includes `dirname(NODE)` so `bin/squeal`'s `exec node` uses the benchmark's exact Node binary!
   - Keep `bench/session.mjs` hook invocation passing `NODE` through `hooks/run` (which now matches `*/node` on `0.1.629+` and stays compatible with older tags like `0.1.623`).
3. **Review S2 + secondary-worktree code-store settle (`bench/run-cell.mjs`, `bench/summarize.mjs`, `test/bench/summarize.test.ts`):**
   - **S2:** Copy and parse daemon logs (`logs/`, `hookWriteWait`, `longWrites`, etc.) AFTER `squeal stop` finishes in `bench/run-cell.mjs` so D9's final partial-minute shutdown `hook writes:` summary is captured in `cell.json` and `scorecard.md`.
   - **Secondary-worktree `idle` settle:** In the `0.1.623` vs `0.1.626` `@hooks` benchmark, `wt-3@0.1.626` settled `startOthers` in 233 ms (`testFileCounts.pending === 0`), yet `wt1` and `wt2` still burned `5.33%` and `5.38%` CPU (+ `2.48%` store-process CPU) during the 60 s `idle` window while background code-store seeding finished. Inspect `squeal status --json` fields (e.g. `code.pending` / `code` status / `lint` status / store-process activity) and extend `waitForBaselines` so it waits for code-store/lint baseline seeding to settle too (with a clean bounded timeout and backward compatibility for older Squeal JSON shapes), recording the code-store settle check in `settle` metadata.
   - Update unit tests in `test/bench/summarize.test.ts`.
4. **Codex `cache-fixture.ts` Node 22 teardown hardening (`test/harness/codex/cache-fixture.ts`, `test/harness/codex/version-copies-*.test.ts`):**
   - On Node 22 CI (`45478758302` and `45483729904`), `test/harness/codex/version-copies-start.test.ts:44` failed with `ENOTEMPTY: directory not empty, rmdir '/tmp/sq-vc-*/home'`. Cause: `afterEach` sends `process.kill(pid, "SIGKILL")` to the daemon PID without waiting for exit or stopping its `store-process`, which now inherits `NODE_COMPILE_CACHE=$HOME/.cache/squeal/compile-cache` from `025-07` and flushes compile-cache files into `$HOME` right as `m.cleanup()` calls `rmSync(dir, { recursive: true, force: true })`.
   - Harden teardown in `test/harness/codex/cache-fixture.ts` (and the four `version-copies-*.test.ts` callers if `cleanup` becomes async or accepts daemon PIDs): stop/kill the daemon AND any surviving `store-process` / child process referencing `m.dir`, wait for them to exit (bounded timeout), and use `rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })`. Keep cleanup fast and deterministic (do not add unconditional sleeps).

**File ownership (exclusive):**
- `plugins/claude-code/hooks/run`
- `plugins/antigravity/hooks/run`
- `bench/{session,run-cell,summarize}.mjs`
- `test/cli/startup-env.test.ts`
- `test/bench/summarize.test.ts`
- `test/harness/codex/{cache-fixture.ts,version-copies-start.test.ts,version-copies-hook.test.ts,version-copies-loop.test.ts,version-copies-tier.test.ts}`
- `docs/specifications/025-performance/tasks/025-13-notes.md`

**Done when:**
- `test/cli/startup-env.test.ts`, `test/keys/launchers.test.ts`, `test/bench/summarize.test.ts`, and `test/harness/codex/version-copies-start.test.ts` pass.
- `pnpm run typecheck`, `pnpm run lint`, and `pnpm run check:private` pass.
