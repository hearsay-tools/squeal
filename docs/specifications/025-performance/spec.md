# Performance improvements

## Problem

The boat.dev benchmark scorecards (through `0.1.593`, `bench/results/TREND.md`) and live profiling of `0.1.598` show five concrete bottlenecks that hurt agent responsiveness and host overhead without adding validation trust:

1. **Source-path `status --wait` stalls behind `CATCHUP_QUIET_MS` (120 s):** Editing a source file that affects 12 to 25 test files cuts all files past namesake plus `tierSize` (default 4) into catch-up behind a 120 s quiet timer (`src/core/scheduler/edit-cut.ts`, `src/core/scheduler/quiet.ts`). `squeal status --wait 60000 src/foo.ts` promotes only test files named by their own paths (`src/cli/wait/named.ts:ownNamedFiles`), so the extra affected files sit idle until the 60 s wait times out (`session.verdict.within60s` is 50% in `ref` and `store-7g`, 69% to 72% in `wt-3` and `size-l`, even while `sessionsBusyMean` is 0.069).
2. **Hook and `squeal status` latency exceeds the 80 ms hook budget:** On `ref`, `store-7g`, and `size-l`, `preToolUse` p95 is 118 to 221 ms, `postToolBatch` p95 is 178 to 775 ms, and `squeal status` p95 is 200 to 459 ms. Three causes compound:
   - `delivery.ts` loads every row of `known_states` (up to 14,000 rows on `size-l`) on every `onToolBoundary` and `peek`, even when the consumer holds a trusted `viewMark` (`src/core/delivery/view-mark.ts`) where passing unviewed states cannot produce a delta.
   - `tellUncovered` (`src/core/delivery/uncovered.ts`) enters `store.transaction()` unconditionally on every edit boundary, triggering a second write-lease acquisition and loading every listed test closure even when zero files are uncovered.
   - Silent hook writes release the lease in a separate socket round-trip, and `withStatusStore` (`src/core/status/open.ts`) opens `store.sqlite` read-write via `openStore` instead of read-only.
3. **Coverage wire payload bloat and per-file `CoverageWriter` commits:** `src/runners/vitest/coverage.ts` attaches every module in `environment.moduleGraph.idToModuleMap` (up to 4,000 modules on `size-l`) to every `CoveredFile`. `src/core/runner-host/coverage-wire.ts` repeats that full map per test file (up to 800,000 tuples per 200-file tier), inflating daemon RSS (524 to 910 MiB). `src/core/code/coverage/writer.ts` then commits one `code.sqlite` transaction and triggers `onStored()` per individual test file (6,872 store-process batches / 28.1 s busy on `size-l`).
4. **Idle daemon CPU above the 1% core budget and redundant observer `realpath` calls:** Idle daemon CPU reaches 1.5% to 8.2% of a core across `wt-3` and `wt-6` because `lifecycle.ts` polls `store.consumers.list` every 250 ms per daemon, `change-feed.ts` runs full `git status` and re-stats every tracked path every 30 s while idle, and `store-process/server.ts` opens and closes a fresh `DatabaseSync` every 10 s to read `PRAGMA user_version`. Inside test runs, `src/runners/observe/recorder.cjs` calls `fs.realpathSync.native` up to three times for the same path in `load()`.
5. **SQLite write lock holds past 250 ms (`store.longWrites`):** Every benchmark cell records 3 to 20 lock holds over 250 ms (up to 750 to 1,890 ms). Default `wal_autocheckpoint = 1000` runs checkpoints inside arbitrary write commits (even 2-row heartbeats took 296 ms); `openStore` sets no `cache_size` or `temp_store`; `results.byKey` runs an `UPDATE` on every cache lookup; and bulk writes in `record.ts`, `batch.ts`, and `tiers.ts` hold a single `BEGIN IMMEDIATE` across thousands of rows.

## Goals

- Raise `session.verdict.within60s` on source-path waits by promoting source-selected test files up to a bounded cap (`SOURCE_PROMOTE_CAP = 50`) and waking catch-up quiet timers on larger source selections, while keeping directory paths unpromoted (row 011-406).
- Cut `postToolBatch`, `preToolUse`, and `squeal status` latency on `ref`, `store-7g`, and `size-l` by reading only marked-relevant `known_states` rows, removing the unconditional write transaction in `tellUncovered`, combining single-batch write+release, and opening `squeal status` read-only.
- Cut coverage wire size, daemon RSS, and `store-process` batch count by filtering `executedSources` to scripts executed by the run, deduplicating source maps on the wire and in heap, and batching `CoverageWriter` writes.
- Cut idle daemon CPU to within the 1% budget by slowing idle presence polling, backing off idle `change-feed` full scans, avoiding repeated `DatabaseSync` opens in `store-process/server.ts`, and caching `realpathSync.native` in `recorder.cjs` with zero key-format change.
- Cut `store.longWrites` (> 250 ms) by tuning SQLite pragmas, moving WAL checkpointing off arbitrary write commits for managed daemon and store-process connections, throttling `results.last_used_at` updates, and slicing bulk scheduler transactions into bounded chunks.
- Preserve every vision and correctness invariant: trustworthy provenance, row 011-288 commit-after-output safety, schema compatibility (no `SCHEMA_VERSION` raise, no `RECORDER_VERSION` or `KEY_FORMAT_VERSION` bump), and folder-wait non-promotion (row 011-406).

## Non-goals

- Changing user-facing policy defaults such as `coverage.enabled` or `selection.strategy` without explicit human approval.
- Replacing SQLite or changing `SCHEMA_VERSION`, `KEY_FORMAT_VERSION`, or `RECORDER_VERSION`.
- Changing Vitest upstream internals or removing the runner host process boundary.

## Design

### D1: Source-path `status --wait` promotion and catch-up wake

In `src/cli/wait/named.ts`:
- Keep `ownNamedFiles` strictly for test files named by their own paths (used by `--check` focus and `askNamedRuns`, preserving row 011-146 and row 011-207).
- Add `promotedWaitFiles(root, cwd, paths, selection)` for the promotion request sent to the daemon:
  - Include every file from `ownNamedFiles`.
  - For each path in `selection.paths` with `kind === "source"`, collect its selected test files (deduplicated). Never include `kind === "directory"` paths (preserves row 011-406, `test/cli/status-wait-folder.test.ts`).
  - Define `SOURCE_PROMOTE_CAP = 50`.
  - If the combined list (own named files plus source-selected files) has length `<= SOURCE_PROMOTE_CAP`, send that combined list in `promote(root, files, withinMs)`.
  - If source-selected files would exceed `SOURCE_PROMOTE_CAP`, send `ownNamedFiles` with `wakeCatchUp: true` so the daemon does not jump hundreds of files ahead of other edits, yet clears `BacklogQuiet`'s catch-up hold immediately so those files start running instead of waiting 120 s.
- Add optional `wakeCatchUp?: true` to `PromoteRequest` (`src/core/types/daemon.ts`), parse it in `src/core/daemon/protocol.ts` (ignoring it on older daemons cleanly), and forward it through `desk-messages.ts`, `desk.ts`, `front-desk.ts`, `handlers.ts`, `daemon.ts`, `scheduler.ts`, and `request-intake-requests.ts`.
- In `src/core/scheduler/quiet.ts`, add `BacklogQuiet.endCatchUp(now: EpochMs): void`, which clears `#catchUp` and publishes if non-empty (leaving `#until` intact). When `promoteRequest` runs with `wakeCatchUp === true`, call `context.quiet?.endCatchUp(context.now())`.
- Update `promoteNamed` (`src/cli/status-wait-promote.ts`) to send the request when `testFiles.length > 0 || options?.wakeCatchUp === true`.

### D2: Hook delivery and `squeal status` read path

1. **Marked-consumer narrow state read (`src/core/store/view-seed.ts`, `src/core/delivery/view-mark.ts`, `src/core/delivery/delivery.ts`):**
   - Export `trustedMark(store, consumer)` from `src/core/delivery/view-mark.ts`.
   - Add `relevantStates(store, consumer, mark)` in `src/core/store/view-seed.ts`:
     - Queries `known_states` for `consumer.worktreeId` where `s.outcome != 'pass'`, OR a `consumer_views` row exists for `(worktree_id, session_id, agent_id, check_id)`, OR a `state_born` row exists for `(worktree_id, check_id)` with `b.id > mark`.
     - Because any excluded row has `outcome = 'pass'`, no `consumer_views` entry, and `born <= mark`, `markedView` would synthesize `{ outcome: 'pass', fingerprint: null }` and `planDelta` would emit zero entries, zero writes, and zero removals.
   - In `delivery.ts`:
     - When `trustedMark` is non-null (and `idle` is false), use `relevantStates` for `plan(...)` and `currentFailures(...)` instead of `store.knownStates.list(worktreeId)`.
     - Load full `store.knownStates.list(worktreeId)` lazily (via `once(...)`) ONLY when a full worktree state list is actually required (for example, `live()` when building a full header or `annotate()` when `delivered === true`).
     - In `ownNotes` / `editNotes` (`src/core/delivery/own-count.ts`), read states only for the consumer's rekeyed test files (`store.knownStates.list(worktreeId, rekeyedRefs)`) when narrow states are in use, rather than forcing a full 14,000-row scan on silent boundaries.
2. **Read-only pre-check and early-exit closure scan in `tellUncovered` (`src/core/delivery/uncovered.ts`, `src/harness/shared/deliver.ts`):**
   - Perform the changed-files lookup, already-told filter, `exists` check, and closure check outside `store.transaction()` first.
   - Check coverage by scanning listed test files and exiting early as soon as every candidate code file has been seen in a closure (or is itself a test file), rather than building a full `Set` of every file in all 4,000 closures. Keep the exact trust rule: if any listed test file checked before covering all candidates lacks a trusted closure, return `[]` (and if any candidate remains uncovered at the end, every listed test file has already been verified to have a trusted closure).
   - Enter `store.transaction()` ONLY when `fresh.length > 0`, re-checking inside the transaction before writing `recordUncoveredTold`.
   - In `src/harness/shared/deliver.ts`, avoid wrapping a read-only `uncoveredEditLine` return in an unnecessary lease when nothing writes (`tellUncovered` handles its own `store.transaction()` only on write, inside `context.write`).
3. **Single-batch write + release (`src/core/delivery/sending-connection.ts`, `src/core/delivery/daemon-writer.ts`):**
   - When a `SendingConnection` transaction commits a batch outside a hold (`this.#held === null`) during a single-unit call (such as silent `onToolBoundary` or `peek`), support releasing the lease on the `write` request itself (`release: true`) so silent hooks do not spend an extra Unix socket round-trip on `release` after `write`. Keep `settle()` releasing the lease whenever it is still held (including after empty transactions or errors).
4. **Read-only `squeal status` store open (`src/core/status/open.ts`):**
   - Open the database in `readOnce` strictly read-only (`new DatabaseSync(paths.database, { readOnly: true })`) for every schema version (current, older, and newer), checking `existsSync`, setting `PRAGMA busy_timeout`, checking `userVersion(db)`, and wrapping current-schema stores with `createStore(new Connection(db), found, paths)`.
   - Never run write pragmas, migrations, or WAL checkpoints on close; report older schemas as `store-unreadable` so a writer migrates them, and preserve `SQLITE_BUSY` retry loops cleanly.

### D3: Coverage wire deduplication and `CoverageWriter` batching

1. **Filter `executedSources` (`src/core/code/coverage/provider.mjs`, `src/runners/vitest/coverage.ts`):**
   - Record the kept script paths in `provider.mjs` (`batch.scripts`) while taking coverage and pass them to `coveredFiles`, so `executedSources` includes only modules executed in that environment's run without re-reading payload files from disk or copying all entries of `environment.moduleGraph.idToModuleMap`.
2. **Deduplicate source maps on the runner-host wire (`src/core/runner-host/coverage-wire.ts`):**
   - Encode unique source-map objects once in a run-level table (deduplicating identical `Map` references across files in the same run) and reference the table index per file.
   - On decode, construct one `ReadonlyMap` per unique table entry and share it across files that reference it.
   - Keep decoding backward-compatible with legacy per-file `sources` arrays if received.
3. **Batch `CoverageWriter` writes (`src/core/code/coverage/writer.ts`, `src/core/code/store/coverage.ts`, `src/core/code/store/types.ts`):**
   - Coalesce queued coverage payloads into batches (up to `MAX_BATCH_FILES = 25` files or `BATCH_WINDOW_MS = 200` ms, bounded by `Pace` so main-thread slices remain short).
   - Write each batch via `putPartsBatch` in two transactions separated by a `sent()` barrier (all parts of the batch in transaction 1, wait for `sent()`, then all manifests in transaction 2, wait for `sent()`), preserving the store-process invariant that manifests never precede their parts while coalescing N files into 2 transactions instead of 2N.
   - Call `options.onStored?.()` once per committed batch rather than once per test file.
   - Flush all buffered records immediately on `close()`, and report `busy()` as true while any record is buffered or writing.

### D4: Idle daemon CPU and observer `realpath` deduplication

1. **Idle presence poll interval (`src/core/daemon/lifecycle.ts`):**
   - Raise default `presenceMs` from `250` to `1_000` (tests passing `timings.presenceMs` continue to use their explicit value; departure grace remains 3 s).
2. **Idle `change-feed` poll backoff (`src/core/watcher/change-feed.ts`):**
   - Keep the 30 s idle timer enqueued on the change feed's queue so a genuinely hung queue still stops `onDelivered` and triggers `FEED_LATE_MS` (60 s).
   - When the native watcher is running and healthy and no explicit `timings.reconcileIntervalMs` override was passed, back off the full `git status` plus tracked-path scan exponentially from 30 s up to `MAX_IDLE_POLL_MS = 300_000` (5 min) on unchanged idle passes; on intermediate 30 s ticks, read `HEAD` and call `onDelivered` if unchanged.
   - Reset the full-pass interval back to 30 s immediately on any watcher event, dropped-event recovery, `HEAD` move, or explicit `reconcile()`.
3. **Reuse schema reads in `store-process/server.ts` (`src/core/store-process/server.ts`):**
   - Cache the last `PRAGMA user_version` keyed by `stat` identity (`dev`, `ino`, `mtimeMs`, `size`) of both the database file and its `-wal` file, reopening `DatabaseSync` only when either changes.
4. **Per-load `realpath` deduplication in `src/runners/observe/recorder.cjs`:**
   - Resolve a path's symlink target at most once per multi-kind `load()` call (`f`, `m`, `d`), without retaining symlink targets across separate observations, filesystem mutations, or test files.
   - Recorded outputs are byte-for-byte identical across symlink retargeting; `RECORDER_VERSION` stays at 7 and `test/keys/key-format.test.ts` passes unchanged.

### D5: SQLite write lock holds <= 250 ms and connection tuning

1. **Connection pragmas and fast non-creating open (`src/core/store/open.ts`, `src/core/daemon/open.ts`, `src/core/store-process/writer.ts`):**
   - Set `PRAGMA cache_size = -16384` (16 MiB) and `PRAGMA temp_store = MEMORY` on opened store connections (both main store and store-process writer).
   - In `openStore`, when `options.create === false` and `found === SCHEMA_VERSION`, skip `PRAGMA page_count`, skip `switchToWal` if `PRAGMA journal_mode` is already `"wal"`, and skip `migrate(db)`.
   - Add an option `managedCheckpoint?: boolean` on `OpenStoreOptions`: when `true` (passed by `openDaemon` and `store-process/writer.ts`), set `PRAGMA wal_autocheckpoint = 0` so arbitrary short write commits (such as heartbeats) never stall running a 1,000-page auto-checkpoint under the write lock.
   - Run passive WAL checkpoints (`checkpointWalPassive` in `src/core/daemon/idle-checkpoint.ts`, triggered by an unref'd timer in `openDaemon` and periodically in `store-process/writer.ts` when WAL size exceeds 8 MiB, outside any write transaction) alongside the existing `IdleCheckpoint` `TRUNCATE` on quiet, so WAL growth stays bounded under sustained write traffic.
2. **Throttle `results.last_used_at` updates (`src/core/store/repos/results.ts`):**
   - Define `RESULT_TOUCH_INTERVAL_MS = 3_600_000` (1 hour).
   - In `results.byKey(key, usedAt)`, update `last_used_at` only when `last_used_at < usedAt - RESULT_TOUCH_INTERVAL_MS` (keeping `usedAt === 0` strictly read-only, and preserving retention/prune behavior where retention is measured in days).
3. **Slice unchanged-file stat-cache updates in `reconcileBatch` (`src/core/scheduler/batch.ts`):**
   - When `reconcileBatch` has more than `WRITE_SLICE_FILES = 200` unchanged-file stat-cache updates (paths absent from `diff.changes`), flush them ahead of the revision transaction in 200-path transactions with a `setImmediate` yield between slices. A crash between slices only refreshes stat metadata for unchanged files, preserving exact revision atomicity.
   - Deferred to Wave 3 (row `025-10`) pending hook write-wait metrics (`025-09`): slicing changed-file reconciliation, `startTier`, `#write`/`recordTier` (which require async caller and busy-retry ownership across `ledger.ts`, `record-tier.ts`, `tier-start.ts`, and `slow-tier.ts`), and zero-row prune slices (`sliced-prune.ts`, `prune.ts`).

### D6: SQLite hot-read optimizations (Wave 2, row `025-06`)

Follow-up measurements on Squeal's own repository (2026-11-24, task `05abfc9a` and coordinator review `0266d2c5`) identified four low-risk read-path and lock-hygiene wins:

1. **Aggregate complexity counts in `codeStatusOf` (`src/core/code/store/schema.ts`, `src/core/code/store/states.ts`, `src/core/code/store/types.ts`, `src/core/status/code-status.ts`):**
   - Add an additive partial index `states_non_pass` to `CODE_INDEXES` (`CREATE INDEX states_non_pass ON states (worktree_id, measure, outcome) WHERE outcome != 'pass'`), with no `CODE_SCHEMA_VERSION` raise.
   - Add `countNonPass(worktreeId, measure)` on `CodeStateRepo` returning `{ fail, pending, unknown }` counts using `INDEXED BY states_non_pass` when the index exists in `sqlite_master` and falling back to `SELECT outcome, count(*) FROM states WHERE worktree_id = ? AND measure = ? AND outcome != 'pass' GROUP BY outcome` when absent (read-only/older stores).
   - Replace `code.states.list(worktreeId, { measure: "complexity" })` in `codeStatusOf` with `code.states.countNonPass(worktreeId, "complexity")` so `squeal status` never materializes tens of thousands of passing function rows.
2. **Indexed `UNION` rewrite for `relevantStates` (`src/core/store/schema.ts`, `src/core/store/view-seed.ts`):**
   - Add an additive partial index `known_states_non_pass` to `STORE_INDEXES` (`CREATE INDEX known_states_non_pass ON known_states (worktree_id, check_id) WHERE outcome != 'pass'`), with no `SCHEMA_VERSION` raise.
   - Rewrite `relevantStates(store, consumer, mark)` as a `UNION` of three indexed lookups (`known_states` with `worktree_id = ? AND outcome != 'pass'` using `INDEXED BY known_states_non_pass` when present, `consumer_views` for `(worktree_id, session_id, agent_id)`, and `state_born` for `(worktree_id, id > ?)`), `CROSS JOIN known_states` and `JOIN checks`, preserving exact row equivalence and `ORDER BY c.project, c.test_path, c.kind, c.full_name`.
3. **Read-first consumer guard in `resumeTurn` (`src/core/delivery/turn.ts`):**
   - Check `store.consumers.get(consumer) === null` before entering `store.transaction()` in `resumeTurn`, so unregistered sessions on `PreToolUse` never acquire and immediately release a no-op write lease.
4. **Linear `checksByFile` grouping (`src/core/status/unknown-files.ts`):**
   - Replace the quadratic array-spread copy (`checks.set(id, [...(checks.get(id) ?? []), state])`) in `checksByFile` with in-place `.push(state)`.

### D7: Hook and CLI startup (`NODE_USE_ENV_PROXY` carry/restore and `NODE_COMPILE_CACHE`, Wave 2, row `025-07`)

1. **`NODE_USE_ENV_PROXY` carry-and-restore across shell hook runners and CLI launchers:**
   - Reuse the proven OpenCode pattern (`src/harness/opencode/bridge-client.ts`, row 008-21) in `plugins/claude-code/hooks/run`, `plugins/antigravity/hooks/run`, `plugins/claude-code/bin/squeal`, `plugins/opencode/bin/squeal`, and `plugins/claude-code/bin/squeal-launcher` (copied to all plugins; bump `# squeal-launcher format` to `10`).
   - Hooks (`hooks/run`) always carry `NODE_USE_ENV_PROXY` when running `node`. CLI launchers (`bin/squeal`, `squeal-launcher`) carry `NODE_USE_ENV_PROXY` only on an explicit fail-safe allowlist of non-network fast commands (`status|why|failures|checks|ps|start|stop|run|retry|hold|lint|code|impact|reach|--version|-v|--help|-h|help`), so network commands (`update`, `codex-runtime`, `remote`, `remote-tunnel`) and long-lived processes (`daemon`, `runner-host`) retain Node's boot-time proxy setup (`fetch()` requires boot-time proxy initialization on Node 26).
   - When carried, unset `NODE_USE_ENV_PROXY` for the hook/CLI Node boot, stash it in `SQUEAL_CARRIED_NODE_USE_ENV_PROXY`, and pass a space-free guarded `--import data:text/javascript,...` preload that restores `process.env.NODE_USE_ENV_PROXY` only when `process.env.SQUEAL_CARRIED_NODE_USE_ENV_PROXY !== undefined` and deletes `SQUEAL_CARRIED_NODE_USE_ENV_PROXY` before module code runs. In `squeal-launcher`, strip the `--import <preload>` pair from `process.execArgv` alongside `-e <script>` before `import(cli)`.
2. **`NODE_COMPILE_CACHE` in launchers and Codex fixed adapter, stripped before user tests:**
   - In the shell hook runners and CLI launchers, when `NODE_COMPILE_CACHE` is unset (`${NODE_COMPILE_CACHE+set}` empty) and an absolute cache base (`XDG_CACHE_HOME` or `HOME/.cache`) is writable, export `NODE_COMPILE_CACHE="<base>/squeal/compile-cache"` (created with `0700` permissions best-effort) and mark `SQUEAL_OWN_COMPILE_CACHE=1`.
   - Do NOT edit `plugins/codex/hooks/hooks.json` commands (changing them forces every Codex user to re-trust every hook). Instead, call `module.enableCompileCache(dir)` inside `src/harness/codex/adapter/index.ts` before `await load(runtime.root)` and export `NODE_COMPILE_CACHE` + `SQUEAL_OWN_COMPILE_CACHE=1` on `env` for spawned daemons.
   - When spawning user test processes (Vitest workers via `src/runners/vitest/adapter.ts`, `node:test` child processes via `src/runners/node-test/run/run.ts`, and `pytest` child processes via `src/runners/pytest/environment/hash.ts`), strip `NODE_COMPILE_CACHE` and `SQUEAL_OWN_COMPILE_CACHE` whenever `SQUEAL_OWN_COMPILE_CACHE === "1"` (`src/core/env/compile-cache.ts`) so user test runs never write into Squeal's cache or observe an unexpected env var (while preserving any user- or project-provided `NODE_COMPILE_CACHE`).
   - `test/keys/launchers.test.ts` permits only the guarded restore preload and those three exported variables; `test/keys/validity/` covers the own-cache strip branches across all three runners (`ownCompileCache: true`), keeping `KEY_FORMAT_VERSION` unchanged.

### D8: Benchmark accuracy and visibility (Wave 2, row `025-08`)

1. **Fix `wt-3` / `wt-6` idle window measurement (`bench/run-cell.mjs`):**
   - After `startOthers` starts secondary worktrees, wait until every worktree daemon has finished its startup listing/keying/counting baseline before starting the 60 s `idle` CPU measurement window (previously `wt1` and `wt2` executed their initial baseline and 42 code-store batches each during the "idle" minute, inflating `wt-3` idle CPU to 3.5% while `wt0` sat at 0.20%).
2. **Whole-tree memory, hook tails, hook write-wait, and large-repo cell (`bench/summarize.mjs`, `bench/run-cell.mjs`, `bench/run-all.mjs`, `bench/gen-project.mjs`, `bench/lib.mjs`, `bench/README.md`):**
   - Report and score `res.treeRss.max` (from `cell.daemonRss.maxTreeBytes`, already sampled) alongside `res.daemonRss.max`.
   - Report `hook.preToolUse.p99`, `hook.preToolUse.max`, `hook.postToolBatch.p99`, and `hook.postToolBatch.max`.
   - Parse and report daemon front-desk hook write-wait metrics (`hook.writeWait.p95`, `hook.writeWait.max`, `hook.longWriteWaits`) from daemon logs (produced by D9 / row `025-09`), handling older versions cleanly as `n/a`.
   - Add an optional large-check/function-count benchmark cell (e.g. `size-xl` or `scale-real`, ~20,000 checks / ~60,000 functions) selectable in `bench/run-all.mjs` so real-repository `status` read scaling is measurable on boat.dev.

### D9: Daemon front-desk hook write-wait instrumentation (Wave 2, row `025-09`)

1. **Stamp and measure front-desk write queue wait (`src/core/daemon/desk-messages.ts`, `src/core/daemon/front-desk.ts`, `src/core/daemon/desk.ts`, `src/core/daemon/daemon.ts`):**
   - Attach `queuedAt: EpochMs` when the front-desk worker posts `{ type: "write", id, batch, queuedAt }` to the main thread.
   - On the main thread (`desk.ts`), measure `waitMs = now() - message.queuedAt` when taking each `"write"` message.
   - Log `"long write wait: hook write waited <N> ms for the daemon main thread"` whenever `waitMs > 250` (matching the 250 ms threshold of `store.longWrites`), and emit a concise periodic/shutdown summary line (`hook writes: <n> taken, queue wait p95 <p95> ms max <max> ms`) when at least one hook write was taken since the last report.

### Planned Wave 3 items (rows `025-10` to `025-12`)

- **D10 (`025-10`):** Finish deferred write slicing (`startTier`, `#write`/`recordTier`, changed-file reconciliation, zero-row prune slices) guided by D9 hook write-wait data.
- **D11 (`025-11`):** Replace full `knownStates.list(worktreeId)` in `src/core/status/snapshot.ts` (and its consumers `header-part.ts`, `imports.ts`, `outstanding.ts`, `named.ts`) with targeted SQL aggregations plus file-scoped reads for named waits.
- **D12 (`025-12`):** Research/measurement row: measure Vitest `runner-host` cold-restart + first-edit latency and take one idle runner-host heap snapshot on Squeal's repo before deciding an idle runner-host exit policy; also measure `cli/status.mjs` (including `status --wait <path>`) on top of `NODE_COMPILE_CACHE` to decide whether a second CLI bundle pays for itself.

## Testing

- Unit and integration tests per row (D1 through D5), verified with `squeal status --wait 60000 <paths>` and targeted `pnpm exec vitest run` runs, plus `pnpm run typecheck`, `pnpm run lint`, `pnpm run check:private`, `test/keys/key-format.test.ts`, and `test/version-sensitive.test.ts`.
- Candidate CI full suite on `cand/0.1.600` (Node 22, 24, 26).
- Paired boat.dev benchmark comparison (`docs/process.md` step 6c) comparing released base (`0.1.597`) against candidate (`0.1.600`) across `@quick`, `@hooks`, `@scheduler`, and `@contention` (and `size-l` / `wt-3`), confirming measurable gains on `session.verdict.within60s`, `postToolBatch` / `preToolUse` / `status` p95, daemon RSS, `store.longWrites`, and idle CPU, with no regressions.
- Fresh-eyes Codex `/reviewer` pass on the exact candidate SHA before landing on `main`.

## Open questions

- Policy default for `coverage.enabled` (off vs on for large repositories) remains out of scope for this spec and is left to the human.

## References

- `docs/vision.md`: Push transitions, pull state, trustworthy provenance.
- `bench/README.md` and `bench/results/TREND.md`: benchmark cells, healthy limits, and historical runs through `0.1.593`.
- Spec `011-core` (rows 011-288 hand-off safety, 011-406 folder waits, C15 named-wait promotion).
- Spec `015-coverage-complexity` (D8 coverage writer).
- Spec `021-remote-store-and-execution` (D3/D4 WAL limits and long writes, D15 sent writes, D22 store process).
