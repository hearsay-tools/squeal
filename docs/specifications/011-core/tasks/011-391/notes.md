# 011-391: no whole-store check at a daemon start; damage marks the store when it is hit

Worker notes, wave 121 (W1). Branch `cez/9a16acba`.

## What a damaged store does now

| Case | Before | Now |
|---|---|---|
| A start opens a store with page damage its open does not read | `quick_check` read every page (82.7 s cold on 4.9 GB) and moved it aside | The start serves. Nothing reads the damage until a read or write hits it, or the next full check finds it. |
| A start opens a store whose header or schema is damaged (the open throws SQLITE_CORRUPT or SQLITE_NOTADB) | moved aside at the start | The same: moved aside at the start, under the recovery lock. The note says `found: "start"`. |
| A store marked by a failed full check | the next start moved it aside | The same. The note keeps `check: "full"`, `checkedAt`, and adds `found: "full-check"`. |
| A daemon's timer (heartbeat, expiry, presence, idle checkpoint, observed keys), its main-store prune, its scheduler (`onError`), a main-store request (write batch, import, sync, run --all, slow suite, group, hold, resume), the full check's claim, or its start (registration, policy, timers, `#run`) throws corruption | logged, or noted as `daemon error: …`; the daemon served on | `storeFaults` writes the mark (`found: "daemon"`, the error text, when) beside the store and stops the daemon as `store-unusable` (exit code 1) with a persisted note. A request still answers with its error. |
| Other daemons on that store | served on | Stop at their next heartbeat (`storeCondemned`), as after a failed full check. |
| The next start | — | Finds the mark and moves the store aside; the note says `found: "daemon"` and `markedAt`. |
| A hook whose open meets corruption | returned `null`, silent | The same, and it writes the mark (`found: "hook"`) beside the store. It never moves the store. |
| A hook whose read or write throws corruption (inside `withContext`) | the error ended the hook silently | The same, and the mark is written first (`HookContext.faulted`). |
| A hook that cannot write the mark (read-only directory, mark path unusable) | — | No throw, no output, no mark. A busy store does not matter: the mark is a file, not a store write. |
| `squeal status` after the move | "store was recovered from corruption at T[: the full integrity check at T found a fault]; the baseline was lost (…)" | Names the finder: "a daemon start's open of the store", "the full integrity check at T", "a daemon's read or write of the store at T", "a hook's open, read or write of the store at T". A note from before this row reads as before. |

Not marked, on purpose: corruption from the code store or the lint store (other files). The code pass's and lint passes' `onError`, the code prune (`"code prune"`) and `requestKeep` (it opens the code store) do not reach the classifier. `isCorruption` cannot tell which file threw, so only paths that touch the main store only are wired.

Two narrow cases can still pass another store's corruption to the classifier, accepted here and open to the review: (1) a hook's `withContext` catch also sees a failure of `prepared.commit()`, which can commit a held code-store write (row 011-288); the code and lint reads themselves swallow their errors (`withCode`, `withLint`). (2) A daemon's start failure (`#startFailed`, including `#run`) classifies any error; today the code, lint and coverage stores open lazily after the start and report through their own `onError`, so none reaches it.

A mark is never written over a mark that names the file at the path, and it names the file its writer opened (repair round, below).

## Repair round (review of cand/0.1.545, B1 and B2)

B1, a mark on a replacement store. The stat-then-compare before a mark left a window: another start could move the damaged file aside and put a fresh store at the path between the compare and the write, and the next open discarded the fresh store. Now every mark names the file its writer opened (`StoreMark.file`, device and inode): the daemon's the file its connection holds (`OpenedDaemon.storeFile`), the hook's the file at the path just before its open, the full check's the file at the path just before its check opens it. A checked open, the heartbeat (`storeCondemned`) and every marker read only a mark that names the file now at the path (`currentMark`); a checked open removes one that names another file (`dropStaleMark`, which renames it away before it reads it again and puts back a mark that names the file at the path). A mark written before this round has no `file` and names the file at the path, as before. The binding was chosen over the recovery lock: no hook waits on a lock, and a stale mark is harmless. The mark code moved to `src/core/store/mark.ts`; every writer goes through `markFault` (`src/core/daemon/store-fault.ts`).

B2, a hook read before the catch. `openContext` now classifies an error thrown by its own open (`openSentStore` reads the worktree's row) and by the context's construction, through the same `markHookFault`, and rethrows it as before; the hook runner stays silent. Every other hook read of the main store is inside `withContext` (the `readTransaction` users in `src/harness/shared` take the `HookContext`). Two hook paths stay outside, by reasoning, not by a test: `recordedDaemon` (`src/core/daemon/ensure.ts`), which the ensure step calls before the context and which swallows every error, reads the same worktree row the context's open reads next, so that open marks; a hand-off's commit (`src/harness/shared/hand-off.ts`) writes pages the hook already read inside `withContext`.

Busy-tier (`test/daemon/busy-tier.test.ts`, row 011-126): this row cannot change what its note lists. The classifier acts only on SQLite codes 11 and 26; a busy store's error is code 5, and every busy path (`SlicedWrites`, `SlicedPrune`, the scheduler's `onError`) handles it before or instead of the classifier. The start no longer runs `quick_check`, but the test holds the store only after the daemon is ready. A note without "revision 1" is the race in which the revision's write did not have to wait.

## How long a new store goes unchecked

The first full check of a store (no `META_FULL_CHECK` row) is still claimed at the first daemon's serve, as before; the fresh store a move-aside creates has none either. So a new store is unchecked from its creation until that first full check ends: the time to its first serve plus the check's own run (24 s on 850 MB; a new store is small, so about seconds). After that, a store is checked once per 24 h. Damage that appears between two full checks goes unnoticed until a read or write hits it or the next check runs: at most about 24 h plus the check's run.

## Lines touched in `openStoreFile` (`src/core/daemon/open.ts`)

Row 005-105 also changes this function. Mine, at commit `ef348f4f9`:

- Line 230: `checkIntegrity: "quick",` became `checkIntegrity: "mark",`.
- Lines 214 and 215, its doc comment: "The store, quick-checked (D12), with the file its connection holds" became "The store, moved aside on a mark or on its open's corruption (D12; no whole-store check, row 011-391), with the file its connection holds".
- Outside the function: `openDaemon`'s doc comment, lines 66 to 68, the same change of words.

## Files outside the brief's ownership (agreed by the coordinator, 2026-11-17)

- `src/harness/shared/hook.ts`, `withContext`'s catch: one call, `context.faulted?.(error)`.
- `src/core/status/snapshot.ts`, `recoveryNote` and its `FINDERS` table.
- `src/core/daemon/store-file.ts`, `storeCondemned`'s text through the new `faultFound`.
- `src/core/daemon/sliced-writes.ts` (`SlicedContext.storeFault`, one line in `#run`'s catch) and `src/core/daemon/sliced-prune.ts` (`run`'s `fault` parameter, `#failed`).
- Also `src/core/daemon/full-check.ts` (`FullCheckContext.storeFault`, the claim's catch, `found: "full-check"` in its mark) and `full-check-claim.ts` (a doc comment only).

## Type changes

- `IntegrityCheck` (`src/core/store/open.ts`): `"quick"` became `"mark"`. Not additive; the only product caller is the daemon's open. Tests moved with it.
- `StoreMark.found?: FaultFinder`, with `FaultFinder = "start" | "full-check" | "daemon" | "hook"` (new, additive), and `StoreMark.file?: MarkedFile` (repair round, additive). `StoreMark`, `FaultFinder`, `MarkedFile`, `markStore` and `readStoreMark` now live in `src/core/store/mark.ts`; importers moved (the lint forbids re-exports).
- New in `store-fault.ts` (repair round): `markFault`, `markHookFault`, `OPEN_CORRUPT`, `storeFileOrNull`; `markCorrupt` left `context.ts`.
- The recovery note (`META_STORE_RECOVERED`) gains `found` and, for a mark that is not the full check's, `markedAt` (additive JSON fields).
- `TimerContext.storeFault?` and `FullCheckContext.storeFault?` (additive, optional).
- `HookContext.faulted?(error)` (additive, optional).
- `SlicedPrune.run` gains a fourth optional parameter `fault`.
- New module `src/core/daemon/store-fault.ts`: `storeFaults`, `watched`.
- New export: `faultFound` (`store-file.ts`).
- `integrityProblem` (the `quick_check` call) is gone.

## Tests

- `test/daemon/store-fault-daemon.test.ts`: real daemons on really damaged store files (`test/store/damage.ts` finds pages with `dbstat` and overwrites them in the file). Damage under a serving daemon in pages it never read; a second start serves, its full check's claim reads the damaged row, it marks and stops; the first daemon stops at its heartbeat; the next start moves the store aside with `found: "daemon"`. A damaged header moves the store aside at the start (`found: "start"`). A start on a 20 MB store issues no `quick_check` or `integrity_check` statement (spies on `DatabaseSync.prototype.prepare` and `exec`).
- `test/daemon/store-fault.test.ts`: the classifier: once only, other errors not its, no mark over a mark, none beside a moved file, stops when the mark cannot be written.
- `test/harness/store-fault-hook.test.ts`: a hook on a damaged header and on a damaged read marks, prints nothing, moves nothing; keeps a mark already there; with a read-only store directory it neither throws (beyond the read's own error, which the hook runner silences) nor prints nor marks.
- Repair round: `test/daemon/mark-binding.test.ts` replaces the store at the marking boundary (after every check, before the write) for the daemon's marker and the hook's, and the fresh store survives a checked open with the stale mark removed; it fails with the binding disabled (checked once by hand). `test/harness/store-fault-hook.test.ts` damages the worktree row the context's open reads: the hook marks and prints nothing. `test/store/open.test.ts`: a mark that names another file is ignored and removed; one that names the file moves it aside.
- `test/store/open.test.ts`: the page-damage case now opens and the read throws corruption, with no whole-store statement issued; the header case moves aside with `found: "start"`; a daemon-found mark moves aside with `found` and `markedAt`; an unknown finder reads as the full check's.
- `test/status/recovered.test.ts`: the status line for each finder.
- `test/daemon/full-check-daemon.test.ts` (failed full check) is unchanged in behaviour and passes.

## Proposed spec amendments (for the coordinator to land)

### 011, "store failures" bullet, after the 2026-10-26 amendment

> Amended 2026-11-18 (the human, option A, row 011-391, `../005-agent-adoption/research/session-start-cost.md` section 7): a daemon start runs no whole-store check. Its `quick_check` read every page of the shared store before it served: 82.7 s cold and 12.6 s warm on a copy of a 4.9 GB store, at about 230 to 450 starts a day. A start moves the store aside only on a mark, or when its open itself throws SQLITE_CORRUPT or SQLITE_NOTADB (a damaged header or schema). Damage elsewhere is found by the 24 h full check, or by the first read or write that hits it: a daemon whose timer, scheduler, main-store request, full-check claim or start throws corruption writes the mark beside the store with what it saw, persists a note and exits with reason `store-unusable`; every other daemon on the store exits at its next heartbeat, and the next start takes the move-aside path. A hook whose open, read or write throws corruption writes the same mark when it can and stays silent; it never moves the store. A mark is not written over one already there, nor beside a file other than the one its writer opened. The recovery note, and status, say what found the damage: a start's open, the full check, a daemon's read or write, or a hook's. Corruption of the code or lint store marks nothing. A new store is checked by the first full check after its first serve, then once per 24 h; damage between two checks stays unnoticed until a read hits it or the next check runs.

### 001 D12, "Store unreadable or corrupt"

> Amended 2026-11-18 (row 011-391; 011 "store failures" as amended 2026-10-25 and 2026-11-18): no check runs at a daemon start beyond the open's own reads. A store whose open fails as corrupt, that the daily full `integrity_check` found faulty, or in which a daemon's or hook's read or write hit damage is moved aside by the next daemon start; a fresh store is created, and status says the baseline was lost and what found the damage.

## For the next worker

- The version raise and the review are the coordinator's (the brief's rules: no version raise here).
- `test/e2e/torn-status.test.ts` reads `src/core/status/snapshot.ts` but is an opt-in probe (`SQUEAL_PROBE_TORN_STATUS`); it skipped.
- The board row's "every daemon on it stops" holds through the heartbeat (`heartbeatMs`, default as before). A daemon whose heartbeat is slow stops later.
