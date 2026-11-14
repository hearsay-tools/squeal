# 011-45: the fallback `status --wait` reads every state only when one changed

Worker 6702c043, 2026-11-14. Brief: `tasks/wave-90.md` W2. Board row 011-45. Starts from row 011-331 (`tasks/011-331/notes.md`: the edit wait's read is `editPoll` in `src/cli/wait/status.ts`).

Review 0.1.489 failed this design (B1). The repair below, "Repair round for review 0.1.489 (wave 90.5)", replaces the marker's writers and its trust rule. The sections "What changed" (the writer rows), "Trust", "Key format" and the store and daemon test rows describe the first round and are kept as the record.

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

## Repair round for review 0.1.489 (wave 90.5)

Worker 6702c043, resumed 2026-11-14. Brief: `tasks/wave-90.5.md` W1. Review: `reviews/0.1.489.md`, B1. This round owns both markers: row 011-44's closure marker and this row's states marker. Start: `git reset --hard 73c8277ea`.

**B1.** The markers moved only when a writer of this release bumped them. Trust (`everyDaemonClaims`) saw only the daemons registered at the read. Two writes changed the rows and left the marker, so both caches kept stale rows:

- (a) an older daemon that registers, writes and exits between two reads;
- (b) an older `squeal code` gate that writes through `storeResults` with no daemon.

The fallback wait ended `timeout` with 0 transitions where a full read gives `news` with 1.

### The rule now: the database moves the markers

`src/core/store/write-markers.ts` replaces `states-marker.ts` and `closure-writes.ts`. It is the one owner of both markers:

- Nine triggers, `squeal_marker_<table>_<insert|update|delete>`:
  - `known_states` and `test_file_keys` set `states-marker.<worktree_id>` (of the old row and the new row) to `lower(hex(randomblob(8)))`;
  - `test_files` sets `closure-writes` the same way.
  - They run in the writing statement's own transaction, for every writer of every release: an older daemon, a gate with no daemon, the transfer import, raw SQL. A random value, so a store made again never repeats a value a reader holds.
- `ensureWriteMarkers(store)`:
  - Makes missing triggers with `CREATE TRIGGER IF NOT EXISTS`, outside `schema.ts`, with no `user_version` raise (as `ensureImportTables`).
  - In the same transaction, sets the closure marker and the states marker of every worktree that has rows, so the rows written before the triggers count as a write.
  - A store that has all nine triggers is left alone: one `sqlite_master` read.
  - The daemon calls it in `#register`, in the registration transaction, before `releaseRunning`.
- Trust (`statesMark`, `trustedClosureWrites`):
  - The marker's table's triggers all exist (by name in `sqlite_master`), and the marker has a row. This is read in the reader's read transaction, beside the marker and the rows.
  - Otherwise the reader reads in full each poll, as at `5e8dcc223`: a store no daemon of this release opened, a dropped trigger (a release that makes a table again), a removed worktree (its row goes after its rows), or a test's store with no connection.
  - A change to a trigger's body must take a new name. A reader checks names, not bodies.

### Deleted (replace, not layer)

- The repositories' bumps: `KnownStateRepo.upsertMany` and `TestFileKeyRepo.upsertMany` (`repos/states.ts`, `repos/test-files.ts`, back to `5e8dcc223`).
- The ledger commit's removal bump (`scheduler/ledger.ts`, back to `5e8dcc223`).
- `storeClosures`' and `addClosures`' `markClosureWrite` (`scheduler/revision.ts`, `store/transfer-rows.ts`, back to `5e8dcc223`).
- The registration's `claimStatesMarker` (`daemon/daemon.ts`; `ensureWriteMarkers` takes its line).
- `everyDaemonClaims`, `bumpStatesMarker`, `bumpStatesMarkerOf`, `claimStatesMarker`, `markClosureWrite`, `closureWrites`, and the files `src/core/store/states-marker.ts` and `src/core/store/closure-writes.ts`.
- The writer source-scan tests: "leaves the removals to the ledger's commit" (`test/store/states-marker.test.ts`) and "is moved by both writers of closures, and by no other code" (`test/cli/stored-closures.test.ts`).
- The trust tests on daemon claims: `test/store/states-marker.test.ts` (whole file), `test/daemon/states-marker-claim.test.ts` (whole file), and "is trusted while every registered daemon claimed", "is not trusted with no daemon registered", "sees a closure an unclaimed daemon wrote" in `test/cli/stored-closures.test.ts`.
- `claimAll` in `test/cli/closure-trust.ts` (now `armMarkers`).

`WORKTREE_META_ROWS.statesMarker` stays (owner now `store/write-markers`), so `WorktreeRepo.remove` drops the row after the worktree's rows.

### Tests

| Test | What it pins |
|---|---|
| `test/cli/older-writers.test.ts` (new, red on `73c8277ea`: 6 of 6 failed, now 6 pass) | Both B1 sequences, each with writes in raw SQL that runs no marker code. (a) X registers as an older daemon, writes, and clears its registration before the next read. (b) No registration at all. After each: the kept fallback read deep-equals `readHeld(…, null)` and has the recovery as 1 news; a named selection with kept closures equals a full one after an older closure write adds `START` and after one drops it; a real fallback `waitForStatus`, with B pending, ends `news` with 1 transition, as the same wait on a store without triggers. |
| `test/store/write-markers.test.ts` (new) | `ensureWriteMarkers` makes 9 triggers once, keeps `user_version`, and sets the markers of worktrees with rows and the closure marker. Every insert, replace, raw update and removal of states and key rows moves its worktree's marker only. Every put, replace, raw update and removal of a closure moves the closure marker. A write that changes no row moves nothing. A rolled-back write leaves both. Trust: none before the triggers, per table (a dropped key-row trigger leaves the closure marker trusted and the reverse), none after the worktree's removal, none from a store without a connection. |
| `test/daemon/write-markers-start.test.ts` (new) | A real daemon's registration makes the triggers. Both markers stay trusted after it exits, and a write after its exit moves the states marker. |
| `test/cli/wait-every-state.test.ts` | Counting tests unchanged in substance: a quiet poll reads nothing, and a write is found on the next poll with the same news and quiet as a full read. "Reads every time with no triggers, once they are dropped, or with no marker row" replaces the daemon-claim case. Counting now wraps the store in place, so the reader keeps the store's connection. |
| `test/cli/stored-closures.test.ts`, `test/cli/named-wait-closures.test.ts` | The marker is set when the triggers are made, and moves on each transfer-import write and on a removal. A store with no triggers lists every time. The kept selection equals a full read after each closure write and key move. The named wait lists again only on the poll after a write. |

### Checks

- `pnpm run lint`: `Checked 3430 files`, no fixes. `pnpm run typecheck`: clean.
- `test/keys/key-format.test.ts` passes with no raise (Squeal, revision 53). The repositories, `ledger.ts`, `revision.ts` and `transfer-rows.ts` are back to `5e8dcc223`. `write-markers.ts` is imported only by `daemon.ts` and the waits, which are off the validity path.
- Run directly while Squeal had them queued (`env -u PLUGIN_ROOT -u PLUGIN_DATA pnpm exec vitest run <paths>`). Six focused files: 35 of 36 passed; the failing one counted the full read's list after counting moved in place, and was fixed in the test. Then `write-markers`, `stored-closures` and the daemon test: 17 of 17 passed.

### Cost of the triggers

A fresh private store, `knownStates.upsertMany` of 30,000 states that replace 30,000 existing ones (the daemon's usual write) in one transaction. CPU of the upsert, 6 runs each, alternating order. `nice 10`. Host load average 33 to 37 on 24 vCPUs, the host's real load from parallel coordinators.

| Store | ms CPU per 30,000-row upsert, sorted | Median |
|---|---|---|
| Without triggers | 265, 317, 317, 325, 347, 351 | 325 |
| With triggers | 337, 342, 380, 384, 408, 455 | 384 |

About 59 ms, 18%, per 30,000 rows: one `meta` upsert per row written. At this load the spread is wide, so the figure is a size, not a precise ratio. A daemon's usual commit writes far fewer rows. The fallback wait's read side is unchanged from the first round: median 486 ms before, 98 ms after (section above); the trust check is now one `sqlite_master` read in place of the worktree scan.

### Calls the review did not settle

1. Who makes the triggers: the daemon of this release, at registration. Readers never write. A store whose daemons are all older releases keeps full reads.
2. Trust checks trigger names, not bodies. A changed body takes a new name.
3. A missing marker row is untrusted, not "no write". This covers a removed worktree, and a worktree that has had no write since the triggers were made (it has no rows, so a full read is cheap).
4. An older release's `WorktreeRepo.remove` does not know `states-marker.<id>`. When an older release removes a worktree, it leaves that one small `meta` row. The triggers have moved it, so no reader trusts stale rows from it.
