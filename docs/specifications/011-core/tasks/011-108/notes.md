# 011-108: the run behind an UNKNOWN is recorded, and `why` names it, worker notes (2026-10-22)

Brief W1 of `../wave-14.md`, second commit, after 011-77. Sources: board row 011-108, `../../research/issue-74.md`, `docs/triage/2026-10-22-digest.md` group C, issue #74's four acceptance lines, 011 C6 and C7. The brief cites `triage/2026-10-22-digest.md`; the file is `docs/triage/2026-10-22-digest.md`, not under the spec folder.

## The choice the row left to the brief: a `meta` record

The brief did not choose between a store column and a `meta` record, so this row takes the `meta` record. A `known_states` column needs a schema migration, which makes every older release refuse the shared store (011-64 design section 4, consequence 4). The record is a new shared entry, `unknown-runs`, not a field of the per-worktree `unknown-files:` row (`src/core/scheduler/unknown-files.ts`): that row keeps an entry only while the writing daemon's ledger holds the file unknown (`file.unknownKey`), so a restarted daemon drops its predecessor's entries at its first write. It is also not a new `WORKTREE_META_ROWS` row, because that object is emitted code in `src/core/types/store.ts`.

## Seam map

- `src/core/store/repos/unknown-runs.ts` (new): one record per worktree and test file, the newest: worktree, test file, run id (`null` when no run produced the UNKNOWN), the revision the state was observed at, the reason, the time. 1,024 kept in all. A record fits a state when the state is `unknown`, its `observedAt` is the record's revision and its summary is the record's reason. `dropFallenUnknownRuns` drops each record whose state no longer stands, read in SQL from `known_states`. `keptByUnknownRuns` gives the runs prune keeps.
- `src/core/store/repos/failures.ts`: `store.failures.recordUnknownRuns` and `unknownRuns(worktreeId)`.
- `src/core/scheduler/ledger.ts`: `markUnknown` takes `runId` (default `null`) and keeps it in `#unknown`; `commit` writes the records in the same transaction as `sink.markUnknown`, at the same revision, so the record and the state agree. `discard` and `rerunFirstSeen` pass a run id on.
- `src/core/scheduler/tiers.ts`: the crash, timeout and not-started path at the end of `recordTier`, the two `discard`s and `rerunFirstSeen` pass `tier.runId`. A runner, install or environment failure (`failures.ts`, `install.ts`, `environment-growth.ts`) has no run: its record holds `null`.
- `src/core/store/prune.ts`: records whose UNKNOWN no longer stands are dropped first, then the runs `DELETE` keeps the runs the standing records name, past the cutoff too.
- `src/core/status/why-unknown.ts` (new): `unknownRunOf` gives `WhyReport.unknownRun` for an UNKNOWN state; `unknownRunLines` prints it in place of the `Run log: unknown, …` gap line.
- `src/core/status/why.ts`, `format-why.ts`: the wiring.

## Type changes (all additive)

- `src/core/types/store-records.ts`: `UnknownRun`, `MarkedUnknown`.
- `src/core/types/store.ts`: `FailureRepo.recordUnknownRuns`, `unknownRuns`.
- `src/core/types/status.ts`: `WhyReport.unknownRun?` and `WhyUnknownRun`: the one additive `why --json` field. `runLog` and `runLogUnavailable` keep their meaning.
- `src/core/types/state.ts` is unchanged: the run is not a field of `KnownState`.

## The issue's four tests

1. The run id and output are kept: `test/scheduler/unknown-run.test.ts`. Worktree B inherits A's PASS, then its own run of the file at a new key loses its worker (`Worker forks emitted error`). `why` in B names that run, B, the run's revision, the error and its `vitest.log`.
2. Also when newer results are only passes: in the same test A stores newer passes; B's `why` lists only passes and still names the run. `test/status/why-unknown-run.test.ts` seeds the same with another worktree's pass.
3. A missing log names one reason: `test/status/why-unknown-run.test.ts`. `pruned` (the run record is gone), `never-written` (the run wrote no log, or no run produced the UNKNOWN), `older-daemon` (no record fits the state; a record of an earlier UNKNOWN at another revision does not fit).
4. Across worktrees and a daemon restart: `test/scheduler/unknown-run.test.ts`. A's `why` names no run of B's. With B's daemon closed, `why` reads the record from the store; the restarted daemon ran the file again, lost its worker again, and `why` names that newer run. Prune at +8 days keeps the run and its log while the UNKNOWN stands; `test/status/why-unknown-run.test.ts` shows prune drops the record and the run once the state is a pass.

`test/keys/key-format.test.ts` passes through Squeal at revision 52 and in a direct `npx vitest run` (12 of 12): no key input changes, the alarm is silent. No result is stored for a crash: the tests assert the key holds no row.

## Spec text (drafts for the coordinator; spec text is not this row's)

- **011 C6**, after the `why <check>` sentences of the 011-64 amendment: "Amended 2026-10-22 (the human, gh-74, row 011-108): for an UNKNOWN known state, `why` names the run that produced it, its worktree, revision and log, also when every stored result of the check is a pass; `--json` gives it as `unknownRun`. When there is no log it names one reason: the run record was pruned, no log was ever written (no run produced the UNKNOWN, or its run wrote none), or a daemon older than row 011-108 recorded the UNKNOWN without its run."
- **011 C7**, appended to "Pruning": "Amended 2026-10-22 (row 011-108): the run behind an UNKNOWN known state is recorded beside the state, in the shared `meta` entry `unknown-runs`, never as a keyed result. While that UNKNOWN stands, prune keeps the run and its run log, past the cutoff too; once the state is no longer that UNKNOWN, prune drops the record, and the run follows the usual rule."

## Decisions the brief and the row did not settle

1. Prune keeps a standing UNKNOWN's run past the 7-day cutoff, as the row says ("while the UNKNOWN stands"). The bound is the 1,024 records, and one crashed tier's files share one run. An UNKNOWN that stands for a week is rare (an idle worktree, a lookup-only daemon), but its log then outlives the cutoff. If the coordinator wants the cutoff to hold, the change is one condition in `keptByUnknownRuns`.
2. The record matches the state by revision and reason, not by key. The ledger writes both in one commit at one revision, and `stateWithoutResult` keeps `observedAt` and the summary while the UNKNOWN stands, so a key move that leaves it UNKNOWN keeps the match.
3. The `why` text does not repeat the error on the `Run log:` line: the state's `Summary:` line above it holds it. `--json` carries it as `unknownRun.error`.
4. `older-daemon` is also what a record dropped by the 1,024 cap reads as. A cap that bites needs more than 1,024 files UNKNOWN at once across worktrees.

## Residue

- `src/core/scheduler/unknown-files.ts`'s `stands` filter drops a restarted daemon's predecessor's entries at its first write (seen while choosing the record; not changed, not this row's).
- The restarted daemon re-runs a file left UNKNOWN by its predecessor (`file.unknownKey` is not restored). Seen in the test; unchanged.
