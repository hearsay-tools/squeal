# Rows 020-67 and 020-68: the keeper waits while writes land, and says what it kept (#220)

Worker 007d6576, 2026-11-14. Brief: `tasks/wave-26.md`. Research: `research/issue-220.md` (findings 1 and 3, option A, the kept-count line), probe `research/probes/issue-220/bound.probe.ts`.

## What changed

- **020-67, the wait** (`src/core/code/gate/keep-wait.ts`, new). `StoreWait`, `KEEP_BUSY_BOUND_MS` and their helpers moved out of `keep-write.ts` (which was 340 lines) into `keep-wait.ts`. The wait keeps two times: when the first write was refused (`#since`) and when the last write landed (`#quiet`). The bound (30 s) counts from `#quiet`, so each landed write starts it again. The ceiling counts from `#since`: `max(bound, runMs(left))`, `left` being the files still to write at the first refusal. `giveUp` records which limit stopped the wait (`stop`: `"quiet"` or `"ceiling"`); `spent` words the line from it.
- **The landed signal** (`keep-write.ts`, `keep-seen.ts`, `keep-pass.ts`). `keepFile` and `keepSeen` take an optional `landed` callback, called after each write that lands (the coverage write, the results write, the reads merge). `writeQueued` passes `() => wait.landed()`. Before the first refusal it does nothing.
- **The ceiling's run time** (`runTime` in `keep-wait.ts`). Per queued run: the sum of the left files' own durations (`RunReport.fileDurations`), never more than the run's `durationMs`; the run's whole `durationMs` when one of those files has no duration of its own. Summed over the runs. The pass builds it from `state.queued`.
- **020-68, the count** (`keep.ts`, `keptCount` in `keep-write.ts`). The keeper counts each completed file once, in the run that decides it (`#keepable`: the lookup's decided files that are in `report.completedFiles`), and the files the passes wrote (early and last). After the last pass and the write-time reasons, when the count of completed files is not 0, `flush` tells one line through `note`, so the CLI prints it on stderr as `squeal code: …`.
- **Unchanged**: the input re-check after a busy pause, the early passes (they still give up at the first refusal), the verdict, the JSON report, the exit code.

## Lines

Before the wait (example with a ceiling of 95 s):

> `the store is busy (held by pid 4242 (node …)); waiting to keep 340 completed test files (29 kept while the runs went on) until no write lands for 30 s, at most 95 s in all: test/a.test.ts, … and 335 more`

When the bound stopped it:

> `224 completed test files were not kept in the stores: no write landed for 30 s (held by pid 4242 (node …)); the next run will run them again`

When the ceiling stopped it:

> `224 completed test files were not kept in the stores: the store was still busy after 95 s (held by pid 4242 (node …)), and waiting longer would cost more than running them again; the next run will run them again`

The count, after the last pass:

> `145 of 478 completed test files are kept in the stores (29 while the runs went on); the next run on the same bytes runs the other 333`
> `all 478 completed test files are kept in the stores (29 while the runs went on); the next run on the same bytes reads them from the stores`
> `0 of 5 completed test files are kept in the stores; the next run on the same bytes runs all 5`

The parenthesis is left out when no file was kept while the runs went on. "is kept" when exactly 1 is kept. No full stop at the end, as the other keeper lines.

## Decisions the spec did not settle

1. **What "the time the queued files took to run" is.** Per run, the sum of their own file durations capped at the run's duration, summed over runs (above). Runs of different runners ran at once, so the sum is an upper bound of a rerun's wall time. A file with no duration of its own makes its run count whole. Alternative: the runs' wall times only, which overstates when most of a run's files were kept early.
2. **When the ceiling is measured.** At the first refusal of the last pass, from the files still to write then. It does not change during the wait.
3. **Which limit wins when both are reached at once.** The bound ("no write landed"): with no landed write it is the true cause. When the ceiling equals the bound (a run time under 30 s) and writes landed, the ceiling line names 30 s.
4. **Which writes are "landed".** Each write that lands: a file's coverage write, its results write, and the reads merge (`keepSeen`). A file that is dropped because its inputs moved lands nothing.
5. **The text report.** The brief says the line goes into the text report "when it is printed after the pass". In every path the report is printed before the last pass (D17.5: `afterReport` in `src/cli/code-gate.ts` runs after `io.stdout`; with `--json` the child sends its report before it keeps). So the text report never comes after the pass, and the line is on stderr only. No `src/cli/code-gate*.ts` file changed. Printing the text report after the pass would delay the verdict, against D17.5.
6. **Which completed files are counted.** The files the keeper decides: completed in a run, and keyed by the lookup (none from the stores or the parts, which do not run). A file a lookup did not expect (no store, or a runner it was not told of) is not counted. A retried file is counted once, by its rerun. A retried file whose rerun never started is decided by no run and is not counted (`keep-rerun.test.ts`, "never keeps the first failure"); the next run runs it, but the line does not name it.
7. **A write the daemon may have kept** (`KeepUnknown`, review 0.1.450 B2) is not counted as kept. The line before it already says whether it is kept is not known.
8. **Where the line sits on stderr.** The keeper's lines (the busy wait, the not-kept reasons, now the count) come after the report and after the lines `afterVerdict` writes (refused parts, reruns, the kept log), because `flush` runs in `codeGateCommand`'s `finally`. So the count is now the last stderr line whenever a file completed, and the kept-log line (#197) is no longer last. D3.5 says the log line comes "after the verdict"; it does not say last. Tests that read the log line as the last line now read it as the one before the count.
9. **The count is told on every `flush`.** A keeper flushes once per gate. A second flush (only in tests) tells the counts so far; `#tell` drops an identical line.

## Proposed spec text

D17.5, replace "Once the report is out, the keeper stops those tries and writes what is still queued, waiting for a busy store up to the 30 s bound counted from the first write it refused, with the lines below." with:

> Once the report is out, the keeper stops those tries and writes what is still queued. It waits for a busy store while writes land: the 30 s bound counts only time with no landed write, and each write that lands (a file's coverage write, its results write, the reads merge) starts it again. A ceiling stops the wait in all: the time the queued files took to run in this gate, never less than 30 s, because waiting longer would cost more than running them again. That time is, per run, the sum of the queued files' own durations, never more than the run's duration (the run's duration when one of them has none), summed over the runs, and it is read at the first refused write (amended 2026-11-14, row 020-67, #220; the human: "Save wait: A: Reset on each save"). The lines are below.

D17.5, replace the example line with:

> `the store is busy (held by pid 4242 (node -e ...)); waiting to keep 2 completed test files (4 kept while the runs went on) until no write lands for 30 s, at most 30 s in all: test/e.test.mjs, test/f.test.mjs`

D17.5, replace "with a bound of 30 s from the first busy write instead of 10 s per runner run" with "with a bound of 30 s with no landed write, and the ceiling above, instead of 10 s per runner run".

D17.5, replace "On exhaustion the note says how many completed files were not kept, names the holders, and says the next run will run those files again." with:

> When the wait stops, the note says how many completed files were not kept, names the holders, says which limit stopped it, and says the next run will run those files again: `no write landed for 30 s (held by …)`, or `the store was still busy after 95 s (held by …), and waiting longer would cost more than running them again`.

D17.5, append (row 020-68):

> Amended 2026-11-14 (row 020-68, #220; the human: "Saved line: Build it"): after the last pass, when a run completed a file, stderr gets one more line: how many of the completed files are kept in the stores, how many of them while the runs went on, and what the next run on the same bytes runs. For example `squeal code: 145 of 478 completed test files are kept in the stores (29 while the runs went on); the next run on the same bytes runs the other 333`, or, when every one is kept, `squeal code: all 478 completed test files are kept in the stores (29 while the runs went on); the next run on the same bytes reads them from the stores`. A completed file is counted once, by the run that decides it (a retried file by its rerun); a file read from the stores or the parts did not run and is not counted. The text report and the JSON report are printed before the last pass, so neither holds the line. Verdict, reports and exit code do not change.

D17.3, so that it agrees with D17.5 (the coordinator, 2026-11-14: the input re-check after a busy pause stays). Replace "An input that changes after that window does not undo the keep: the run read bytes that give its key, so the result is true at that key, and a gate on the changed bytes has another key and runs the file." with:

> An input that changes after that window does not make the result false: the run read bytes that give its key, so the result is true at that key, and a gate on the changed bytes has another key and runs the file. The keeper still checks a file's inputs at its pass's opening check and, once a write did not land, before each try (D17.5); a file whose inputs moved by then is not written, and the next run runs it. That costs a rerun, never a wrong result.

## Done-when mapped to tests

| Done-when | Test |
|---|---|
| 340 files each refused once are all kept | `test/code/gate/keep-stall.test.ts` "keeps 340 files each refused once, though the wait passes 30 s in all" (fake writer and clock, the probe's shape: 119 s in all, all 340 written, no stop) |
| No landed write for 30 s stops with its line | `keep-stall.test.ts` "stops when no write landed for 30 s, and says so" (exact line); "stops after a long run of landed writes when no write lands for 30 s after them" (the bound counts from the last landed write) |
| The ceiling stops with its line | `keep-stall.test.ts` "stops at the ceiling, …" (exact line, stops within one file of 60 s); "never sets the ceiling under the bound" |
| The ceiling's run time | `keep-stall.test.ts` "sums the files' own durations per run, at most the run's, over the runs"; "takes the run's whole duration when a file has none of its own" |
| Busy and keep tests pass with only line text changed | `keep-busy`, `keep-daemon`, `keep-early`, `keep-grown`, `test/cli/code-gate-keep-busy`, `test/cli/code-gate-keep-early`: the wait and spent lines only (020-67). With 020-68 the keeper's note lists also end with the count line in `keep`, `keep-busy`, `keep-daemon`, `keep-daemon-lost`, `keep-daemon-wire`, `keep-early`, `keep-early-moved`, `keep-early-retry`, `keep-grown`, `keep-grown-daemon`, `keep-rerun` and `test/run-evidence/keeper.test.ts`; each asserts the exact count for its case |
| The count with kept and not-kept files; all kept; no completed file prints nothing new | `test/code/gate/keep-count.test.ts` (the text forms); `test/cli/code-gate-keep-early.test.ts` (4 of 6 on stderr, the last line); `keep-early.test.ts` "keeps the files written before a hold…" (1 of 2, 1 early); `keep-busy.test.ts` (0 of 2, 1 of 2, all 1); `keep.test.ts` "tells no count when no file completed (row 020-68)" |

## For the next worker

- `test/run-evidence/keeper.test.ts` tests the `Keeper` (`keep.ts`), so its note lists changed with the count line. It sits outside `test/code/gate/`; say so to its owner if that matters.
- CLI gate tests that compare all of stderr, or read its last line, now expect the count line: `code-gate.test.ts` (exact stderr; the log line before the count in two cases), `code-gate-exceptions.test.ts`, `code-gate-children.test.ts`, `code-gate-stored.test.ts`, `code-gate-log.test.ts`. `KEPT_ONE` in `test/cli/code-gate-fixture.ts` is the one-file line.
- The CLI keep tests (`test/cli/code-gate-keep*.test.ts`) match stderr with patterns and did not need the count line. One case now asserts it: `code-gate-keep-early.test.ts` "keeps the files completed before a hold past the bound…" reads `squeal code: 4 of 6 completed test files are kept in the stores (4 while the runs went on); the next run on the same bytes runs the other 2` as the last stderr line.
- The research probe `research/probes/issue-220/bound.probe.ts` imports `StoreWait` from `keep-write.js`; it now lives in `keep-wait.js`. The probe is a research record and was not changed; `keep-stall.test.ts` replaces it.
- Not measured: whether option A keeps all files under #220's real contention (the research's open question).
