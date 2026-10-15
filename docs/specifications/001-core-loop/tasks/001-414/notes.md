# 001-414 notes: the idle waiter's CPU on a large shared store

Wave 15 W1. Commits: `6f78e9eb` (a turn that owes nothing reads no state), `be30518d` (an owed turn reads only its files).

## What each poll reads

The waiter (`src/harness/shared/waiter.ts`) waits in 1 s chunks. Each chunk checks that its consumer is registered: one `consumers` row. It then calls `HarnessDelivery.waitForDelta`, which polls `deliverIdle` every 250 ms (`DEFAULT_POLL_INTERVAL_MS`, `src/core/delivery/delivery.ts`).

- **Before this row**, `deliverIdle`:
  - Read the change marker (`PRAGMA data_version` and `total_changes()`, task 001-178).
  - When the marker was unchanged since the last empty poll, it returned at once.
  - Otherwise it ran `deliver(idle)`. Before deciding anything, that read:
    - every known state of the worktree (`knownStates.list`, 20,000 rows in the fixture);
    - the turn state and every test file key of the worktree;
    - the whole view (`views.list`, 20,000 rows);
    - all of them planned through `planDelta`.
- **Why 001-178 did not hold on cezar:** `data_version` moves on any other connection's commit. On a shared store, that includes every other daemon's heartbeat (one every 5 s per daemon), prune, reconcile, and every hook of every other session. With 13 daemons, the marker moved on most polls, so every poll paid the full read.

## Measurements (probe in `probe/`)

The fixture comes from `probe/build.ts` and `probe/inflate.mjs`:

- 202 MB store.
- 13 worktrees, each with 20,000 known states (260,000 in all) and 1,000 test files.
- 13,000 test file keys and 20,000 checks.
- About 600,000 rows of results history.

`probe/writer.ts` simulates 13 daemons on its own connection: each worktree gets a daemon record, and their heartbeats are staggered, 2.6 commits a second in all. `probe/measure.ts` registers one consumer in the main worktree and ends its turn. It then polls as the waiter does for 20 s and prints the process CPU (user plus system) over wall time. The host's load was 17 to 28 on 24 cores throughout, which is shared-host noise.

| Case | Before | After |
|---|---|---|
| Idle, owes nothing, no other writer | 1.1 to 1.4% | (unchanged path) |
| Idle, owes nothing, 13 heartbeating daemons | **35.3%** (6.6 s CPU in 20 s, about 130 ms per poll that saw a commit) | **0.21%** |
| Idle, owes 3 test files (60 checks), heartbeats | 41.6% | 0.56% |
| Idle, owes 100 test files (2,000 checks), heartbeats | (not run before) | 6.3% |

In the per-read profile on the fixture, one full listing of the worktree's states cost 84 ms. The scoped read of three files costs 0.2 ms once it goes through the `checks` index (see below). That was 3.6 to 4.7 ms with the first join form, which made SQLite scan the worktree's `known_states`.

## The fix

**A turn that owes nothing (`6f78e9eb`).** The idle delivery can deliver only what `waitedFor` accepts:

- the test files that were pending when the turn ended, at their recorded keys;
- while new test files are awaited, checks never told.

`trimmed` trims only those files. So `owedScope` (`src/core/delivery/turn.ts`) reads the turn state first.

- **In a turn, or idle with no file owed and no new file awaited:** the poll returns `null` after reading two rows, the consumer and the turn state, whatever else committed. This is the steady state of a long idle session, and the case cezar's two waiters were in after hours idle.
- **The answer is unchanged:** in both cases `select` gave `silent`, or an always-false filter with no trim.

**An owed turn (`be30518d`).** The precheck plans from these alone, and its answer is the one the whole worktree would give:

- the owed files' states, view entries and keys;
- while new files are awaited, the states with no view entry: `KnownStateRepo.untold`, an anti-join in SQL.

The reasoning:

- Every entry `waitedFor` accepts is either in an owed file, which is in both the scoped states and the scoped view, or one with `from === null`, which has no view entry and so is in `untold`.
- A retired entry in an owed file is still found, because its view entry is in the scoped view.
- `trimmed` looks only at owed files.

The precheck is unchanged in everything else. A delivery or a trim still runs the full transaction once, so the written text and view are exactly as before.

**Indexes.** `inTestFiles` (`src/core/store/codec.ts`) filters on `check_id IN (SELECT id FROM checks WHERE (project, test_path) IN (VALUES …))`. SQLite then searches `checks` by its unique index and `known_states` or `consumer_views` by primary key. `TestFileKeyRepo.list` filters `(project, path)` on its primary key.

## Type changes (additive)

- `KnownStateRepo.list(worktreeId, files?)` and `KnownStateRepo.untold(consumer)`.
- `ViewRepo.list(consumer, files?)`.
- `TestFileKeyRepo.list(worktreeId, files?)`.

## Tests

- `test/delivery/idle-cost.test.ts`:
  - A turn that owes nothing reads no known state over 240 polls, with another connection committing before each poll.
  - The same holds for a consumer in a turn.
- `test/delivery/idle-scope.test.ts`, 400 files of 15 checks:
  - An owed turn makes no unscoped listing and reads at most the owed file's rows per poll.
  - It still wakes for the owed file's result within one poll.
  - It stays silent for other files' results.
  - It stops owing a file whose result landed quiet, and then reads nothing.
  - A turn awaiting new files reads only untold states, and wakes for a new file's first failure.
- **CPU:** the read counts stand in for the 2% done-when, since a CPU percentage in the suite would fail on this shared host. The probe numbers above are the measurement.

## What remains

- **Cost still grows with what the turn owes, not with what changed.** A waiter that owes many files on a busy store reads them on every commit: 100 owed files cost 6.3% at 2.6 commits a second. When the daemon is running, results land and the owed set shrinks within a run. When the daemon is down with files pending (crashed, or rested by 001-415's unused stop while a file was queued), the turn owes them until the next prompt.
- **A further bound, if wanted:** a SQL difference precheck over the owed checks, compared with their view rows on outcome, fingerprint and presence, plus "every owed file is still pending at its key". It would answer "nothing" without decoding a row. Raw equality implies no entry, write or removal in `planDelta`. Not done, to keep `deliver`'s logic in one place.
- **Not covered here:** what `PreToolUse`, `PostToolBatch` and `Stop` read per boundary. They run once per tool call, not on a 250 ms timer.
- **Key pins:** the store sources are guarded, so `test/keys/key-format.test.ts` fails until the coordinator bumps and re-pins, as expected.
