# 011-142: the pytest deadline case kills only after the file before the deadline reported

Worker 07ee1929, wave 31 W8, from main at 36ee11d02 (after 0.1.291), 2026-10-24. Shape: repair (test).

## 1. What failed

`test/keys/validity/pytest.test.ts:34`, "passes a runtime change that every case runs and agrees on, on both Pythons", case "a batch past Squeal's deadline completes nothing after the kill":

- The locked full run of 0.1.275 (load 30 to 90 on 24 CPUs): "run 1, validity:tests/test_first.py: completed at the last release, absent at the candidate", keys equal.
- Review 0.1.291, one worker, load 29 to 94: the same line; "first.py completed on one leg only". Both legs stopped on their 3,000 ms deadline.

The case runs `tests/test_first.py` (one fast test) and `tests/test_hang.py` (a 600 s sleep) in one pytest batch with a deadline of 3,000 ms. The deadline is a real timer that `runPytest` sets when the run starts (`src/runners/pytest/run/run.ts:160-167`). `test_first.py` reads as completed only when its teardown report is in the events file before the kill (`readBatch`, `src/runners/pytest/run/report.ts:93`). So which leg stores it depends on how long Python, pytest and the validity tracer take to start, against 3 s.

## 2. Probe

### Method

A scratch test, outside the repository, calls `compare` as `pytest.test.ts:34` does (this checkout against itself, the same `str(pytest.__version__)` overlay), with the deadline case alone, and records for each repetition what each leg completed, the failure text and the one-minute load. Red and green batches run the scratch test pinned to cores 20 to 23 (`taskset -c 20-23`) beside 4 bounded busy loops on the same cores (`timeout <s> sh -c 'while :; do :; done'`, nice 0). The pytest children run at a lower priority than the loops (`lowerProcess`), so they starve as on a busy host. The rest of the host ran other coordinators' tests.

| Batch | Code | Repetitions | Legs that stored `test_first.py` | Both legs stored nothing | One leg only | Comparison ms (min / median / max) | Load (1 min) |
|---|---|---|---|---|---|---|---|
| red | main 36ee11d02 | 8 | 1 of 16 | 7 | 1 | 12,942 / 14,619 / 16,256 | 43 to 70 |
| green | 7899f6f39, the hold | 20 | 40 of 40 | 0 | 0 | 12,215 / 29,587 / 53,573 | 33 to 79 |

*Read from the scratch test's records.*

### Findings

1. **The deadline races start-up.** Beside the loops, the run did not reach `test_first`'s teardown within 3 s on 15 of 16 legs, so neither file completed. The one leg that stored `test_first.py` was reported as "absent at the last release, completed at the candidate (the candidate stores more)", which does not fail. The other order, as in 0.1.275 and 0.1.291, raises and fails. *read from the records.*
2. **A loss at both legs passed unseen.** In 7 of 8 red runs both legs stored nothing, so the outputs were equal and the comparison passed. No check required the case to store `test_first.py`. This is 011-175's finding 5, for pytest.
3. **The product is not at fault.** The adapter stores what completed before the kill. The case's question, which file completes before a 3 s timer, has no fixed answer on a loaded host.

## 3. The repair

| Where | What |
|---|---|
| `test/keys/validity/cases/adapter/pytest.ts` | `test_hang` writes the file that `SQUEAL_VALIDITY_PROOF` names, then sleeps 600 s. |
| `test/keys/validity/harness/pytest.ts` | `heldDeadline(ms, proof, run)`: while the adapter runs, a timer of `ms` (the run's `timeoutMs`) fires at its time or once the proof file exists, whichever is later; it polls every 20 ms after its time. Other timers pass through. The harness sets `SQUEAL_VALIDITY_PROOF` to `<scratch>/proof` in the adapter's `childEnv`, removes the file before each run, and holds every run that gives `timeoutMs`; only this case does. A run that sets no timer of `ms`, or more than one, throws, and so does a proof absent after 60 s, which fires the timer. |
| `test/keys/validity/pytest.test.ts` | The test at line 34 also requires the deadline case to store `test_first.py`'s pass at both trees (finding 2). A new test, "names a candidate that completes the file the deadline's kill cut (row 011-142)", edits `report.ts` so a file reads complete once its items set up, and requires the comparison to name `test_hang.py` as completed at the candidate. |

Why the proof means `test_first.py` has reported: pytest runs the files in the order given. `test_first`'s teardown report is written and flushed (`_write`, `squeal_pytest.py:58-62`) in its own run protocol, before `test_hang`'s protocol starts. `test_hang` writes the proof in its body. So when the proof exists, the events file holds `test_first`'s teardown. `test_hang` is in its call phase until the kill, so it never has a teardown and never completes.

Why a patched `setTimeout`: the deadline is a real timer in `src/`, and no run option moves it. The harness runs in its own driver process (`driver.ts`), one case at a time, so the patch is visible only to that case's run. `run.ts` reads the global `setTimeout` at each call. A tree that set its deadline through `node:timers` would not be held; the "not one deadline" error makes that a failure of the test at line 34, never a silent race.

`src/` is unchanged. The case name, `timeoutMs` (3,000 ms) and the failure text are unchanged.

## 4. Checks

- **Red, the race:** batch "red" in section 2: 1 of 16 legs stored `test_first.py`; 1 of 8 comparisons differed.
- **Red, the new assertion:** with the case's files swapped (`test_hang.py` first, so its proof comes before `test_first.py` runs), the test at line 34 failed at `pytest.test.ts:58` ("expected [ { runs: [ { …(5) } ] }, …(1) ] to match object …", `completed` and `results` empty at both legs) after the equal-outputs assertion had passed. 266,054 ms, load 50.
- **Green, the race:** batch "green" in section 2: 20 of 20 comparisons equal, 40 of 40 legs stored `test_first.py`, load 33 to 79.
- **A candidate that completes the file the kill cut:** the new test, with `report.ts` reading a file complete once its items set up: "run 1, validity:tests/test_hang.py: absent at the last release, completed at the candidate (the candidate stores more)". Passed in 14.5 s at load 45. By the direction rule (`byDirection`, `verdict.ts`) a file only the candidate stores is listed and never failed.
- **A release that completed it:** a scratch comparison with the same edit in the baseline tree (HEAD extracted) and this checkout as the candidate raised "run 1, validity:tests/test_hang.py: completed at the last release, absent at the candidate", and `failures` named the case with "raise PYTEST_ADAPTER_VERSION". So both directions are caught.
- **The whole file, beside load:** 5 runs, every test passed in each; run 1's file failed on the `afterAll` removal (section 5).

## 5. The whole file, beside load

`file-runs.sh` ran `pytest.test.ts` 5 times in turn at cd8bb0ae1, unpinned, beside the host's load, with the one-minute load sampled every 15 s. A guard started 8 bounded busy loops on cores 16 to 23 for 120 s when the load fell under 28; it fired once, at 14:07:57 (load 24.8), during run 5. By the coordinator's decision, these 5 runs and the 20 deadline-case runs of section 2 are the evidence for this row; the whole file's duration is row 011-179's.

| Run | Local time | Load (1 min, min to max) | Tests | File | Duration |
|---|---|---|---|---|---|
| 1 | 13:59 to 14:02 | 49.5 to 98.5 | 4 of 4 passed | failed: `afterAll` "Hook timed out in 10000ms" (`self-test.ts:80`) | 196.7 s |
| 2 | 14:02 to 14:04 | 51.7 to 67.9 | 4 of 4 passed | passed | 122.1 s |
| 3 | 14:04 to 14:06 | 36.5 to 55.1 | 4 of 4 passed | passed | 88.4 s |
| 4 | 14:06 to 14:07 | 33.5 to 42.6 | 4 of 4 passed | passed | 89.5 s |
| 5 | 14:07 to 14:09 | 24.8 to 35.1 | 4 of 4 passed | passed | 95.7 s |

*Read from the runs' summaries and the load samples.*

No run failed the deadline case or the new checks. Run 1 failed after its tests, in the `afterAll` of `comparisons()` that removes the work directory with `rmSync`. Squeal's own run of the file at revision 9 failed the same way, and its re-run at revision 11 passed ("Flaky: FAIL -> PASS under the same inputs"). The directory is large: in run 2, the full-corpus comparison (`run-0`, both Pythons) held 13,129 files and 202 MB, mostly the synced environments and each case's scratch; the kill-cut check's comparison (`run-1`) held 1,286 files and 26 MB, about 6% of the total, and the release tree 717 files. The coordinator kept the kill-cut check as its own comparison and gave the removal to row 011-179 (section 6).

## 6. The comparison's duration and its removal (row 011-179)

The test at line 34 took 266 s alone at load 50 (section 4), against `FULL`'s 300 s timeout (`self-test.ts`). In review 0.1.291's full run it took 631 s and failed on the timeout. The cause is that the comparison is serial: four drivers in turn through `spawnSync` (`sides.ts:142`; a run and a decide at each tree), each running its cases in turn, about 21 pytest cases on two Pythons. The hold adds no time on a loaded host: the deadline fires at the proof, which comes when start-up ends. The coordinator opened row 011-179 for the duration; this row does not change it, and a longer timeout for this one test was not taken, since 600 s would not have held 631 s. Row 011-179 also takes the `afterAll` removal of section 5 (13,129 files and 202 MB in one comparison, past Vitest's 10 s hook timeout at load 50 to 99).

## For whoever continues

- A validity case whose run has a deadline (`timeoutMs`) must write `SQUEAL_VALIDITY_PROOF`'s file from the test that is running at the kill, after the files that must complete. Without it, the case throws after 60 s.
- The scratch tests live in the worker's scratch directory, which goes with the worktree: `deadline.repro.ts` (the deadline case compared `REPRO_N` times, records in `records.jsonl`), `reverse.repro.ts` (the baseline-side edit), `load.sh` (bounded busy loops on given cores), `file-runs.sh` (the whole file in turn, with a load sampler) and `guard.sh` (`load.sh` when the load falls under 28). Each runs through a config with `root` at the scratch directory and `node_modules` linked from the worktree. Section 2 describes them well enough to write them again.
