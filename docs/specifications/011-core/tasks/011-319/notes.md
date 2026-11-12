# Row 011-319: one run evidence module, behaviour preserved

Worker 65662af4, wave 76 W1 and repair W1-R1 (wave 76.5), 2026-11-12. Briefs: `../wave-76.md` W1, `../wave-76.5.md` W1-R1. Design: `../../research/run-evidence.md`. Review: `../../reviews/0.1.452.md`.

## The module

`src/core/run-evidence/run-evidence.ts` is the entry file: every caller imports from it. Beside it, `sources.ts` (where the evidence is read from) and `reason.ts` (the reason texts) are imported by the entry alone. No barrel, no re-export.

| Export | What it does | Who calls it |
|---|---|---|
| `copyInputs` | Copies the input state before a run (`snapshotInputs`) | `newTier` (`startTier`'s snapshot), `Expectations.add` |
| `unstableInputs` | A tier's changed and touched inputs since the copy, listings left out (moved here from `tiers.ts`) | `TierRecords.#ended`, `#focused` |
| `stillAsRead` | The files whose inputs still hold the bytes the run read (D17.5) | `Keeper.flush` and `#write` (was `steadyOf`) |
| `readRecordEvidence` | The daemon's evidence: `rekeyEnvironments`, `prepareObserved` (`observedGrowth`), the observed reads' snapshot and change check (`observedMoves`), `scratchUnstable`, the touched union, `heldFiles`, in that order | `TierRecords.#prepare` |
| `mergeHeld` | `heldFiles` over a run's files | `readRecordEvidence`, `TierRecords.#heldNow` |
| `recordOutcome` | The report and the requeue a record hands `recordTier`: the barrier over the files the hold leaves free, a startup failure the hold rejects, and the requeue from first withholds, held, unfinished, not-started and interrupted files and a moved install | `TierRecords.#write`, `keepDecisions`, the table |
| `runEnd` | The `TierEnd` (`tierEnd`) | `recordTier`, `keepDecisions`, the table |
| `decisionOf` | `storeDecision` for one file, as `recordFile` takes it, with its reason | `keepDecisions`, the table |
| `keepDecisions` | The keeper's evidence (`readKeepEvidence`), `recordOutcome` with the keeper's facts, `runEnd`, `decisionOf` | `Keeper.#keepable`, the table |
| `keeps` | `squeal code` keeps only on "store at the key it ran under" | `Keeper.#keepable`, the table |

In `sources.ts`: `movedInputs` (`changedSince` without listings), `observedMoves` (the observed reads' listing filter, snapshot and change check, moved from `prepareObserved`), `readKeepEvidence`.

## One decision path (review B1)

`TierRecords.#write` takes its report and requeue from `recordOutcome`, inside its transaction, after `interruptedFiles`. It supplies its own facts at this try: the held files (`#heldNow`), whether the hold rejects the startup failure, `Withholds.peek` as the split of the barred files, the unfinished, not-started and interrupted files, and the moved install. `Withholds`, its counting and its notes (`#counted`, once the write lands), the lock, the transaction and `recordTier` stay in `record.ts`. `recordTier` builds its `TierEnd` through `runEnd`, and `recordFile` (`record-tier.ts`, not touched) calls `storeDecision`.

The keeper and the table's daemon column call the same `recordOutcome`, then `runEnd`, then `storeDecision` per file through `decisionOf`, as `recordTier` and `recordFile` do. No other composition is left: `decideFiles` and `touchBarrier` are gone. The keeper's facts (`KEEP_FACTS`): no held file, no retry (every barred file is exhausted, so it is not completed and not kept), nothing unfinished, not started or interrupted, no moved install.

A merge hold and a touched input are evidence, not decision kinds. The decision is the final `StoreDecision`; the reason beside it names the evidence. A held file is `requeue` with the reason "a merge holds a path its key names". A first touch at the file's key is `requeue`, an exhausted one is `unknown`, each with the reason naming the touched paths; the keeper's touched file is `unknown`.

## The daemon's evidence entry re-keys

`readRecordEvidence` calls `rekeyEnvironments` whole, at the same point under the scheduler lock as before (accepted by the coordinator, wave 76.5). So the daemon's evidence entry does not only read: it re-keys the environments, after `seeStartup` writes the keys, before the observed reads are read. Splitting it would change what `busy-withhold.test.ts` counts (one `rekeyEnvironments` call per prepared record, with the report). The keeper's evidence never calls it.

## What the key alarm no longer sees

The alarm's global entries (`test/keys/validity/entries/global.ts`) bundle `observed.ts`, `stability.ts` and `store-decision.ts`, among others. Bundled with a metafile at this branch: `record.ts`, `tiers.ts` and `record-tier.ts` are not in that bundle, and neither is any file of `src/core/run-evidence/`.

- Before this row, the record's evidence lines under the alarm were `prepareObserved`'s, in `observed.ts` (lines 220 to 226 at `47763ba72`): the size check, the listing filter over the observed reads (four lines), the snapshot (`snapshotInputs`) and the change check (`changedSince`). The rest of the record's evidence and its composition (`record.ts`, `tiers.ts`) never were under the alarm.
- After R1 B2, those seven lines are `observedMoves` in `src/core/run-evidence/sources.ts` (lines 48 to 54), outside the bundle. `prepareObserved` is one line calling `observedGrowth`. The helpers they call, `snapshotInputs` and `changedSince` in `stability.ts`, stay in the bundle, and so do `barredByTouch`, `tierEnd` and `storeDecision`.
- The move passed the alarm with no raise once the assemble harness ran `prepareObserved` (commit `07edbe2e9`, accepted by the coordinator): the alarm holds each changed line of a bundled file to a case at the side that has it, the old body at the last release and the thin one at the candidate.
- The coordinator proposes a later row to make the run evidence module an alarm entry.

## Behaviour preserved

- The daemon makes the same calls in the same order with the same arguments. In `#write`, the barrier and `Withholds.peek` now run inside the transaction, after `interruptedFiles`; both are pure, and the counting still happens only once the write lands. `busy-withhold.test.ts` mocks `rekeyEnvironments` and `prepareObserved` in their own modules and counts one call per prepared record.
- The keeper keeps what it kept: `observedGrowth`, then `changedSince` over the candidates' paths, then the environment files its project's keys lack, and it keeps only on "store at the key it ran under". A touched input bars the file in `recordOutcome` (`barredByTouch`), where the old filter dropped it itself.
- One small change, with no effect: the keeper's `changedSince` no longer receives listing paths (`dir/`), as the daemon's never did (review 0.1.452, check 1, proven).
- `store-decision.ts`, `stability.ts`, `record-tier.ts`, `keep-write.ts`, `keep-sent.ts` and `keep-here.ts` are unchanged. `observed.ts` changes only `prepareObserved`.

## The table

`test/run-evidence/table.test.ts` with `fixture.ts`: a temporary git tree and a scratch store, real `WorktreeKeys`, no runner (its `environment()` rejects) and no daemon. Each row is one fresh tree. `test/a.test.ts` is the file the row is about; `test/b.test.ts` runs beside it and keeps its own decision in every row. 27 rows. The daemon's column runs `unstableInputs`, `readRecordEvidence`, `recordOutcome` with a real `Withholds`, `runEnd` and `storeDecision` per file. The keeper's column runs `keepDecisions`. Every `StoreDecision` kind appears, a first touch (`requeue`) and an exhausted one (`unknown`), one row for each record fact (unfinished, interrupted, a startup the hold rejects, a moved install), the research's four differences, and a revision during the run that moves a listed directory and no input's bytes (review check 5, item 4). The fixture adds a batch's paths to `Tier.changes` as `applyBatch` does, with the listings of an add or delete.

## A fifth difference the research did not list

The revision-only row shows it: a file added to a directory a test file lists, during the run, makes the daemon decide `unstable` for that listing (`Tier.changes`). `squeal code` keeps the file, because it reads no revisions and its stability check leaves listings out (they never produced a change in `changedSince` either). This is today's keeper behaviour, unchanged by this row. The kept result sits at the key the lookup computed before the run, with the listing as it was then, while the run may have listed the new entry. Row 011-320 or a later row decides it.

## Deleted cases, each mapped to its replacement

| Deleted | Replacement |
|---|---|
| `test/code/gate/keep.test.ts` "writes nothing of a file that did not complete" | Row "the run did not complete it" |
| `keep.test.ts` "writes nothing of a file whose run loaded an environment file its keys lack" | Rows "it loaded an environment file its key lacks", "it loaded only environment files its key names" |
| `keep.test.ts` stub members `observes` and `environmentFiles` | Only the two cases above used them |
| `test/cli/code-gate-keep-touched.test.ts` "keeps the steady file and nothing at the key of the one put back" | Rows "an input was touched, the first time at its key" and its exhausted twin, and `b` in every row |
| `code-gate-keep-touched.test.ts` "is not read as current by a daemon started afterwards" | The touched rows prove only that the file is not kept. A daemon reading a kept file stays in `code-gate-keep.test.ts` |
| `code-gate-keep-touched.test.ts` "runs the file again on the same bytes, and it fails at them" | The touched rows prove only that the file is not kept. The next run reading a kept file stays in `code-gate-keep.test.ts` |
| `test/cli/code-gate-keep-observed.test.ts` "does not keep a run that read a path its key lacks" | Row "difference 1: it read a path its key lacks, known before the run" |
| `code-gate-keep-observed.test.ts` "keeps the run once a daemon observed the read, at the key that daemon gives" | Row "it read a path its key names" proves the decision; the acquisition of the daemon's observed set and the later daemon read are in the restored case below |
| `code-gate-keep-observed.test.ts` "reads the kept result neither in the gate nor in a daemon once the read file changed" | Restored (review S1): `test/cli/code-gate-keep.test.ts`, "squeal code --base, a kept result whose observed read changed is read neither by the gate nor by a daemon". It keeps the file once a daemon observed the read, then changes the read file |
| `code-gate-keep-observed.test.ts` "keeps the steady file and not the one that rewrote its source" | Row "an input changed", and `b` in every row |

## Cases the design listed that stay

- `keep.test.ts` keeps its cases that are not run evidence: a file with no record, nothing written until `flush`, a failure told once, each lookup of one runner kind apart (review 0.1.433 B2), a runner it was not told of. Its stub keeps `cache`, `stabilityPaths`, `beginRun` and `endRun`, which `Expectations` and the queue use.
- `test/cli/code-gate-keep.test.ts` keeps its cases. Its first case keeps the quick file that the next-run and daemon cases read, which the design keeps. Its other cases are lookups (a changed byte, a record without results) or the write under a daemon's lock; the table covers no lookup and no write (review 0.1.452, check 5, item 3: justified).

## Scheduler tests the table repeats, not deleted

- `test/scheduler/barrier.test.ts`: "withholds only the files whose inputs name a touched path" (the touched rows and `b`), "withholds a file whose run read the touched path beyond its inputs" ("difference 1: a path it read beyond its key was touched"). Not repeated: "stores the whole run when no file's keys name a touched path" (the module reads touches only of inputs and reads).
- `test/scheduler/withheld-touch.test.ts`: the decision of its first case ("the runner withheld it"). The counting and the re-queue are the daemon's action; not repeated.
- `test/scheduler/observed-growth.test.ts`: the decision of "stores a run's result only under the key whose environment holds the preload path it observed" (the two environment rows). The other cases are keying across worktrees; not repeated.
- `test/scheduler/touched.test.ts`: none. It covers the watcher's touch batches, not the record.
- `test/scheduler/withheld-retry.test.ts`: the decisions of "runs once more when no revision follows the touch" (the first-touch row, `requeue`) and "is unknown with one note naming the path when it is touched on every run" (the exhausted row, `unknown`). The runs, the notes and the counting across tiers are the daemon's; not repeated. `withholds.test.ts` tests `Withholds.peek` itself, which the table only uses.

## Repair R1 (review 0.1.452), one commit per item

| Item | Commit |
|---|---|
| 1, B1: one decision path (`recordOutcome`, `decisionOf`; `decideFiles` and `touchBarrier` gone; held and touched as reasons; first and exhausted touch rows, one row per record fact) | `a254e45ce` |
| 2, B2: the observed reads' snapshot and change check in the module; `prepareObserved` thin | `d64c7a91f` |
| 2, the key alarm's assemble harness runs `prepareObserved` at both trees (accepted by the coordinator; this repair only) | `07edbe2e9` |
| 3, S1: the restored observed-read lookup case | `932b7e184` |
| 4, check 5 item 4: the revision-only row | `3c95278b2` |
| 5, these notes | the commit after `3c95278b2` |

## Checks (R1)

- Grep over `src`: no call of `snapshotInputs`, `changedSince`, `barredByTouch` or `prepareObserved` outside `src/core/run-evidence/`; their definitions stay in `stability.ts` and `observed.ts`, and `prepareObserved` calls neither helper. `observed.ts` imports nothing of the module. `git diff 47763ba72 -- src/core/scheduler/store-decision.ts` is empty.
- `squeal status --wait`: the table, `keep.test.ts`, `code-gate-keep.test.ts`, the record path's scheduler tests (`busy-withhold`, `withheld-touch`, `withheld-retry`, `withholds`, `busy-merge`, `busy-record`, `merge-hold-setup`, `merge-hold-records`, `merge-hold`, `held-setups`, `stopping-crash`, `reinstall`, `command-hold`, `barrier`, `touched`, `observed-growth`), `test/keys/key-format.test.ts` and `test/keys/validity/` pass. Later results are in the worker's final message.
- `test/daemon/drain-wait.test.ts` failed once at load 0.82 per CPU (the daemon still ran after 120 s while another daemon held the slow slot) and passed on `squeal retry --reason load` at the same inputs.
- `pnpm run lint` and `pnpm run typecheck` pass.
- The four bundle tests (`test/harness/plugin.test.ts`, `opencode/package.test.ts`, `pi/package.test.ts`, `codex/packaging/runtime.test.ts`) fail on `cli/squeal.mjs differs from the build`: `plugins/*/dist` is the coordinator's.
