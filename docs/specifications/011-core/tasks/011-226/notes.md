# 011-226 notes: a quick check at start, the full check after serving

Worker 75b74928, 2026-10-26. Brief: `tasks/wave-43.md` W1.

## Seam map

- `src/core/store/open.ts`: `OpenStoreOptions.checkIntegrity` is `"quick" | "full"` (was `boolean`). A checked open reads the mark first (`<common-dir>/squeal/store.sqlite.check-failed`), then runs `quick_check` or `integrity_check`. A mark or a fault takes the move-aside path (`recover`); the mark moves with the file (`store.sqlite.corrupt-<at>.check-failed`). `META_STORE_RECOVERED` gains `check: "full"` and `checkedAt` when the mark caused the move. Also here: `META_FULL_CHECK` (the claim row, `store.full-check`), `markStore`, `readStoreMark`, `isCorruption` (now exported).
- `src/core/daemon/full-check.ts` (new): `claimFullCheck` (the row in a `BEGIN IMMEDIATE` transaction), `runFullCheck` (a `node -e` child at nice 10, read-only, `integrity_check(10)`, JSON on stdout), `startFullCheck` (claim, run, mark and note on a fault; its stop returns a promise). The claim and its return are C8's sliced writes (`BUSY_SLICE_MS` per try, `busyBackoffMs` between tries; repair R1, review 0.1.329 B1 and S1).
- `src/core/daemon/store-file.ts` (new in R1): `StoreFile`, `storeFileOf`, `storeCondemned` (the heartbeat's reason to stop).
- `src/core/daemon/daemon.ts`: `startFullCheck` once the phase turns `ready`; the shutdown stops it after `#starting` settles.
- `src/core/daemon/lifecycle.ts`: each heartbeat calls `storeCondemned` first and stops the daemon with `store-unusable` when it returns a reason.
- `src/core/daemon/open.ts`: `openStoreFile` passes `"quick"` and reads the store's file before and after the open; it opens again (up to three times) when they differ or the file was missing before (R1, review B3). `OpenedDaemon.storeFile` is that file, spread into the timers' context.
- `src/core/status/snapshot.ts` (by agreement with the coordinator): `recoveryNote` names the full check when `check` is `"full"`.

## Decisions the spec did not settle

1. **A child process, not a worker thread.** Nice 10 needs a process. The script is inline (`node -e`), so the bundles need no new entry. `NODE_OPTIONS` is dropped from its environment, so a preload cannot break it.
2. **Claim given back.** A check that the shutdown stops, or that could not run, gives its claim back while the row still holds it, so the next start runs it. Daemons often live only seconds after their session ends; without this, a short-lived daemon would cost the day's check. A daemon killed with SIGKILL during the check keeps the claim for 24 h. R1: the return waits for a busy store in slices for at most `RELEASE_WITHIN_MS` (120 s, the start's own bound), and the shutdown awaits it before the store closes; past it the claim stays, logged.
3. **The heartbeat also stops a daemon whose store file was moved aside or removed** (inode compare). R1: the inode is read before and after the open, so it is the connection's file; a start that creates the store opens it twice (`test/daemon/open.test.ts` seeds the store for its five-start count). Without this, a start in another worktree that moves the marked store aside before every daemon's next heartbeat takes the mark with the file, and a daemon that had not yet read the mark would serve on the moved file for the rest of its life. Today's quick-check move-aside has the same gap; this closes it for both.
4. **Only at start.** A daemon tries the claim once, when it turns ready. A daemon that lives more than 24 h does not check again; the next start does.
5. **`integrity_check(10)`.** The check stops at 10 problems, which is enough to mark the store, and keeps the note short.
6. **Exit reason `store-unusable`**, an existing reason, so `DaemonExitReason` is unchanged.

## Type changes

- `OpenStoreOptions.checkIntegrity`: `boolean` → `IntegrityCheck` (`"quick" | "full"`). All callers updated.
- `OpenedDaemon.storeFile: StoreFile` added (nullable before R1). `TimerContext.storeFile?: StoreFile | null` added.
- R1: `startFullCheck` returns `() => Promise<void>` (was `() => void`). `StoreFile`, `storeFileOf`, `storeCondemned` moved from `full-check.ts` to `store-file.ts`.
- New exports from `src/core/store/index.ts`: `IntegrityCheck`, `isCorruption`, `META_FULL_CHECK`, `markStore`, `readStoreMark`, `StoreMark`.

## For whoever continues

- The bundles drift (`test/harness/plugin.test.ts`, `codex/plugin.test.ts`, `pi/package.test.ts`); the coordinator rebuilds them.
- `test/store/helpers.ts` `seedIndexFault` makes an index-only fault: a `fault` table whose index SQL names another column, written with Node 24's `defensive: false`.
- Not timed: the full check's cost on the host's 850 MB store at nice 10 beside load. Research measured 24 s at nice 10 on a copy.
