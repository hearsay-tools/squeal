# 011-45: the fallback `status --wait` reads every state only when one changed

Worker 6702c043, 2026-11-14. Brief: `tasks/wave-90.md` W2. Board row 011-45. Starts from row 011-331 (`tasks/011-331/notes.md`: the edit wait's read is `editPoll` in `src/cli/wait/status.ts`).

## What changed

| File | What |
|---|---|
| `src/core/store/states-marker.ts` (new) | The states marker: one `meta` row per worktree, `states-marker.<id>`, JSON `{seq, writer}`. `bumpStatesMarker` (one SQL statement, for the repositories), `bumpStatesMarkerOf` (for a caller that holds the store), `claimStatesMarker` (a daemon's registration), `statesMark` (the reader's trust), `everyDaemonClaims` (the store-wide half of that trust, shared with row 011-44). |
| `src/core/types/store.ts` | `WORKTREE_META_ROWS.statesMarker`, so `WorktreeRepo.remove` drops the row with its worktree. |
| `src/core/store/repos/states.ts`, `repos/test-files.ts` | `KnownStateRepo.upsertMany` and `TestFileKeyRepo.upsertMany` bump the marker of each worktree they wrote, inside their own transaction (a savepoint inside the caller's). An empty upsert bumps nothing. |
| `src/core/scheduler/ledger.ts` | The commit bumps the marker when it removed key rows or retired checks (`testFileKeys.remove`, `sink.retire` → `knownStates.removeMany`): the ledger is the one caller of both removals. |
| `src/core/daemon/daemon.ts` | `#register` claims the marker for its incarnation in the registration's transaction, right after `releaseRunning`. The claim bumps `seq`, which also counts `releaseRunning`'s write. |
| `src/cli/wait/every-state.ts` (new) | `readEvery`: the fallback's `readHeld(store, id, start, null)`, from the states and rows kept at the last read while the trusted marker stands; the news is kept too while the revision stays. `keptAtStart`: the start view's states are the first kept read. |
| `src/cli/wait/status.ts` | `editPoll`'s read with no files (the fallback) goes through `readEvery`. Nothing else in the poll changed. |
| `src/cli/status-wait-held.ts` | `newsOf` exported as `newsSince` (renamed only; same body). |

## Trust (the decision the spec did not settle)

A reader trusts the marker only when all of these hold (`statesMark`):

1. The worktree has a marker whose `writer` is its registered daemon's incarnation (`daemonIncarnation`).
2. Every other worktree of the store whose row names a daemon has a marker that daemon claimed.

Rule 2 is its own export, `everyDaemonClaims(store, except?)` in `states-marker.ts`: true when each daemon registered on the store, `except`'s aside, has an incarnation and claimed its own worktree's states marker. `statesMark` calls it with its own worktree as `except`. Row 011-44's store-wide closure-write marker (`src/core/store/closure-writes.ts`) takes this rule instead of a second one (the coordinator, 2026-11-14).

Why 2: a daemon heals another worktree's states when it stores a passing result under a shared key (`scheduler/store-results.ts`: `sink.refresh` and `testFileKeys.upsertMany` on `row.worktreeId`). A daemon of an older release writes those rows with no bump. Every daemon registers before it writes a row (task 001-268), and only a daemon of this release claims its marker, so an unclaimed registration anywhere in the store means "rows may change with no bump". An untrusted marker drops what the wait kept, and every poll reads every state, as before.

A store with no marker (every daemon before this row) is untrusted: today's reads.

Residual case, not handled: a daemon of an older release on another worktree registers, heals this worktree's state, and exits (its record cleared) entirely between two polls of the wait, which are one second apart. The wait would miss that heal until the next bump. A daemon's start, a run and its exit in under a second is not a case I could make happen. If it matters, the mark can also name `lastDaemon` of each worktree.

## Key format

`test/keys/key-format.test.ts` passes with no raise (key format unchanged).

The first shape bumped inside `removeMany`, `remove` and `releaseRunning`, and parsed the marker's JSON on the write path. The guard refused it: "changed lines no case runs" on those lines (`states.ts` and `test-files.ts` are on the validity path through `scheduler/store-results.ts` and `state/sink.ts`; `ledger.ts` and `daemon.ts` are not). The fix moves no meaning:

- The upserts' bump is one SQL statement (`json_set` on `$.seq`). The reader's parse is not on the write path, and esbuild drops it from the validity bundle.
- The removals' bump is in the ledger's commit, the one caller of both removals. `test/store/states-marker.test.ts` fails when another caller of `knownStates.removeMany(`, `testFileKeys.remove(` or `.retire(worktreeId` appears, or when the ledger's bump line goes.
- `releaseRunning` is unchanged. Its one caller, `#register`, claims (and so bumps) the marker in the same transaction.

## Tests

| Test | What it pins |
|---|---|
| `test/cli/wait-every-state.test.ts` | Counting store, both unfiltered reads (`knownStates.list` and `testFileKeys.list` with no files). `readEvery` equals `readHeld(…, null)` (deep equal) after each write: none, a new revision, a state's fail, a key row, a file's finish. It reads again only after a write. With no marker, or after another daemon registered, it reads every time. A fallback `waitForStatus` (a sync that names no incarnation) reads nothing on a poll with no state write. The same wait on a store with no marker reads every state on each poll. A state write 150 ms into the wait ends it with news (`fail`) or quiet (`finish`). Its outcome, transitions and result counts equal those of the same wait on a store with no marker, which reads every state. |
| `test/store/states-marker.test.ts` | Each upsert bumps once, for its own worktree only, and keeps the writer. Empty upserts bump nothing. A rolled-back write leaves the marker. Trust: no marker, an unclaimed bump, an older daemon registered, no daemon, a `null` writer, and another worktree's unclaimed daemon. A cross-worktree upsert bumps the written worktree. `everyDaemonClaims`: an unclaimed daemon, `except`, a claim for another incarnation, a daemon with no token. An unreadable marker starts again at 1. The marker goes with its worktree. The removals' one caller is the ledger. |
| `test/daemon/states-marker-claim.test.ts` | A real daemon's registration claims the marker for the incarnation it registered. A clean exit, or an older daemon's registration, leaves it untrusted. |

## CPU per poll, cezar store copy

Copy: cezar's `store.sqlite` (2.8 GB), with the SQLite backup API (`node:sqlite` `backup`) into a private `/tmp` directory under `nice 10`. The copy took 112 s. Main worktree: 31,810 known states and 1,926 key rows. The store has 52 worktrees, and 4 of them have a daemon record. The script is `measure.ts` in that directory. It reads in one read transaction (`readTransaction`) per poll and gives `process.cpuUsage` per poll, sorted. Host load average was 10 to 13 on 24 vCPUs (the host's real load from parallel coordinators; no load was made on purpose).

| Read | CPU per poll (ms), sorted samples |
|---|---|
| Before: `readHeld(store, id, view, null)` (what each fallback poll did) | 367, 435, 455, 486, 541, 589, 774 (median 486) |
| After: `readEvery`, marker unchanged | 87 to 129, median 98 (15 samples) |
| `statesMark` alone (the per-poll trust check, 52 worktrees) | 0.1 to 0.9, median 0.2 |
| After, untrusted (another daemon claimed none): reads every time | 346, 349, 367, 381, 452 |

What the 98 ms that remain hold: `readHeader` over the kept 31,810 states and 1,926 rows, about 85 ms. Its profile (30 calls) shows `testFileId` 27 ms per call, `countSlowPending` 22, `readLane` 12, `countFilesWithoutChecks` 8, `countNotCurrent` 8 and `countStates` 3; cezar's policy has slow files. The news (`planDelta` over every state, about 42 ms) is kept while the revision stays. Before the news was kept, the per-poll median was about 150 ms.

The header is made each poll from the kept rows on purpose. Its other inputs (the revision, the refined revision, the install wait, checkpoints, the policy file, the slow-tier and group rows) change with no state write. A no-op edit moves the refined revision and ends `runnerPartPending` with no row written. Keeping the header would need a marker over those inputs too. The other way is to split `readHeader` into a pure part over (states, keys, policy), which the wait could keep, and a part read fresh. That split is in `core/state/header.ts`, outside this row's seam. It is a candidate follow-up if a fallback wait's ~0.1 core still matters.

## For the next worker

- Row 011-44 adds a closure marker beside this one in `WORKTREE_META_ROWS`. Whichever lands second rebases that line.
- A new caller of `knownStates.removeMany` or `testFileKeys.remove` must bump the marker in its transaction (`bumpStatesMarkerOf`). The test in `test/store/states-marker.test.ts` names the callers, so a new caller fails it.
- A new writer of known states or key rows that uses raw SQL instead of the repositories must bump too. Today there is none (`grep` for `INTO known_states`, `UPDATE test_file_keys` and similar).
