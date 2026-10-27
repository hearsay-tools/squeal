# 015-80 notes: the thread measurement limit

Worker f8de732b, 2026-10-27, from `tasks/wave-20.md` W1 (coordinator 8b2a8995). Shape: slice. Spec D9 as amended 2026-10-27 (the human's option a); `lessons.md` Round 2, C3. Wording only: no collector, store, `CodeNews` or type change.

## What changed

| Part | Before | After | Where |
|---|---|---|---|
| `untested` FAIL reason | `no test runs it in its own process` | `no test runs it in the test's own thread` | `src/core/delivery/code-coverage.ts` (`NOT_RUN`) |
| The limit | none | `Squeal does not measure worker threads or child processes.` after the evidence of each `untested` FAIL or STILL FAIL line (`NOT_RUN` and `NOT_LOADED`), and of each CRAP line that says `NOT_RUN` | `UNMEASURED`, `untestedWhy`, `crapEvidence` |
| Process sentence | `They may run it in a process they start, which Squeal does not measure.` | `They may run it in a worker thread or a process they start, which Squeal does not measure.` (and the one-file form). It takes the place of the limit sentence, so the line says it once. | `untestedWhy` |
| PASS untested | `test/a.test.ts runs it in its own process` | `test/a.test.ts runs it in its own thread`; `run it in their own threads` | `runsIt` |
| STILL FAIL quiet hint | `until a test runs it in its own process` | `until a test runs it in its own thread` | `quietHint` |
| `squeal code` words | `untested: no test runs it in its own process`; `a test runs it in its own process` | `untested: no test runs it in the test's own thread`; `a test runs it in its own thread` | `src/cli/code-coverage.ts` |
| `squeal code` limit | none | `  Coverage counts what ran in the test's own thread. Squeal does not measure worker threads or child processes.` after the listed functions, when the part counts an untested function or lists a failing one | `coverageLines` |

The lint provider case (`lessons.md` line 95), before and after:

```text
FAIL CRAP: EslintSession.lint (src/core/lint/provider/session.ts:207): 182, over 30 (complexity 13; no test runs it in its own process)
FAIL CRAP: EslintSession.lint (src/core/lint/provider/session.ts:207): 182, over 30 (complexity 13; no test runs it in the test's own thread). Squeal does not measure worker threads or child processes.
```

D6's block keeps one block per function. The `untested` line carries the limit, and the CRAP line leaves out `NOT_RUN` as before, so the block says the limit once:

```text
relist (test/keys/validity/harness/assemble.ts:150):
- FAIL untested: no test runs it in the test's own thread; 5 test files load this file. Squeal does not measure worker threads or child processes.
- FAIL CRAP: 42, over 30 (complexity 6)
```

The same file's `untested` line, as it would read (no test file's closure holds `session.ts`; see decision 2):

```text
FAIL untested: EslintSession.lint (src/core/lint/provider/session.ts:207): no test file loads this file (complexity 13, CRAP 182). Squeal does not measure worker threads or child processes.
```

Complexity lines, `RESOLVED` lines and a CRAP line with test files that ran it are unchanged.

## Red first

`test/code/crap/untested.test.ts`, describe "the thread limit (row 015-80)", four rendering cases through `codeLines`: the lint provider's CRAP line, its block with the worker-thread process sentence and the `coverage.exclude` hint, an `untested` line whose file's other functions ran, and a PASS with two test files. Run before the source change (`npx vitest run test/code/crap/untested.test.ts`, the daemon had not yet run the new file):

```text
 ❯ test/code/crap/untested.test.ts (13 tests | 4 failed) 503ms
     × says a CRAP line's function ran in no test's own thread, and what Squeal does not measure 14ms
     × says a worker thread the loaders start may run an untested function 3ms
     × states the limit on an untested line whose file's other functions ran 2ms
     × says a passing function runs in the test's own thread 1ms
-   "FAIL CRAP: EslintSession.lint (src/core/lint/provider/session.ts:207): 182, over 30 (complexity 13; no test runs it in the test's own thread). Squeal does not measure worker threads or child processes.",
+   "FAIL CRAP: EslintSession.lint (src/core/lint/provider/session.ts:207): 182, over 30 (complexity 13; no test runs it in its own process)",
      Tests  4 failed | 9 passed (13)
```

A fifth case, the same file's `untested` line with no loader, came after decision 2 was corrected. Squeal at revision 15, before the source change: `FAIL ... states the limit when no test file loads the file a worker thread runs from a bundle` (`- ... (complexity 13, CRAP 182). Squeal does not measure worker threads or child processes."`, received the line without the sentence); `FAIL -> PASS` at revision 17.

After the first source change Squeal showed the four as `FAIL -> PASS` at revision 3, and the seven older wording cases of the same file as `PASS -> FAIL` until their expectations changed. The new `code-command.test.ts` case pins when the CLI line comes: not for a part with no failing function, and for a failing CRAP function or an untested count.

## Decisions the spec did not settle

1. **The limit is on each line, not once per session.** The amendment says the evidence states the limit. A once-per-session sentence would leave later lines with no limit after the first scrolls away. Cost: one sentence of 8 words on each `untested` FAIL or STILL FAIL line, and on a CRAP line that says no test ran the function. The `coverage.exclude` hint stays once per consumer, only with the process sentence, as before.
2. **`no test file loads this file` keeps its words and gets the limit sentence too.** My first commit left it alone. I thought a worker thread's loads were in the test's closure, since a `Worker` keeps its parent's recorder (`src/runners/observe/spawn.cjs`, the `injected` comment). That holds only for a thread that loads the source itself. The lint tests bundle `worker.ts` with esbuild into a temporary `.mjs` file and run that in the thread (`test/lint/provider/helpers.ts`, `workerScript`). Only `worker.ts` imports `src/core/lint/provider/session.ts`. So no test file's closure holds `session.ts`, and its `untested` lines read `no test file loads this file`. That is the C3 case, and it read as "no test runs it". The CRAP 182 of `EslintSession.lint` is `CC² + CC` at CC 13, which fits a source with no loader. I did not see a delivered `untested` line for it: the dogfood (`015-14/part-b/judged.tsv`, lines 230 to 234) has only the five CRAP lines.
3. **FAIL says "the test's own thread"; PASS and the quiet hint say "its own thread".** In `no test runs it in its own thread`, "its" can read as the function's thread, so the brief's wording stays there. In `test/a.test.ts runs it in its own thread` the subject is the test file, so "its" is clear.
4. **`squeal code` states the limit once per coverage part, not on each function line.** A listing stays one line per function. The line comes after the listed functions and before the not-judged lines, only when `uncovered > 0` or a listed function fails. A CRAP-only part with failures gets it too, since the lint provider's lines were CRAP lines.

## Agreement with 015-84

The coordinator agreed (reply to request `7c2e42fe`, 2026-10-27) that this row changes only the PASS assertion in `test/code/delivery/pulled-coverage.test.ts:74`, in its own commit `b39824fc6`. W2 changes only the four delivery-tail labels in `test/code/crap/told.test.ts` to `Code:`. This row's `told.test.ts` hunk adds the CLI limit line after the `untested` line near line 100 and leaves the `Complexity:` header and labels alone.

## Found, not changed (outside this slice)

- Comments that still say "own process": `src/core/code/crap/join.ts:35` (CRAP judging) and `src/core/types/code-delivery.ts:46`, `:57` (types; 015-84 may change that file).
- `spec.md` D6 example (`- FAIL untested: no test runs it in its own process; 5 test files load this file`) and D9 **Delivery** (`no test runs it in its own process; 5 test files load this file`, the process sentences) show the old text. The amendment section states the new rule; the coordinator owns the spec.
- `plugins/claude-code/dist` and the other bundles still hold the old strings until the release build (brief: no bundle build).
- `src/cli/code-coverage.ts` is 305 lines (297 before).

## Commits

- `5e1d4578e` feat(015-80): coverage lines name the thread limit.
- `b39824fc6` test(015-80 with 015-84): PASS untested reads the test's own thread in pulled-coverage.
- `d8270d239` feat(015-80): a not-loaded untested line names the thread limit too.
- This notes file.

## Checks run

- `squeal status --wait 120000 test/code/crap/*.test.ts test/evals/code-lines.test.ts test/code/delivery/pulled-coverage.test.ts` at revision 12 (`b39824fc + 0`): `Named test files at revision 12: no known failures; 34 test files, each with a current result, after 51.8 s.`
- `squeal status --wait 180000 test/code/delivery/*.test.ts test/code/pass/*.test.ts test/cli/*.test.ts` at revision 12: 149 test files current, all passing; `test/cli/warmup.test.ts` still running at the deadline, no verdict from me. The wait asked one run of 7 unknown `install-sh` and launcher test files. Worktree: known failures 0.
- After `d8270d239`'s change, `squeal status --wait 150000 test/code/crap/*.test.ts test/code/delivery/*.test.ts test/evals/code-lines.test.ts` at revision 17: `Named test files at revision 17: no known failures; 55 test files, each with a current result, after 66.9 s.`
- `test/harness/opencode/package.test.ts` failed at revision 13: `cli/squeal.mjs differs from the build`. That is the committed bundle against a fresh build, expected while this row builds no bundle (brief). The release build clears it; the Claude Code and other bundle drift tests will read the same.
- `npm run lint` (`biome check .`): `Checked 2381 files in 1396ms. No fixes applied.`
- `npm run typecheck` (`tsc --noEmit`): clean. After each later source edit, `npx biome check` on the changed files and `npx tsc --noEmit`: clean.
- Not run: a full suite and a bundle build (brief). `src/core/delivery/code-coverage.ts` selects 744 test files. At revision 12 about 560 were still queued behind the vitest lane's quiet wait. Those outside the files listed above have no verdict from me.
