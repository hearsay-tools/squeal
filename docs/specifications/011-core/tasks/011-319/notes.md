# Row 011-319: one run evidence module, behaviour preserved

Worker 65662af4, wave 76 W1, 2026-11-12. Brief: `../wave-76.md` W1. Design: `../../research/run-evidence.md`.

## The module

`src/core/run-evidence/run-evidence.ts` is the entry file. `reason.ts` beside it holds the reason texts, and only the entry imports it. No barrel.

| Export | What it does | Who calls it |
|---|---|---|
| `copyInputs` | Copies the input state before a run (`snapshotInputs`) | `newTier` (`startTier`'s snapshot), `Expectations.add` |
| `movedInputs` | Changed and touched inputs since the copy (`changedSince`), listings left out | `unstableInputs`, `stillAsRead`, the keeper's evidence |
| `unstableInputs` | A tier's `movedInputs` (moved here from `tiers.ts`) | `TierRecords.#ended`, `#focused` |
| `stillAsRead` | The files whose inputs still hold the bytes the run read (D17.5) | `Keeper.flush` and `#write` (was `steadyOf`) |
| `readRecordEvidence` | The daemon's evidence: `rekeyEnvironments`, `prepareObserved`, `scratchUnstable`, the touched union, `heldFiles`, in that order | `TierRecords.#prepare` |
| `mergeHeld` | `heldFiles` over a run's files | `readRecordEvidence`, `TierRecords.#heldNow` |
| `touchBarrier` | The completion barrier (`barredByTouch`) | `TierRecords.#barrier`, `decideFiles` |
| `runEnd` | The `TierEnd` (`tierEnd`) | `recordTier`, `decideFiles` |
| `decideFiles` | Each file's decision and reason: `held`, `touched`, else `storeDecision` | `keepDecisions`, the table |
| `keepDecisions` | The keeper's evidence (observed growth, moved inputs, environment files its keys lack) and decisions | `Keeper.#keepable`, the table |
| `keeps` | `squeal code` keeps only on "store at the key it ran under" | `Keeper.#keepable`, the table |

`RunDecision` is `StoreDecision` plus two kinds the caller acts on before `storeDecision`: `held` (a merge holds a path the key names) and `touched` (withheld for these paths). The daemon still acts on them as before: `held` files and first withholds queue again through `requeue`, and `Withholds` stays in `record.ts`.

The daemon's per-file decision is still `storeDecision` in `recordFile` (`record-tier.ts`, not touched). It reads the `TierEnd` that `runEnd` builds. `decideFiles` composes the same steps in the daemon's order (hold, barrier over the free files, `runEnd`, `storeDecision`), so the table's daemon column reads what `record.ts` decides.

## Behaviour preserved

- The daemon makes the same calls in the same order with the same arguments. `test/scheduler/busy-withhold.test.ts` mocks `rekeyEnvironments` and `prepareObserved` in their own modules and counts their calls; the module imports them from there, so the mocks still see one call per prepared record.
- The keeper reads what it read before: `observedGrowth`, then `changedSince` over the candidates' paths, then the environment files its project's keys lack. The decision then goes through `storeDecision`. The candidates are completed files, held at the key they ran under, with no requeue, no cancel and no runtime identity. For them `storeDecision` is "store at the key it ran under" exactly when the old filter kept the file: no growth, no environment file beyond the keys, no changed input. A touched input is now `touched` from `barredByTouch`, where the old filter dropped the file itself; the files kept are the same.
- One small change, with no effect: the keeper's `changedSince` no longer receives listing paths (`dir/`), as the daemon's never did. `hasher.stat` of a directory is `null`, and the stat cache holds no entry for a listing path, so `changedSince` reports nothing for one in either case.
- `store-decision.ts`, `stability.ts`, `observed.ts`, `record-tier.ts`, `keep-write.ts`, `keep-sent.ts` and `keep-here.ts` are unchanged.

## The table

`test/run-evidence/table.test.ts` with `fixture.ts`: a temporary git tree and a scratch store, real `WorktreeKeys`, no runner (its `environment()` rejects) and no daemon. Each row is one fresh tree. `test/a.test.ts` is the file the row is about; `test/b.test.ts` runs beside it and keeps its own decision in every row. 23 rows: every `StoreDecision` kind, `held` and `touched`, for both columns, with the four differences of the research as named rows. The keeper's column of differences 2 to 4 is "store at ran"; row 011-320 changes those three expectations.

## Deleted cases, each mapped to its table row

| Deleted | Table row |
|---|---|
| `test/code/gate/keep.test.ts` "writes nothing of a file that did not complete" | "the run did not complete it" |
| `keep.test.ts` "writes nothing of a file whose run loaded an environment file its keys lack" | "it loaded an environment file its key lacks", "it loaded only environment files its key names" |
| `keep.test.ts` stub members `observes` and `environmentFiles` | Only the two cases above used them |
| `test/cli/code-gate-keep-touched.test.ts` "keeps the steady file and nothing at the key of the one put back" | "an input was touched", and `b` in every row |
| `code-gate-keep-touched.test.ts` "is not read as current by a daemon started afterwards" | "an input was touched" (not kept). A daemon reading a kept file stays in `code-gate-keep.test.ts` |
| `code-gate-keep-touched.test.ts` "runs the file again on the same bytes, and it fails at them" | "an input was touched" (not kept). The next run reading a kept file stays in `code-gate-keep.test.ts` |
| `test/cli/code-gate-keep-observed.test.ts` "does not keep a run that read a path its key lacks" | "difference 1: it read a path its key lacks, known before the run" |
| `code-gate-keep-observed.test.ts` "keeps the run once a daemon observed the read, at the key that daemon gives" | "it read a path its key names" |
| `code-gate-keep-observed.test.ts` "reads the kept result neither in the gate nor in a daemon once the read file changed" | None: a changed observed read moves the key, which the key validity cases cover; the table covers no lookup |
| `code-gate-keep-observed.test.ts` "keeps the steady file and not the one that rewrote its source" | "an input changed", and `b` in every row |

## Cases the design listed that stay

- `keep.test.ts` keeps its cases that are not run evidence: a file with no record, nothing written until `flush`, a failure told once, each lookup of one runner kind apart (review 0.1.433 B2), a runner it was not told of. Its stub keeps `cache`, `stabilityPaths`, `beginRun` and `endRun`, which `Expectations` and the queue use.
- `test/cli/code-gate-keep.test.ts` is unchanged. Its first case keeps the quick file that the next-run and daemon cases read, which the design keeps. Its other cases are lookups (a changed byte, a record without results) or the write under a daemon's lock; the table covers no lookup and no write.

## Scheduler tests the table repeats, not deleted

- `test/scheduler/barrier.test.ts`: "withholds only the files whose inputs name a touched path" (rows "an input was touched" and `b`), "withholds a file whose run read the touched path beyond its inputs" ("difference 1: a path it read beyond its key was touched"). Not repeated: "stores the whole run when no file's keys name a touched path" (the module reads touches only of inputs and reads).
- `test/scheduler/withheld-touch.test.ts`: the decision of its first case ("the runner withheld it"). The counting and the re-queue are the daemon's action; not repeated.
- `test/scheduler/observed-growth.test.ts`: the decision of "stores a run's result only under the key whose environment holds the preload path it observed" (the two environment rows). The other cases are keying across worktrees; not repeated.
- `test/scheduler/touched.test.ts`: none. It covers the watcher's touch batches, not the record.

## Where the design's calls did not hold

- `prepareObserved` stays in `src/core/scheduler/observed.ts`, and it still calls `snapshotInputs` and `changedSince` over the observed reads. The module is its only caller. Moving its body into the module would break `test/scheduler/busy-withhold.test.ts`, which mocks it in `observed.js` and counts its calls, and the brief keeps the scheduler's tests unchanged. `observed.ts` is also a global entry of the key alarm. So no file outside the module calls `prepareObserved`, `barredByTouch`, `snapshotInputs` or `changedSince` to decide a store, except `prepareObserved`'s own body.
- The environment step is not split into a read and a re-key. `readRecordEvidence` calls `rekeyEnvironments` whole, at the same point under the scheduler lock as before, so the re-key still happens before `prepareObserved`. Splitting it would change what `busy-withhold.test.ts` counts (one `rekeyEnvironments` call per prepared record, with the report), and its first step, `seeStartup`, writes the keys before the read. The module therefore re-keys for the daemon; the keeper's evidence never calls it.
- "The per-lookup cases of `code-gate-keep.test.ts`" are not deleted (above).
- The revisions during a run (`Tier.changes`) have no row of their own: a content change during the run also moves the bytes, which `movedInputs` reads first. The scratch row reaches `Tier.changes` through a real revision.

## Checks

- `squeal status --wait`: the table, `keep.test.ts`, `barrier`, `touched`, `withheld-touch`, `observed-growth`, `busy-withhold`, `test/keys/key-format.test.ts` and the nine `test/keys/validity/*.test.ts` files pass. `git diff 47763ba72 -- src/core/scheduler/store-decision.ts` is empty.
- The keeper's CLI and daemon tests pass at the last commit: `code-gate-keep`, `code-gate-keep-node-test`, `code-gate-keep-busy`, `code-gate-keep-stop`, `code-gate-stored`, `keep-busy`, `keep-daemon`, `keep-daemon-lost`, `keep-daemon-wire`.
- Over the 841 test files the changed sources select: 823 pass, 2 fail (bundles, below; 2 more bundle files were queued again), 16 were still queued for CPU after three waits of 590 s (host at 15 to 16 of 24 cores in use).
- `pnpm run lint` and `pnpm run typecheck` pass.
- `test/harness/plugin.test.ts`, `test/harness/opencode/package.test.ts`, `test/harness/pi/package.test.ts` and `test/harness/codex/packaging/runtime.test.ts` fail with one error, `cli/squeal.mjs differs from the build`: the committed bundles differ from the build. `plugins/*/dist` is not this row's and the brief rules out `pnpm run build`; the coordinator rebuilds them.
