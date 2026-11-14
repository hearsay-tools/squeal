# Progress records: each of the daemon's progress records has one owner beside its writer

This is the design brief from the architecture review of 2026-11-12, report card 4. Sources: main at `6eb3c3a0a`, rechecked at `cda899453` on 2026-11-14; Cezar task af6c0b3f, report artifact d8b46fe2. The design session is task 6f1379b9.

- Terms are in `GLOSSARY.md`: Progress record, Refined revision.
- The decisions below are the human's, taken on 2026-11-14.
- Row 011-339, approved by the human on 2026-11-14 ("Approve, land, start").

## Problem

The daemon keeps six small records per worktree that say how far it has got. Spec 001 D2, D5 and D6 and task 001-406 define them.

| Record | What it says | Writers | Readers (source files, at `cda899453`) |
|---|---|---|---|
| refined revision | the newest revision whose runner part the daemon applied | `scheduler/ledger.ts` (commit), `scheduler/refine-apply.ts` (after a failed refinement) | `state/header.ts`, `delivery/edits.ts`, `scheduler/bootstrap.ts`, `scheduler/rekeyed-moves.ts` |
| install wait, with its command | the worktree waits for a package install, and the command that ends it | `scheduler/install.ts` | `state/header.ts`, `cli/wait/progress.ts` |
| checkpoint progress | a full-suite checkpoint is open, and how far it is | `scheduler/checkpoints.ts` | `cli/wait/progress.ts`, `cli/warmup.ts`, `status/snapshot.ts`, `checkpoints.ts` itself |
| head move | HEAD moved with no file change | `scheduler/head-move.ts` | `state/revision-commit.ts`, `code/pass/source.ts`, `head-move.ts` itself |
| bootstrap marker | the daemon's start scan is done | `daemon/daemon.ts` | `cli/retry-unlisted.ts`, `delivery/registered.ts` |
| notes | the worktree's persisted notes | `daemon/notes.ts` | `core/notes.ts` |

Their key builders and parsers sit in `types/scheduler.ts` and `types/daemon.ts`. The registry `WORKTREE_META_ROWS` names those types files as the owners. Of its 63 per-worktree rows, the other 57 are owned by the module that writes them.

**Why the reads were copied.** The types file gives only a record's key, with no read or write. Each piece of code that needed a value wrote its own. The refined revision is read by hand 4 times, each in the shape its reader needed:

| First written | Reader | Shape | A missing record becomes |
|---|---|---|---|
| 2026-10-06 `4cd3979eb` | header | is the runner part pending | `null`, so not pending |
| 2026-10-08 `5ccb6d4ab` | start scan | where the re-scan starts | the latest revision, so nothing to re-scan ("as the header reads it": a copy) |
| 2026-10-10 `86a80df3d` | edit notes in a delivery | a number to compare | +Infinity, so every revision is refined |
| 2026-10-11 `9d070a223` | re-key moves | is it caught up | `null`, so caught up |

All four mean the same: with no refined revision recorded, no revision counts as pending. The card said they mean three different things; read in source code, they do not. No new copy has been written since 2026-10-11. The other records already have one shared parser each, which every reader uses.

The two writers of the refined revision record two events: the runner part was applied (the ledger's commit, in the transaction that applies it), and a refinement failed and counts as refined so no wait hangs (since 2026-11-11, `12fb9ac35`). The ledger sets the value; the failure path only raises it. Refinements run one revision after the next, so the value never goes down today (read in source code, not run).

### What the history shows

Counted on 2026-11-14 at `cda899453`.

- **Review blockers since 2026-11-04:** 0 of 174 blocker headings in the review files added since then concern these records.
- **Fix commits since 2026-10-20 that changed a line naming these keys or parsers:** 17 commits, 4 of them fixes (`16e27c590`, `4683a0106`, `544860ee1`, `f55dfbb17`). About 2 have the shape "a fact reached some readers and not others": `16e27c590` (a group wait's deadline did not name the install wait the header named) and `4683a0106` (review 0.1.315 B2: the code pass read the refined revision where it needed the listing). The card's 97 commits and 28 fixes counted every change to the readers' whole files.
- **Tests:** 43 test files write these records raw, with 53 raw writes of the refined revision; 11 raw reads.

These are small counts. The case for the row is the cause, not the defect rate: with no owner, the next reader writes its own read again.

## Decisions (the human, 2026-11-14)

1. **Go on, as a small move ("2: Small move").** The human first asked why one value is read four ways and written in two places. The answer above (no owner offers a read or a write) decided it.
   - Each record gets one owner beside its writer: its key, its format, what a missing or unreadable value means, one read per question and one write per event. This is the pattern the other 57 records follow, and row 014-41's "each value decoder beside its writer".
   - Behaviour preserved. Nothing a user sees changes.
   - Rejected:
     - Stop and record the recount. It leaves the cause in place.
     - The review's proposal: one module for all six records, events in, answers out, one table test as daemon presence has. It buys nothing more than the small move for these six records, at more test rewriting.

## Agreed with sibling designs

- **Card 5 (tier admission, task b711eb60), 2026-11-14, request d9d42130.**
  - Card 4 owns the stored install wait and its command: their keys, format and what a missing value means. `install.ts` keeps deciding when the wait starts and ends, and calls the owner's writes.
  - The scheduler's memory flags (`#awaitingInstall`, `#reinstalled`) stay in `scheduler.ts`. Card 5's admission reads them there, not the stored record.
  - Card 2's request intake keeps its own install-wait answer for requests.
  - No row of card 4 touches `scheduler.ts`, `slow-tier.ts` or `record.ts`.
- **Card 3 (waits).** Its file `src/cli/wait/progress.ts` reads the checkpoint progress and the install wait "through today's parsers, with no meaning added; card 4 replaces these reads and nothing else". Row 011-339 replaces those reads with the owners' reads. The file's own interface (`openCheckpoint`, `installWait`, `InstallHold`) stays.
- **Card 2 (request intake).** Its covered-files record writes none of these rows.

## Coordinator's calls (repo-local; the human may overturn)

- **Location: beside the writer, in a small file.** Each owner is a file in its writer's folder whose imports are only `types/` and the store's types, so the hook bundles that read the header do not take in scheduler code. Proposed names; the worker may change them and says so in its notes:
  - `src/core/scheduler/refined.ts`: the refined revision;
  - `src/core/scheduler/install-wait.ts`: the install wait and its command;
  - `src/core/scheduler/checkpoint-progress.ts`: the checkpoint progress (the `CheckpointProgress` and `OwedCheckpoint` types may stay in `types/`, which others import);
  - `src/core/scheduler/head-move-record.ts`: the head move (`head-move.ts` imports commit and git code, which the header must not load);
  - `src/core/daemon/bootstrapped.ts`: the bootstrap marker;
  - the notes key moves into `src/core/notes.ts`, which already reads and writes them.
  - `types/` keeps types only. The `WORKTREE_META_ROWS` entries name the new owners.
- **Interface.** Per record, one read per question its readers ask and one write per event. The key builder is not exported. For the refined revision:
  - one read, which states once that with none recorded no revision is pending, and a question form ("is revision N refined") the four readers use in place of their own conversions;
  - two writes: "applied" (sets, as the ledger does) and "failed, count it refined" (raises only, as the failure path does).
  For the bootstrap marker, its two readers ask two questions: when the last start scan ended (`retry-unlisted.ts`), and whether the live daemon finished its scan (`registered.ts`). Both become owner reads.
- **Write ordering is unchanged.** An owner never opens a transaction of its own. Each write runs at today's call site, inside the caller's transaction where there is one: the ledger's commit, the failure path's transaction in `refine-apply.ts`, `startWaiting`'s transaction, the daemon's start-scan write. Each read runs at today's point in its reader, so a reader sees a value neither earlier nor later than now. The header reads the install command only while the install is awaited, as today.
- **Differences kept, and named in the notes.** The move changes no rule. It keeps:
  - the two refined-revision write rules (set and raise);
  - the head move's two readings: the code pass takes a move at exactly revision N, the header and `head-move.ts` take one at N or later. The worker says whether that difference is deliberate; if not, it becomes a proposed row.
- **Tests: replace, don't layer.**
  - **New:** one table test at the owners' interface (`test/scheduler/progress-records.test.ts`): for each record, writes in, reads out, over `freshStore()`, with a missing value, an unreadable value and, for the refined revision, a lower value after a higher one under each write.
  - **Deleted:** the parser-only cases now in `test/scheduler/checkpoint-tracker.test.ts`, `test/scheduler/install-wait.test.ts` and the other files that call `parseCheckpointProgress`, `parseAwaitingInstall`, `parseHeadMove` or `awaitingInstallValue` directly, once the table covers them. The worker names each.
  - **Changed by rote:** the 43 test files that write these records raw stage them through the owners' writes. The 11 raw reads go through the owners' reads. Their cases and assertions stay.
  - **Stay:** every reader's own behaviour tests (header, delivery, waits, status, retry, code pass) and the real-daemon tests.
- **Key format.** Moving code inside `src/core/scheduler` may touch the sources `test/keys/key-format.test.ts` hashes. The coordinator runs it with the gate. A changed hash with no changed validity output is a pin, not a raise (row 011-41).

## Not in scope

- **Any change to a rule.** The differences above are kept. A change is a row of its own.
- **The scheduler's in-memory install and reinstall flags and tier admission.** Card 5's.
- **The meaning of the records in the specs.** Spec 001 D2, D5 and D6 are unchanged.
- **The listing record (`listingMetaKey`) and the other 57 rows.** They already have owners.
- **Daemon presence** (`research/daemon-presence.md`). The bootstrap marker is a progress record, not a presence event: it says the start scan is done, not whether a daemon runs.

## Rows (spec 011; approved by the human, 2026-11-14, "Approve, land, start")

1. **011-339 Each daemon progress record has one owner beside its writer, behaviour preserved.**
   - Decision 1 and the coordinator's calls.
   - The refined revision, the install wait with its command, the checkpoint progress, the head move, the bootstrap marker and the notes key each move out of `types/` into one owner beside their writer. Every reader and writer goes through the owner.
   - Done when:
     - no file outside an owner names one of these keys, reads or writes one of these rows, or parses one of their values; `types/` holds no key builder or parser for them;
     - the `WORKTREE_META_ROWS` entries name the owners;
     - every write runs at today's call site and in today's transaction, and every read at today's point; the notes name each call site moved;
     - the table test covers every record's writes and reads, with missing and unreadable values and both refined-revision write rules;
     - the parser-only test cases it replaces are deleted and named in the notes; the test files that staged rows raw use the owners;
     - every output, line, exit code and status payload is as before; the existing tests pass, less the replaced cases;
     - the hook bundles are rebuilt with no new scheduler import.

## Process

This is product code in `src/`. A coordinator for spec 011 runs row 011-339 with one worker, Claude Opus at medium effort: the move is wide but mechanical. Its candidate needs a passing review before main (`docs/process.md` steps 5 and 6).

- **Order.** Card 5's first move row edits `scheduler.ts` (the pump and `#hasWork`), `slow-tier.ts` and `record.ts` (its message of 2026-11-14 to this session); row 011-339 edits none of them. So 011-339 may start before card 5's row lands. The two coordinators compare file lists before each dispatch; a file both rows edit goes to whichever lands second, which rebases.
- **Shared files.**
  - `src/cli/wait/progress.ts` belongs to card 3's wait module (coordinator cdd216e5). Row 011-339 changes only its reads.
  - `src/core/scheduler/install.ts`, `ledger.ts`, `bootstrap.ts`, `refine-apply.ts`, `checkpoints.ts`, `head-move.ts` and `rekeyed-moves.ts`: card 5's coordinator is told before dispatch.
  - `src/core/state/header.ts` is read by the status waits that coordinator cdd216e5 runs (rows 011-44, 011-45, 011-49); this row changes only its record reads.
