# Wave 1: Spec 024 Performance improvements

Baseline: commit containing `docs/specifications/024-performance/spec.md` and this file.
Target candidate: `0.1.600` (coordinator owns version bump, bundles, and `docs/board.md`).

## Rules for every worker in Wave 1

1. Read `docs/specifications/024-performance/spec.md` first, plus `docs/styleguide.md`.
2. Edit ONLY the files listed under your row's **Owned files** (plus new or updated test files for your row and your row notes file). If you believe an unowned file must change, stop and ask the coordinator.
3. Do NOT run `pnpm run build` or modify `plugins/*/dist/`. The coordinator builds bundles once on integration.
4. Do NOT bump `package.json` version, do NOT edit `docs/board.md`, and do NOT run the full Vitest suite.
5. Verify your changes with:
   - `squeal status --wait 60000 <changed-paths>` (or if Squeal is unavailable or doubtful, targeted `timeout 600 pnpm exec vitest run --maxWorkers=2 <relevant-test-files>` and state why),
   - `pnpm run typecheck`,
   - `pnpm run lint`,
   - `pnpm run check:private`.
6. Stop any daemon your checks started (`squeal stop` if applicable). Never commit absolute home paths or private names.
7. Commit all changes cleanly on your branch and write concise verification notes in `docs/specifications/024-performance/tasks/<row>-notes.md`.

---

## Row 024-01: D1 - Source-path `status --wait` promotion and catch-up wake

**Goal:** Eliminate the 60 s timeout deadlock when waiting on a source path (`squeal status --wait 60000 src/foo.ts`) whose affected tests exceed `tierSize` and fall into `CATCHUP_QUIET_MS` (120 s), while keeping directory paths unpromoted (row 011-406).

**Owned files:**
- `src/cli/wait/named.ts`
- `src/cli/status-wait-promote.ts`
- `src/core/types/daemon.ts`
- `src/core/daemon/protocol.ts`
- `src/core/daemon/desk-messages.ts`
- `src/core/daemon/desk.ts`
- `src/core/daemon/front-desk.ts`
- `src/core/daemon/handlers.ts`
- `src/core/daemon/daemon.ts`
- `src/core/scheduler/quiet.ts`
- `src/core/scheduler/request-intake-requests.ts`
- `src/core/scheduler/scheduler.ts`
- Tests: `test/cli/status-wait-source-promote.test.ts` (new), `test/scheduler/quiet-wake.test.ts` (new), and updates to directly related tests if needed.
- Notes: `docs/specifications/024-performance/tasks/024-01-notes.md`.

**Requirements:**
1. Keep `ownNamedFiles` strictly returning test files named by their own paths (for `--check` focus and `askNamedRuns`).
2. Add `SOURCE_PROMOTE_CAP = 50` and `promotedWaitFiles(root, cwd, paths, selection)` in `src/cli/wait/named.ts`:
   - Collect own named test files plus test files selected by `selection.paths` entries whose `kind === "source"` (never `kind === "directory"`).
   - Deduplicate by `testFileId`.
   - If the combined promoted list has `<= SOURCE_PROMOTE_CAP` files, return `{ files: combined, wakeCatchUp: false }`.
   - If source-selected files push the count past `SOURCE_PROMOTE_CAP`, return `{ files: own, wakeCatchUp: true }`.
3. Update `PromoteRequest` (`src/core/types/daemon.ts`) with optional `readonly wakeCatchUp?: true;`.
4. Parse optional `wakeCatchUp` in `src/core/daemon/protocol.ts` (reject non-boolean when present; omit unless `true`). Forward `wakeCatchUp` through `desk-messages.ts`, `desk.ts`, `front-desk.ts`, `handlers.ts`, `daemon.ts`, `scheduler.ts`, `request-intake-requests.ts`.
5. Update `promoteNamed` (`src/cli/status-wait-promote.ts`) and `NamedWaitOptions.promote` (`PromoteNamed` in `src/cli/status-wait-promote.ts`, adding an optional 4th parameter `options?: { readonly wakeCatchUp?: boolean }`). Send the request when `testFiles.length > 0 || options?.wakeCatchUp === true`.
6. Add `endCatchUp(now: EpochMs): void` to `BacklogQuiet` in `src/core/scheduler/quiet.ts` that clears `#catchUp` and publishes if non-empty, leaving `#until` untouched. Call `context.quiet?.endCatchUp(context.now())` inside `promoteRequest` when `wakeCatchUp === true`.
7. Write focused tests proving:
   - A source path selecting 15 files promotes all 15 files (including files that were in catch-up behind `CATCHUP_QUIET_MS`) so they run immediately.
   - A source path selecting > 50 files does not promote all > 50 files, sends `wakeCatchUp: true`, and clears `BacklogQuiet`'s catch-up hold without clearing `#until`.
   - A directory path still promotes nothing (`test/cli/status-wait-folder.test.ts` stays green).
   - `--check` on a source path still rejects focus usage as before.
8. Verify with targeted tests: `test/cli/status-wait-folder.test.ts`, `test/cli/status-wait-paths.test.ts`, `test/cli/status-wait-source-promote.test.ts`, `test/scheduler/quiet-wake.test.ts`, `test/scheduler/backlog-quiet-exempt.test.ts`, `test/daemon/protocol.test.ts` (if present).

---

## Row 024-02: D2 - Hook delivery and `squeal status` read path

**Goal:** Eliminate the 14,000-row `known_states` scan on silent hooks, eliminate the unnecessary write transaction and full closure scan in `tellUncovered`, combine single-batch write+release on silent hook writes, and open `squeal status` read-only.

**Owned files:**
- `src/core/store/view-seed.ts`
- `src/core/delivery/view-mark.ts`
- `src/core/delivery/delivery.ts`
- `src/core/delivery/own-count.ts`
- `src/core/delivery/uncovered.ts`
- `src/core/delivery/sending-connection.ts`
- `src/core/delivery/daemon-writer.ts`
- `src/core/status/open.ts`
- `src/harness/shared/deliver.ts`
- Tests: `test/delivery/narrow-delivery.test.ts` (new), `test/status/open-readonly.test.ts` (new), and updates to directly related tests if needed.
- Notes: `docs/specifications/024-performance/tasks/024-02-notes.md`.

**Requirements:**
1. In `src/core/store/view-seed.ts` and `src/core/delivery/view-mark.ts`:
   - Export `trustedMark(store, consumer)` from `view-mark.ts`.
   - Add `relevantStates(store, consumer, mark)` in `view-seed.ts`: query `known_states s JOIN checks c ON c.id = s.check_id` for `s.worktree_id = ?` where `s.outcome != 'pass'` OR `EXISTS (SELECT 1 FROM consumer_views v WHERE v.worktree_id = s.worktree_id AND v.session_id = ? AND v.agent_id = ? AND v.check_id = s.check_id)` OR `EXISTS (SELECT 1 FROM state_born b WHERE b.worktree_id = s.worktree_id AND b.check_id = s.check_id AND b.id > ?)`.
   - Verify with a proof-by-test that `planDelta` on `relevantStates` + `markedView` produces the exact same `entries`, `writes`, and `removals` as `knownStates.list` on mixed pass/fail/unknown/retired/re-born states.
2. In `src/core/delivery/delivery.ts` and `src/core/delivery/own-count.ts`:
   - When `trustedMark(store, consumer)` is non-null (and `!idle`), use `relevantStates` for `plan(...)` and `currentFailures(...)`.
   - Keep a lazy `allStates = once(() => store.knownStates.list(consumer.worktreeId))` for `live()` and `annotate()` so the full 14,000-row scan only happens when actually delivering news or building a live header.
   - Update `ownNotes` / `readOwn` (`own-count.ts`) so that when narrow states are passed, `readOwn` queries only the states of the rekeyed test files (`store.knownStates.list(worktreeId, rekeyedRefs)`) instead of requiring all 14,000 rows in memory.
   - Keep `store.consumers.touch(consumer, at, delivered)` updating `lastSeenAt` intact (`test/delivery/delivery.test.ts:308`, `test/harness/user-prompt-submit.test.ts:36`).
3. In `src/core/delivery/uncovered.ts` and `src/harness/shared/deliver.ts`:
   - Perform the changed-code-file check and closure coverage check read-only BEFORE entering `store.transaction()`.
   - When checking closures, exit early as soon as every candidate changed code file is covered (either is a listed test file or appears in a trusted closure). Preserve the exact trust invariant: if any listed test file checked before covering all candidates lacks a trusted closure, return `[]`.
   - Enter `store.transaction()` ONLY when `fresh.length > 0`, re-checking and writing `recordUncoveredTold` inside the transaction.
   - Ensure a covered edit in `deliver()` (`src/harness/shared/deliver.ts`) does NOT acquire a second write lease when `tellUncovered` finds nothing to write.
4. In `src/core/delivery/sending-connection.ts` (and `daemon-writer.ts` if helpful):
   - When a `SendingConnection` `unit()` completes with a single non-held transaction batch (e.g. silent `onToolBoundary` / `peek` touching `consumers.last_seen_at`), combine `release: true` on the `write` request or avoid an extra sequential `release` socket round-trip where safe, while strictly preserving row 011-288 (`test/harness/hand-off.test.ts`) hold/commit/rollback semantics and multi-transaction `unit()` safety.
   - Note: check carefully how `SendingConnection.unit()` works if `work()` runs more than one transaction inside `unit()`. Only pass `release: true` when you know no further write follows in the same `unit()` (for example, an explicit single-write hint on `deliver`'s `unit()` when not held). Design this cleanly with zero semantic regressions.
5. In `src/core/status/open.ts`:
   - Open the database in `readOnce` with `new DatabaseSync(paths.database, { readOnly: true })` (checking `existsSync`, `PRAGMA busy_timeout`, `userVersion > SCHEMA_VERSION`, `isCorruption`, `isBusy`, and wrapping with `createStore(new Connection(db), found, paths)`).
   - Ensure `withStatusStore` never writes or triggers a WAL checkpoint on close, and passes every existing `test/status/*.test.ts` test.
6. Verify with targeted tests: `test/delivery/narrow-delivery.test.ts`, `test/delivery/delivery.test.ts`, `test/delivery/uncovered.test.ts`, `test/delivery/sending-connection.test.ts`, `test/harness/hand-off.test.ts`, `test/harness/user-prompt-submit.test.ts`, `test/status/open-readonly.test.ts`, and existing `test/status/*.test.ts`.

---

## Row 024-03: D3 - Coverage wire deduplication and `CoverageWriter` batching

**Goal:** Eliminate the `O(tier_files x total_modules)` wire payload and daemon heap bloat in Vitest coverage collection, and coalesce per-file `CoverageWriter` commits into bounded batches.

**Owned files:**
- `src/runners/vitest/coverage.ts`
- `src/core/runner-host/coverage-wire.ts`
- `src/core/code/coverage/writer.ts`
- `src/core/code/store/coverage.ts`
- Tests: `test/runner-host/coverage-wire-dedup.test.ts` (new), `test/code/coverage/writer-batch.test.ts` (new), and updates to directly related tests if needed.
- Notes: `docs/specifications/024-performance/tasks/024-03-notes.md`.

**Requirements:**
1. In `src/runners/vitest/coverage.ts`:
   - Filter `executedSources` for each `CoveredFile` to only modules whose resolved path matches scripts actually present in that file's V8 coverage `result` (handle `file://` URLs cleanly with `fileURLToPath`, matching how `coverage.ts` already maps paths), instead of copying all entries of `environment.moduleGraph.idToModuleMap`.
   - Verify no executed source needed for source-map / function-coverage mapping is dropped.
2. In `src/core/runner-host/coverage-wire.ts`:
   - Deduplicate `sources` maps across files in an encoded `CoverageRun`: emit a run-level table of unique source tables (deduplicating by object identity and/or content) and store only an index per file (or compact representation) on the wire.
   - On decode, construct one `ReadonlyMap` per unique table entry and share the same `ReadonlyMap` reference across files referencing it.
   - Keep `decodeCoverageRun` backward-compatible with legacy per-file `sources` arrays.
3. In `src/core/code/coverage/writer.ts` (and `src/core/code/store/coverage.ts` if a batch helper helps):
   - Coalesce queued coverage writes into batches of up to `MAX_BATCH_FILES = 25` files (or flush after `BATCH_WINDOW_MS = 200` ms when fewer files arrive).
   - Write all prepared records of a batch in one `code.sqlite` transaction and invoke `options.onStored?.()` once per committed batch instead of once per file.
   - Respect `Pace` so main-thread work stays bounded (preserving `test/code/coverage/writer-turns.test.ts`).
   - Preserve `busy()` (true whenever records are queued, buffered, or being written) and `close()` (flushes all buffered records cleanly before resolving).
4. Verify with targeted tests: `test/runner-host/coverage-wire-dedup.test.ts`, `test/runner-host/protocol.test.ts`, `test/code/coverage/writer-batch.test.ts`, `test/code/coverage/writer-turns.test.ts`, and `test/code/coverage/*.test.ts`.

---

## Row 024-04: D4 - Idle daemon CPU and observer `realpath` cache

**Goal:** Reduce idle daemon CPU below the 1% core budget and eliminate redundant `realpathSync.native` syscalls in the runtime observer without changing any key or recorder output.

**Owned files:**
- `src/core/daemon/lifecycle.ts`
- `src/core/watcher/change-feed.ts`
- `src/core/store-process/server.ts`
- `src/runners/observe/recorder.cjs`
- Tests: `test/watcher/change-feed-backoff.test.ts` (new), `test/runners/observe/realpath-cache.test.ts` (new), and updates to directly related tests if needed.
- Notes: `docs/specifications/024-performance/tasks/024-04-notes.md`.

**Requirements:**
1. In `src/core/daemon/lifecycle.ts`:
   - Raise default `presenceMs` from `250` to `1_000` (keep `timings.presenceMs` override intact for tests).
   - Verify all departure-grace and lifecycle tests still pass reliably.
2. In `src/core/watcher/change-feed.ts`:
   - When the native watcher is active and healthy and a periodic poll finds no changes, exponentially back off the next periodic poll interval (`current = Math.min(MAX_IDLE_POLL_MS, current * 2)`, where `MAX_IDLE_POLL_MS = 300_000`, starting from `pollMs = 30_000`).
   - Reset the poll interval back to `pollMs` immediately on any watcher event, dropped-event recovery, or explicit `pass()` / `reconcile()`.
   - When a caller passes an explicit `timings.pollMs` (e.g. tests using a short poll interval), keep the fixed interval without backoff so tests remain deterministic.
3. In `src/core/store-process/server.ts`:
   - Avoid opening and closing a brand new `DatabaseSync` every 10 s in `readSchema` / schema check when the database file's `(dev, ino, mtimeMs, size)` has not changed (or keep a persistent read-only `DatabaseSync` handle closed cleanly on server shutdown, reopening only if inode changes). Verify schema-change detection and shutdown cleanup still work identically.
4. In `src/runners/observe/recorder.cjs`:
   - Cache `fs.realpathSync.native` lookups in a `Map` (bounded to e.g. 16,384 entries) so repeated calls for the same path in `load()` (`f`, `m`, `d`) avoid redundant syscalls.
   - Handle thrown errors (e.g. `ENOENT`) cleanly without caching stale failures across file creation, or preserve exact error/fallback behavior of `real()`.
   - **CRITICAL:** Do NOT bump `RECORDER_VERSION` or `KEY_FORMAT_VERSION`. Run `pnpm exec vitest run test/keys/key-format.test.ts` and verify every single test in `key-format.test.ts` passes!
5. Verify with targeted tests: `test/watcher/change-feed-backoff.test.ts`, `test/watcher/*.test.ts`, `test/daemon/lifecycle.test.ts`, `test/store-process/*.test.ts`, `test/runners/observe/realpath-cache.test.ts`, and `test/keys/key-format.test.ts`.

---

## Row 024-05: D5 - SQLite write lock holds <= 250 ms and connection tuning

**Goal:** Eliminate `store.longWrites` (> 250 ms) by tuning SQLite pragmas, taking WAL checkpointing off arbitrary write commits for daemon and store-process connections, throttling `results.last_used_at` updates, and slicing bulk scheduler transactions into bounded chunks.

**Owned files:**
- `src/core/store/open.ts`
- `src/core/daemon/open.ts`
- `src/core/daemon/idle-checkpoint.ts`
- `src/core/store-process/writer.ts`
- `src/core/store/repos/results.ts`
- `src/core/scheduler/record.ts`
- `src/core/scheduler/batch.ts`
- `src/core/scheduler/tiers.ts`
- Tests: `test/store/open-tuning.test.ts` (new), `test/scheduler/write-slices.test.ts` (new), and updates to directly related tests if needed.
- Notes: `docs/specifications/024-performance/tasks/024-05-notes.md`.

**Requirements:**
1. In `src/core/store/open.ts`:
   - Set `PRAGMA cache_size = -16384` (16 MiB) and `PRAGMA temp_store = MEMORY` on opened connections.
   - When `options.create === false` and `found === SCHEMA_VERSION`: skip `PRAGMA page_count`, skip `switchToWal` if `PRAGMA journal_mode` is already `"wal"`, and skip `migrate(db)`.
   - Add optional `readonly managedCheckpoint?: boolean;` to `OpenStoreOptions`. When `true`, set `PRAGMA wal_autocheckpoint = 0` on that connection so normal commits (like heartbeats) never stall on a 1,000-page auto-checkpoint.
   - Never raise `SCHEMA_VERSION` and never drop `results_by_failure`.
2. In `src/core/daemon/open.ts`, `src/core/daemon/idle-checkpoint.ts`, and `src/core/store-process/writer.ts`:
   - Pass `managedCheckpoint: true` from `openDaemon`.
   - In `store-process/writer.ts`, set `PRAGMA cache_size = -16384`, `PRAGMA temp_store = MEMORY`, and `PRAGMA wal_autocheckpoint = 0` on the writer connection, and run `PRAGMA wal_checkpoint(PASSIVE)` outside any write transaction periodically (e.g. when WAL file size exceeds 8 MiB or after every N batches) so WAL growth stays bounded under sustained writes.
   - In `src/core/daemon/idle-checkpoint.ts`, add a `passiveCheckpoint(db, walPath)` helper (runs `PRAGMA wal_checkpoint(PASSIVE)` only when not in a transaction and the `-wal` file exceeds a threshold like 8 MiB) and call it alongside `IdleCheckpoint` (note: do NOT edit `lifecycle.ts` since `024-04` owns it! Instead, `IdleCheckpoint.due` or a helper invoked by `truncateWal` / `IdleCheckpoint` can handle passive checkpoints cleanly: e.g. `IdleCheckpoint` is called every `checkMs` (5 s) from `lifecycle.ts:336` — or if `IdleCheckpoint.due` returns true only on quiet, check how `lifecycle.ts:336` calls it: `if (checkpoint.due(at, work)) truncateWal(...)`. Keep `IdleCheckpoint`'s quiet `TRUNCATE` behavior intact, and add `checkpointWalPassive` to `idle-checkpoint.ts` + wire passive checkpointing inside `record.ts`/`open.ts` or in `store-process/writer.ts` where `024-05` has full ownership! Even better: in `openDaemon` (`src/core/daemon/open.ts`), start a tiny unref'd 15 s timer or run passive checkpoint after writes via a lightweight callback on `Connection` / `openDaemon` that closes when the store closes, so `024-05` touches ZERO lines of `lifecycle.ts`!).
3. In `src/core/store/repos/results.ts`:
   - Define `RESULT_TOUCH_INTERVAL_MS = 3_600_000` (1 hour).
   - In `byKey(key, usedAt = Date.now())`, when `usedAt > 0`, update only when `last_used_at < usedAt - RESULT_TOUCH_INTERVAL_MS`:
     `UPDATE results SET last_used_at = ? WHERE key = ? AND last_used_at < ?` with params `(usedAt, key, Math.max(0, usedAt - RESULT_TOUCH_INTERVAL_MS))`.
   - Keep `usedAt === 0` strictly read-only (`test/store/repos.test.ts:304`). Check `test/store/prune.test.ts` and `test/store/repos.test.ts` to verify all retention tests pass.
4. In `src/core/scheduler/record.ts`, `src/core/scheduler/batch.ts`, and `src/core/scheduler/tiers.ts`:
   - Slice bulk writes (`#write` / `#record` in `record.ts`, `reconcileBatch` in `batch.ts`, `startTier` in `tiers.ts`) when the number of files/rows exceeds a slice threshold (e.g. `WRITE_SLICE_FILES = 200`), committing each slice in its own short `store.transaction(...)` and yielding the event loop (`await new Promise((r) => setImmediate(r))`) between slices so SQLite write locks stay well below 250 ms and never starve hooks or other worktrees.
   - Keep small batches (`<= WRITE_SLICE_FILES`) in a single atomic transaction with zero extra async overhead.
   - Preserve every ordering and consistency invariant: write revision/header/meta markers in the final slice after file rows commit, and preserve `BusyWaits` / retry handling (`#writes` / `store.transaction`) cleanly.
5. Verify with targeted tests: `test/store/open-tuning.test.ts`, `test/store/open.test.ts`, `test/store/repos.test.ts`, `test/store/prune.test.ts`, `test/daemon/idle-checkpoint.test.ts`, `test/store-process/*.test.ts`, `test/scheduler/write-slices.test.ts`, `test/scheduler/runs.test.ts`, and `test/keys/key-format.test.ts` (since `results.ts` may be in the key-format validity path — verify!).
