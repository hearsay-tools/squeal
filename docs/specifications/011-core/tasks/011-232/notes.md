# 011-232: notes (wave 46 W2, 2026-10-26)

A pytest file that Squeal signalled, at a stop or at the deadline, is no longer completed when the project's own SIGTERM handler lets pytest write the held item's teardown. The rule (B) was agreed in request 06346e04 to the coordinator.

## Cause

A stop or the deadline calls `stopAll` in `src/runners/pytest/run/run.ts`: SIGTERM to each running batch's process group, then SIGKILL after `KILL_GRACE_MS` (2 s). A file completes when collection finished and every item it collected has its teardown report (spec 007 D6, `readBatch` in `report.ts`). By default nothing is written after the signal: Python's default action for SIGTERM ends the process at once, and neither pytest nor Squeal's plugin installs a handler. A project whose own code installs one can let pytest go on. A handler that raises `SystemExit` makes the held item's call fail, then pytest writes its teardown, and the file reads completed with a false FAIL. A handler that only logs lets pytest run on until the SIGKILL, and more files can complete after the signal.

## Rule

A batch keeps no completed file when Squeal signalled it and its process did not die of that SIGTERM: it exited with a code, or it got the SIGKILL after the grace. A signalled batch whose process died of the SIGTERM keeps the files that completed before the signal, as 007 D6 requires ("a batch killed mid-file keeps the completed files"): Python's default action writes nothing after the signal.

The mark is set as 011-230 set it for node:test: after the process exits, `batch.signalled = expired || cancelled`. That line runs in the exit's own turn, so it marks exactly the batches that `stopAll` signalled. The rule is one function, `completedOf` in `run.ts`. `stopAll`, the timer and the abort handler are as released.

## Cost

Only in a project with its own SIGTERM handler: the files of a cut batch that completed before the signal run again. With the default batch size of 5, that is up to 4 files per running batch. A tier of such a project that always reaches the deadline makes progress only in the batches that end before it. No false result is stored.

## The hole

A handler that lets pytest write events and then ends the process with SIGTERM again, its default action restored, reads as a process that died at once, so its teardown counts. coverage.py's `sigterm` option re-kills this way, but it does so at once inside its handler, where no pytest hook runs, so it writes no pytest event.

## Why not the exact rule

The events carry no timestamps, so after the exit nothing tells which events came before the signal. An exact rule would note each running batch's events-file size at the signal and complete files only from that prefix. That code runs only in `stopAll`, and no validity case cuts a run, so the key-format alarm (`test/keys/key-format.test.ts`) would fail on changed lines that no case runs. Closing it needs a validity case that cuts a run, or a move of `PYTEST_ADAPTER_VERSION`, which re-keys every stored pytest result with no key meaning changed. The coordinator chose rule B and no new case.

The other rule, a signalled batch keeps no file, was rejected: it breaks 007 D6 and the live test "kills a hung test and its child at the deadline and keeps the batch's completed file", and a tier that always reaches the deadline would never make progress.

## Evidence

Test: `test/runners/pytest/run/run-cut.test.ts`. A fake Python (a shell script at `<root>/env/bin/python`) writes one file whole and the held file's setup, then waits. `FAKE_HANDLER=exit` traps SIGTERM, writes the held file's failed call, its teardown and the session record, and exits 2. `FAKE_HANDLER=ignore` writes the same and goes on until the SIGKILL. Without the variable, SIGTERM ends it. Each case first checks that the stream is whole (`readBatch` reads both files completed) and the batch's exit in `run.json`.

| Case | Before the fix | After |
| --- | --- | --- |
| Handler exits 2, a stop's signal | FAIL: `completedFiles` held both files | PASS: no file |
| Handler exits 2, the deadline | FAIL: the same | PASS: no file, `timed-out` |
| Handler goes on, SIGKILL after the grace | FAIL: the same | PASS: no file |
| No handler, a stop's signal | PASS | PASS: the first file kept |
| No handler, the deadline | PASS | PASS: the first file kept |

"Before the fix" is Squeal's run with the guard line of `completedOf` removed (revisions 10 and 17), restored after. The live `run.test.ts` case "kills a hung test and its child at the deadline and keeps the batch's completed file" passes on Python 3.10 and 3.13 at revision 18, about 10 s each.

Key-format alarm: `test/keys/key-format.test.ts` passes at revisions 13 and 18 (Squeal). `compare-refs.ts squeal--v0.1.332 HEAD adapter:pytest` on `73a1675d7` and on `9bedad015`: pytest's alarm fired (4->4), 21 cases with keys and outputs equal, wording `[]`, uncovered 0. No version moved.

## Formats

No stored key or result format changes. `PYTEST_ADAPTER_VERSION`, `KEY_FORMAT_VERSION` and the runtime files are untouched. `Batch` (`batches.ts`) gets an additive `signalled: boolean`; it is internal to the pytest runner. `run.json`, a log under the run's directory, gets an additive `signalled` per batch; `src/core/status/run-log.ts` does not read pytest's batches.

## Commits

- `73a1675d7` fix(pytest): a batch whose handler outlived Squeal's signal completes no file.
- `9bedad015` test(pytest): a batch that outlived the grace and got SIGKILL completes no file; the rule's comment names 007 D6 and the hole.

## For whoever continues

Nothing of the row remains. The coordinator amends 007 D6 and writes the status line at integration. The bundles drift from the build because `run.ts` and `batches.ts` changed; the coordinator rebuilds them at integration. If the hole or the cost must close, the exact rule above needs a validity case that cuts a pytest run first.
