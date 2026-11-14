# Row 020-60 notes: the gate names failures from the stores, and can rerun them (#200, #214)

Worker 24bdc546, wave 22, shape slice. Base `479ff5d66`.

## What changed

- `src/core/code/gate/types.ts`: `StoredRerun { outcome: "passed" | "failed" | "not-finished" }`; `TestFileEvidence.storedRerun?` (additive).
- `src/core/code/gate/stored.ts`: `StoredOptions.rerunFailures?` (additive). With it, each file the stores give a failure (a failed test or a file error) is handed to the evidence marked `storedRerun: { outcome: "not-finished" }`, and its key goes to a second `keeper.expect` call, a lookup of its own.
- `src/core/code/gate/retry.ts`: `storedToRerun`, `afterStoredRerun`, `storedRerunOf`, `storedFailuresText`, `storedRerunText`, `RERUN_STORED_FLAG`. All logic of the rerun lives here.
- `src/core/code/gate/lanes.ts` (row 020-59's file, by agreement, request 0826a4ab, own commit `5ef637085`): per planned run, the marked files (`storedToRerun`); after the first runs and the load reruns, one run per runner of those files (`runOne(..., "-stored")`, run id `gate-<i>-stored`); the merge is `afterStoredRerun`. 14 lines.
- `src/core/code/gate/report.ts`, `runs.ts`: `GateRunReport.storedRerun?`, by path (additive).
- `src/cli/code-gate-args.ts`: `--rerun-stored-failures`, `GateArgs.rerunStoredFailures?: true` (additive); usage line.
- `src/cli/code-gate-stored.ts` (no row owns it; two optional trailing parameters): `collectWithStores(..., rerunFailures = false)` and `storedFiles(..., rerunFailures = false)` pass the flag to `openStored`.
- `src/cli/code-gate.ts` (own commit `a760648a2`; only `afterVerdict`, the flag pass-through and the command builder; the end-of-run wait is untouched): the two stderr lines.

## Decisions the spec did not settle

1. **Flag name:** `--rerun-stored-failures`. A boolean, no value; `--rerun-stored-failures=yes` is an unknown option, as `--json=yes` is.
2. **When the rerun runs:** after every first run and after the load reruns of row 020-54, each runner's at once, with what is left of the budget. Fresh files and load reruns come first because they are new evidence. Cost: when both a load rerun and a stored rerun happen, they run one after the other. They cannot share one adapter run cheaply, because the load rerun merges by index (`afterRetry`) and row 020-59 is restructuring the runs.
3. **A stored rerun is the file's one rerun.** It never reruns again under load (`runOne` reads the load only for a first run). So "reruns once" holds with the load rule on.
4. **When the rerun does not finish or never starts,** the stored failure stands: the file's evidence stays the stored one (`from: store`), and `storedRerun.outcome` reads `not-finished`. Before, the gate had this evidence; losing it to an unfinished run would give less information.
5. **Keep:** the marked files are expected in a keeper lookup of their own (`stored.ts`). Reason: `Expectations.take` takes a whole lookup when any of its files runs, so in one lookup with the first run's files they would be dropped before their rerun. Their keep is judged from the lookup to the rerun's end, as row 020-55 judges a load rerun. A completed rerun, passed or failed, is kept at the key and replaces the stored rows (`storeResults`, which heals other worktrees on a pass, 001-171). No `keep*.ts` change.
6. **`from` after a rerun:** a completed rerun reads `run`; a stored failure that stands reads `store`. `functions[].failedTests[].from` follows it.
7. **The stderr line without the flag** names only failures from the stores (not from the parts: the brief names the stores, and `--parts` evidence is a CI artifact the flag does not rerun). It names at most three files, in path order, then "and N more", in one line over every runner. The command is the call's own arguments plus the flag, after the same command prefix as the `--json` rerun hint (`statusCommand`).
8. **Line order after the verdict:** refused lines, the load-rerun line, the stored-rerun line, the stored-failure line, then the kept-log line.
9. **Parts evidence and stored passes** are never marked, so they never rerun.
10. **No estimate for the rerun:** the files of a stored rerun are not in the estimate or the early stop (D17.1). They run only with what is left.

## Proposed spec text

**D3.4, append:** Added 2026-11-14 (row 020-60, #200, #214; the human, 2026-11-14: "Stored fail: Explain + flag"): with `--rerun-stored-failures`, each selected file whose evidence the stores gave as a failure (a failed test or a file error) runs once more, through the runner that would run it, after every first run and every rerun under load, with what is left of the budget. When the rerun completes the file, its result is the file's result: a pass reads passed, a failure reads failed. When the budget, a crash or no budget left stops it, the stored failure stands. A file is rerun at most once: a stored rerun that fails under load does not run again. Stored passes, evidence from the parts, and failures from a run here are never rerun by the flag. The files of a stored rerun are not in the estimate (D17.1). Without the flag, nothing changes: a stored failure is reused, as D11.7 says. The verdict reads the file's final evidence as before, and `QUALITY_POLICY_VERSION` does not change.

**D7, append:** Added 2026-11-14 (row 020-60): `runs[].storedRerun`, by path, each selected file the stores gave a failure that the flag reran: `outcome`, `passed` or `failed` (the file's result here is the rerun's, and `from` reads `run`) or `not-finished` (the stored failure stands, and `from` reads `store`). Absent without the flag and when the stores gave no failure. After the verdict, stderr gets at most two lines. One for the reruns: the count and each outcome's count with at most three paths, for example `squeal code: 1 failed test file read from the stores ran once more (--rerun-stored-failures): 1 passed (test/flaky.test.ts).` One for the stored failures that did not run again: the count, at most three paths and the command that reruns them, for example `squeal code: 1 failed test file was read from the stores and did not run here (test/flaky.test.ts). To run it once more: squeal code --base main --json --rerun-stored-failures`. They come after the line of reruns under load and before the kept-log line.

**D11.7, append:** Amended 2026-11-14 (row 020-60): with `--rerun-stored-failures`, a stored failure is read and then run once more (D3.4); its rerun is kept at its key (D17.3).

**D17.3, append:** Amended 2026-11-14 (row 020-60): a file the flag reruns (D3.4) is kept as a rerun under load is: its keep is judged from the stored lookup to the rerun's end, and a completed rerun, passed or failed, replaces the stored rows at the key. A rerun that did not complete writes nothing.

**D1, usage:** `squeal code --base <ref> [<path>...] [--test <file>...] [--group <name>...] [--parts <dir>...] [--timeout <seconds>] [--exceptions <file>] [--rerun-stored-failures] [--json]`.

## Proposed `commands.md` text

Under `squeal code --base`, after `--timeout`:

> `--rerun-stored-failures`: run once more each selected test file whose failure the gate read from the stores, after the other files, with what is left of the `--timeout` budget. A completed rerun's result counts and is saved at the file's key. A file whose rerun does not finish keeps the stored failure. Without it, a stored failure is reused, and stderr names it with this command.

`src/cli/main.ts` help (no row owns it, so not changed here): the `squeal code --base` usage continuation line could add `[--rerun-stored-failures]`; `test/cli/code-gate-args.test.ts`, "squeal --help", pins that line.

## Done-when mapped to tests

| Done-when | Test |
| --- | --- |
| A stored failure prints its line and the rerun command | `test/cli/code-gate-stored-rerun.test.ts` "names a stored failure and the command that reruns it, and reruns nothing"; `test/code/gate/retry-text.test.ts` "storedFailuresText" (bound of three, runners merged, parts and passes not named) |
| With the flag it reruns once, and a pass reads passed and is kept | `code-gate-stored-rerun.test.ts` "with the flag, reruns it once: a pass reads passed and is kept" (run counter = 2; next gate reads both files `from: store`, exit 0); `test/code/gate/lanes-stored-rerun.test.ts` first case (order after every run, keeper hears the rerun) |
| A second failure stays failed | `code-gate-stored-rerun.test.ts` "with the flag, a second failure stays failed, and is kept"; `lanes-stored-rerun.test.ts` "keeps a second failure failed, and never reruns it under load" |
| Without the flag reports are as before | `code-gate-stored-rerun.test.ts` first case (no `storedRerun`, `from: store`, run counter stays 1); existing `test/code/gate/lanes-retry.test.ts` "never reruns a failure the stores or the parts gave"; the golden and gate tests unchanged |
| Stored passes are never rerun | `code-gate-stored-rerun.test.ts` (`test/math.test.ts` stays `from: store` with the flag); `lanes-stored-rerun.test.ts` first case (`t/pass.test.ts`) |
| Unfinished rerun keeps the stored failure | `lanes-stored-rerun.test.ts` "does not finish in the budget", "no budget is left" |
| Flag parse | `test/cli/code-gate-args.test.ts` "reruns stored failures only with --rerun-stored-failures" |

## Checks run

- `pnpm exec tsc --noEmit -p .`: no output (passes), after every change.
- `pnpm run lint` (`biome check .`): "Checked 3424 files in 5s. No fixes applied."
- `squeal status --wait 60000` on the new and directly related tests, revision 19: `test/code/gate/lanes-stored-rerun.test.ts`, `test/code/gate/retry-text.test.ts`, `test/cli/code-gate-stored-rerun.test.ts`, `test/code/gate/lanes-retry.test.ts`: "no known failures; 4 test files, each with a current result".
- `squeal status --wait 600000` on every changed path, revision 19: 22 current, all pass (among them `code-gate.test.ts`, `code-gate-args.test.ts`, `code-gate-stored.test.ts`, `code-gate-stored-rerun.test.ts`); 349 still queued after 601 s, the host busy (23 of 24 cores).
- Again at revision 20 (the commits): 26 current, all pass; 345 still queued after 542 s (24 of 24 cores busy). No failure known.
- Because the queue did not drain, run directly: `pnpm exec vitest run --maxWorkers=2` on `test/code/gate/{lanes,lanes-retry,collect-retry,collect-stored,keep-rerun,stored,evaluate-golden,evaluate-failed-tests}.test.ts` and `test/cli/{code-gate-retry,code-gate-keep}.test.ts`: "Test Files 10 passed (10), Tests 45 passed (45)", 119 s.

## Checks not run

- No full suite and no `pnpm run build` (wave rule: no build in a worker tree; `plugins/claude-code/dist` not owned).
- No test pins a keep bar (an input written during the stored rerun); the keeper path is the one row 020-55 tests (`keep-rerun.test.ts`), reached through a lookup of its own.

## For the next worker and the coordinator

- Row 020-59 restructures `lanes.ts`. The 020-60 edit there is: collect `storedToRerun(chosen, context.known)` per planned run; after the reruns, `runOne(planned, files, context, STORED)` per such run; `ended` and `timedOut` take the runs that started; `testFiles` goes through `afterStoredRerun(testFiles, context.known, again)`. `afterStoredRerun` matches by the identity of the known evidence objects, so `testFiles` must still hold `context.known`'s objects for those files.
- If row 020-59 writes each file as it completes, a stored rerun's files are written by the same path: they reach `keeper.ran` through `tellRan` with no `retrying`.
- Follow-up (not done, other owners): with the flag, the selection line still says "none to run, N read from the stores" (`prerun.ts`); it could say how many run again. The text report (`code-gate-text.ts`, row 020-61) does not show `storedRerun`; the stderr line does.
- `squeal retry` and its receipts (#214's retry wording and stall) belong to spec 011, not here.

## Repair R2 (review 0.1.495 B2; wave 22.6)

Worker 24bdc546 again, on `origin/cand/0.1.495` (`9d98a53c0`); the branch was reset there, so the repair replays onto the merged candidate. The pre-R2 head is tagged `wip/24bdc546-pre-r2` locally.

**Defect:** with `--rerun-stored-failures`, the pre-run summary (D14.4) treated every file with known evidence as not run. A run whose only files were stored-failure reruns printed "none to run" and named no global setup, and then ran the file and its setups.

**Fix (`02a2143af`):**
- `src/core/code/gate/prerun.ts`: `runsHere(known, ref)`: a file runs when it has no known evidence, or when its known evidence is marked `storedRerun`. `RunnerSelection.run` counts with it; `RunnerSelection.storedRerun?` (additive) counts the marked ones; `known.store` and `known.parts` count only the files that do not run again. The global-setup disclosure (`setupsOf`) reads the same predicate, so the marked files' projects and the root's setup are named.
- `src/cli/code-gate-prerun.ts`: the runner line names the reruns inside the count to run, for example `Vitest: 3 test files selected (tests 3): 1 to run (1 once more after a stored failure), 2 read from the stores`.
- Unchanged: the estimate and the early stop (`plan.ts` reads only the files with no known evidence), the run order (first runs, load reruns, then stored reruns), the fallback stored failure, and one rerun at most. `stored.ts` needed no change.

**Not changed (not owned):** `setup-selection.ts`'s `wholeProjects` still counts its `run` as files with no known evidence. A changed path every test file of a project depends on changes those files' keys, so the stores hold no evidence for them at the new key, and the count cannot differ in practice.

**Proposed D14.4 text, append:** Amended 2026-11-14 (row 020-60 repair, review 0.1.495 B2): a stored failure that `--rerun-stored-failures` runs once more (D3.4) is a file that runs: the runner line counts it with the files to run and names how many of them run once more after a stored failure, and the global setups it starts, its project's and the root's, are named. It is not counted as read from the stores. It stays out of the estimate and the early stop (D3.4).

**Proposed D3.4 text:** no change; it already keeps stored reruns out of the estimate and the early stop.

**Done-when mapped to tests** (`test/cli/code-gate-stored-rerun-prerun.test.ts`, real CLI, two Vitest projects with global setups that write `setup-runs.txt`):
- Stored-only rerun prints a correct count and its global-setup line, both before any setup runs; both setups ran; no estimate line and no `runs[].estimate`: "counts a stored-only rerun as a file to run, and names its global setups".
- Mixed case (one stored rerun, one ordinary file with a new key, one reused pass): "2 to run (1 once more after a stored failure), 1 read from the stores", the setup line, and an estimate of 1 file only: "counts a stored rerun beside an ordinary file; the estimate holds only that file".
- Without the flag the line reads "none to run, 3 read from the stores" and no setup runs: "without the flag, a stored failure is read, as before".
- Early stop unchanged: `plan.ts` not changed; `test/code/gate/collect-early.test.ts` passes.

**Checks run (repair):**
- `pnpm run lint`: "Checked 3435 files … No fixes applied." `pnpm run typecheck` (`tsrs --fast --noEmit`): exit 0.
- `squeal status --wait`, revision 27–28: `test/cli/code-gate-stored-rerun-prerun.test.ts`: 3 failed first on the missing `(tests 3)` group label in my expectations, then all 3 pass after that test-only fix.
- `squeal status --wait 540000`, revision 28 (commit `02a2143af`): `test/cli/code-gate-prerun.test.ts`, `test/code/gate/setup-selection.test.ts`, `test/cli/code-gate-stored-rerun.test.ts`, `test/cli/code-gate-setup.test.ts`, `test/code/gate/collect-prerun.test.ts`, `test/code/gate/collect-early.test.ts`, `test/code/gate/lanes-stored-rerun.test.ts`, `test/cli/code-gate-estimate.test.ts`, `test/cli/code-gate-text-left-out.test.ts`: "no known failures; 9 test files, each with a current result".
- Not run: full suite, `pnpm run build` (wave rule). Other affected test files were still queued in Squeal when this was written.
