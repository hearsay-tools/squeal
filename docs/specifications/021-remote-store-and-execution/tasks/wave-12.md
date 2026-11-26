# Spec 021, wave 12: per-worktree stop mark file (#285)

Use `/worker`.

## Row 021-39: store each worktree's stop mark beside its lock file (#285)

**Shape:** slice.

**Outcome:** `squeal stop`, `squeal stop --until-start`, and `squeal start` store and clear each worktree's stop mark in an atomic per-worktree file `<commonDir>/squeal/locks/<worktreeId>.sqlite.stopped` instead of writing `daemon-stopped:<worktreeId>` into the shared `store.sqlite` `meta` table, with backward-compatible read and clear fallback for legacy `meta` rows. Another worktree daemon holding `store.sqlite`'s WAL write lock can no longer stall `squeal stop` for 10 s or prevent stop-mark persistence.

**Read:**
- `docs/specifications/021-remote-store-and-execution/spec.md` (D1, D5, D15) and `docs/specifications/011-core/spec.md` (C8, C9, rows 011-08 and 011-254).
- `src/core/presence/{marks,lock-events,stored,facts,findings,events}.ts`
- `src/core/store/store.ts`, `src/core/store/open.ts`, `src/core/store/paths.ts`
- `src/core/delivery/stopped.ts`
- `src/cli/{stop,stopped-mark,start,status-at-start,remove}.ts`
- `test/cli/{start-stop-busy,stop-mark,daemon-writes,status-at-stopped}.test.ts`, `test/harness/{stopped,stopped-until-start}.test.ts`, `test/presence/io.test.ts`, `test/daemon/hold.test.ts`, `test/e2e/restart-evidence.ts`.

**Starting seam & design contract:**
1. **Per-worktree mark helpers** (`src/core/presence/marks.ts`, `src/core/presence/lock-events.ts`):
   - Add `stopMarkFor(lockFile: AbsolutePath): AbsolutePath` returning `` `${lockFile}.stopped` as AbsolutePath `` (sibling to `.starting` and `.spawned`, so `squeal remove`'s `.sqlite` filter never treats it as a lock file and `squeal remove` cleans up `locks/`).
   - Add `readStopFile(lockFile: AbsolutePath): StopMark | null` parsing `{ at, tree, untilStart? }` with the same validation as `readStop`; return `null` when missing or unreadable.
   - Add `writeStopFile(lockFile: AbsolutePath, mark: StopMark): void` ensuring `dirname(lockFile)` exists (`mkdirSync(..., { recursive: true })`), writing to a unique sibling temp file (`${path}.${process.pid}.${randomBytes(4).toString("hex")}`), and renaming atomically (`renameSync`, cleaning up temp on failure). Do NOT swallow errors: let filesystem errors throw so `leaveStoppedMark` surfaces them honestly.
   - Add `removeStopFile(lockFile: AbsolutePath): void` unlinking `stopMarkFor(lockFile)`, ignoring `ENOENT` only and letting other errors throw.
2. **Store paths lookup** (`src/core/store/store.ts`):
   - Expose `storePathsOf(store: Store): StorePaths | null` using a Symbol (`STORE_PATHS`) defined on `store` (forwarded through `Proxy`, matching `CONNECTION`) so any `readStop(store, worktreeId)` caller finds `locksDir` even for a linked worktree with no `worktrees` row.
3. **Read with legacy fallback** (`src/core/presence/stored.ts`, `src/core/presence/facts.ts`):
   - Update `readStop(store, worktreeId, lockFile?)` to check `readStopFile(resolvedLockFile)` first (from explicit `lockFile`, or `join(paths.locksDir, `${worktreeId}.sqlite`)` via `storePathsOf(store)`), and fall back to `store.meta.get(stoppedMetaKey(worktreeId))` when no `.stopped` file exists.
   - In `readPresenceFacts`, pass `lockFile()` to `readStop(store, worktreeId, lockFile())`. Keep lazy evaluation in `heldStop`: a fresh heartbeat must still read neither `.stopped` nor `meta`.
4. **Write and clear without taking `store.sqlite`'s write lock** (`src/cli/stopped-mark.ts`):
   - `leaveStoppedMark(root, at, tree, untilStart, busyBoundMs)`:
     - Resolve `commonDir`, `id = worktreeIdFor(root)`, `lockFile = lockFileFor(commonDir, id)`, `dbPath = storePaths(commonDir).database`.
     - If `!existsSync(dbPath)`:
       - Plain stop (`!untilStart`): create nothing, write nothing, return `{ error: null, untilStart: false }`.
       - `--until-start` without `POLICY_FILE`: create nothing, write nothing, return `{ error: null, untilStart: true }`.
       - `--until-start` with `POLICY_FILE`: initialize the empty store schema (`openStore(commonDir, { create: true, busyTimeoutMs })`, then close) so `SessionStart` opens `HookContext` and reports the stopped state instead of skipping registration; if opening fails, return `{ error, untilStart: false }`; then write `<lockFile>.stopped`.
     - If `existsSync(dbPath)`:
       - Preserve an existing `untilStart: true` mark (row 011-254) by checking `readStopFile(lockFile)?.untilStart === true`, else a strictly read-only WAL lookup (`openReadOnly(dbPath, SCHEMA_VERSION)`) of `meta` `daemon-stopped:<id>` (never taking a write lock; ignore read failure cleanly).
       - Write `<lockFile>.stopped` via `writeStopFile`; on thrown error return `{ error: message, untilStart: false }`; otherwise `{ error: null, untilStart: until }`. Never open a SQLite write transaction.
   - `clearStoppedMark(root, busyBoundMs)`:
     - Remove `<lockFile>.stopped` via `removeStopFile` (return error string if a non-ENOENT error throws).
     - Check strictly read-only (`openReadOnly(dbPath, SCHEMA_VERSION)`) whether a legacy `daemon-stopped:<id>` row exists in `meta`. If absent (or no store), return `null` immediately with zero SQLite writes. Only if a legacy `meta` row exists, clear it via `withStore(root, (store, id) => clearStopped(store, id), { boundMs: busyBoundMs })` (preserving D1/#108 and D15 daemon-writer routing for legacy rows).
5. **Hook edit-clear and null-tree fill** (`src/core/delivery/stopped.ts`):
   - In `stopHolds`, when `tree` differs from `mark.tree`:
     - Check `fileNow = lockFile === null ? null : readStopFile(lockFile)` (resolving `lockFile` from `storePathsOf(store)` or `resolveCommonDir(at.root)`).
     - If `fileNow !== null`: preserve the R2 race check (`fileNow.at !== mark.at || fileNow.tree !== mark.tree || fileNow.untilStart === true` -> return `true`). If `mark.tree === null`, update `<lockFile>.stopped` with `{ at: mark.at, tree }` via `writeStopFile` and return `true` (no SQLite write). Otherwise unlink `<lockFile>.stopped`, and if a legacy `meta` row also exists (`store.meta.get(stoppedMetaKey(at.id)) !== null`), clear it inside `write(() => store.transaction(() => clearStopped(store, at.id)))`; return `false`.
     - If `fileNow === null`: if no legacy `meta` row exists (`store.meta.get(stoppedMetaKey(at.id)) === null`), `squeal start` cleared the mark meanwhile -> return `false` with no SQLite write; otherwise keep the existing `write(() => store.transaction(...))` path for legacy `meta` marks.

**Owns:**
- `src/core/presence/{marks,lock-events,stored,facts}.ts`
- `src/core/store/store.ts`
- `src/core/delivery/stopped.ts`
- `src/cli/{stopped-mark,stop,status-at-start}.ts`
- Stop-mark tests: `test/cli/{start-stop-busy,stop-mark,daemon-writes,status-at-stopped}.test.ts`, `test/harness/{stopped,stopped-until-start}.test.ts`, `test/presence/io.test.ts`, `test/daemon/hold.test.ts`, `test/e2e/restart-evidence.ts` (and new unit tests if helpful).

**Leave alone:** `docs/board.md`, `package.json`, `plugins/**/dist`, `src/cli/hold.ts`, `src/core/code/`. Do NOT run `pnpm run build`.

**Done when:**
- Regression tests prove:
  1. In a linked idle worker worktree (no daemon, no `worktrees` row) while another process holds `BEGIN IMMEDIATE` on the shared `store.sqlite` for 30 s, both plain `squeal stop` and `squeal stop --until-start` complete fast (< 2 s, exit 0, empty stderr), persist `<lockFile>.stopped`, and leave no `daemon-stopped:` row in `store.sqlite`.
  2. `clearStoppedMark` on a file-backed stop mark succeeds fast without waiting on a held `store.sqlite` write lock, and clears both `.stopped` and any legacy `meta` row when upgrading from a legacy stop mark.
  3. A filesystem write failure on the stop mark still exits 1 for `squeal stop --until-start` and warns + exits 0 for plain `squeal stop`.
  4. `stopHolds` fills a `null` tree and clears on edit for file-backed marks without a SQLite write, preserves review wave-1.10 R2 (`squeal start` race), and falls back cleanly for legacy `meta` marks.
  5. `test/presence/io.test.ts` confirms fresh heartbeat reads `[]`, stale heartbeat with `.stopped` file reads `[".stopped"]`, and stale heartbeat with only a legacy `meta` mark reads `[".stopped", "stop"]`.
- `pnpm run lint`, `pnpm run typecheck`, `squeal status --wait 60000 <changed paths>`, and direct Vitest runs on any affected tests outside Squeal's coverage (including `test/daemon/hold.test.ts` or `test/cli/start-stop-busy.test.ts` if needed) pass. Report exact commands and outputs. No full suite. Do not run `pnpm run build`.
