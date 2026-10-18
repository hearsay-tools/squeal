# 004-69 notes: the baseline beside an owed forced checkpoint

Worker notes for the restart residual (`../../reviews/wave-8.1.md` "Restart residual").

## Seam

- `bootstrap.ts` `baseline` now takes the owed checkpoint (`Checkpoints.takeOwed`) before it starts its own, and adds the owed request's strict files (`owedStrict` in `checkpoint-requests.ts`: still listed, keyed, forced) to the baseline's files. A lookup hit is no forced run, so the baseline cannot complete at start; it ends when the forced runs give results attributed to it, or abandoned when the slow tier's skip fails them (`slow-skip.ts` calls `checkpoints.failed`).
- `resumeOwed(ledger, owed)` takes what the baseline took; it still joins the owed records to the open baseline and queues the strict files forced. With `baseline.onStart: "lookup-only"` the baseline is abandoned at once and the owed checkpoint becomes the open one, as before.

## Behaviour change

The owed forced files' runs now carry the next daemon's baseline id, not the owed record's, also when the baseline had nothing else to run. Before, an otherwise empty baseline completed at once and the owed record became the open checkpoint. `test/scheduler/checkpoint-resume.test.ts` "a forced run --all whose daemon stops mid-way" now asserts that; its sibling "ends with the next daemon's baseline" already expected baseline attribution. The baseline record lists those files, so status shows the baseline running until they end.

This applies to every owed strict file, slow or fast: a forced fast file also holds the baseline until it runs. That is the same honesty rule (a full suite that waits for the forced runs it owes), and no test asserted otherwise.

## Regressions

`test/slow/precondition-owed.test.ts`: the review's no-rollback sequence (close while the command waits, the next daemon's command exits 1), its R2-rollback variant, and the met-rule control. The first two were red on 0.1.214 at `fullSuite.atCurrentRevision`.
