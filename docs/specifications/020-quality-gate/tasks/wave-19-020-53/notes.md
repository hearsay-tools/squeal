# Row 020-53 notes: a `test-failed` gap names the failed test and whether it loads the function (#210)

Worker f3c22710, 2026-11-13. Shape: slice. Base: main at `029499709`.

## What changed

D5.5 is unchanged: one selected failure still blocks every changed function. The report now says which failure, where its evidence came from, and whether it is in the function's loaders. States, verdicts, exit codes and `QUALITY_POLICY_VERSION` (4) do not change.

JSON, #210's probe shape (a passing, fully covered callback in `test/a.test.mjs`; `test/b.test.mjs` fails an unrelated base test):

```json
{
  "path": "test/a.test.mjs",
  "qualifiedName": "<test>",
  "coverage": { "lines": 3, "covered": 3, "share": 1 },
  "crap": 1,
  "state": "incomplete",
  "gap": "test-failed",
  "loaders": { "expected": ["test/a.test.mjs"], "measured": ["test/a.test.mjs"] },
  "failedTests": [
    { "path": "test/b.test.mjs", "tests": ["unrelated base test"], "from": "run", "loader": false }
  ]
}
```

On the second, unchanged run both files come from the stores, and the entry reads `"from": "store"`.

Text. One such function keeps its line, with new words:

```text
  test/a.test.mjs:1  <test>  CC 1, coverage 100%, CRAP 1: incomplete: a selected test failed outside its loaders: test/b.test.mjs › unrelated base test
```

Two or more with the same failed tests fold into one line after the function lines (the parent's answer A, request `4b3012bd`):

```text
  138 changed functions: incomplete: a selected test failed outside their loaders: .github/scripts/node-dist-action.test.cjs › a stalled download is aborted after the attempt timeout and retried once (first: .github/scripts/change-surface-readers.test.cjs:151 <test>; --json lists them all)
```

With more failed tests, the cause ends `… › <first test> and N more failed tests`. A function one of whose own loaders failed reads as before: `incomplete: a selected test failed`.

## Commits

1. `ce09db6e8` feat(020-53): report field `functions[].failedTests` for a test-failed gap. `report.ts` only: `GateFailedTests` and the optional field. This is the report-fields commit the brief asks for.
2. `d9fce217c` feat(020-53): a test-failed function names its failed tests and their loader standing. `failed-tests.ts` (new), `evaluate.ts`; test `test/code/gate/evaluate-failed-tests.test.ts` (new).
3. `cc9750ee9` feat(020-53): the text says a test failed outside the function's loaders. `src/cli/code-gate-text-failed.ts` (new), `code-gate-text.ts`; test `test/cli/code-gate-text-failed.test.ts` (new).
4. `b4d1628a1` test(020-53): #210's probe shape end to end, from the run and the stores. `test/cli/code-gate-failed-outside.test.ts` (new).
5. `d37c1d780` test(020-53): list `code-gate-failed-outside` as version-sensitive (shared list, two lines). `test/version-sensitive.txt`.
6. `e9b7da38e` test(020-53): retire the test-failed checks the new ones supersede. `test/code/gate/evaluate.test.ts`, `test/cli/code-gate-text-failed.test.ts`.
7. This notes file.

## Proposed spec text (the coordinator amends the spec)

### D1, last bullet

Replace "Without `--json` it prints the verdict line, then the functions that are not pass, one per line with their gap or measure, then the command for the JSON report." with:

> Without `--json` it prints the verdict line, then the functions that are not pass, one per line with their gap or measure, then the command for the JSON report. One exception (row 020-53, #210): functions with the gap `test-failed` whose loaders hold no failed test file, and that share the same failed files and tests, fold into one line after the other function lines when there are two or more of them: their count, `incomplete: a selected test failed outside their loaders:`, the first failed test as `<file> › <test>` and how many more failed, the first function, and that `--json` lists them all. One such function keeps its own line, whose gap words are `a selected test failed outside its loaders: <file> › <test>`, with `and N more failed tests` when more failed. A function one of whose loaders failed keeps its line with the words `a selected test failed`. The lines keep the report's order, and the folded lines follow the order of each set's first function.

### D5, after "Every `uncounted` path is a report row … So is a failed test."

> A selected failure blocks every function, whether or not the failed file loads it. The report names the failed files behind each `test-failed` gap and whether each is one of the function's loaders (D7, `functions[].failedTests`; row 020-53, #210), so a failure outside them does not read as the function's own. This changes no state.

### D7, add to the "Later sections add fields" paragraph

> Added 2026-11-13 (row 020-53, #210): `functions[].failedTests`, on each function whose gap is `test-failed`: every selected test file with a failed test, by path, each with `tests`, its failed tests sorted as in `runs[].failed`; `from`, where its evidence came from (`run`, `store` or `parts`, as in `runs[].from`); and `loader`, whether it is in the function's `loaders.expected`. Absent with any other gap, so a report with no failed test is as before. The state, the verdict and the quality policy version do not change.

### `commands.md` (three copies under `plugins/{claude-code,codex-runtime,pi}/skills/squeal/references/`), not owned by this row

- Line 148, the gap list: `test-failed` (a selected test failed) → `test-failed` (a selected test failed; `failedTests` in the JSON names each failed file and whether it loads the function, and the text says when the failure is outside its loaders)`.
- Line 159, after "then each function that is not `pass` with its gap or measure,": add "except that two or more functions blocked only by the same failures outside their loaders share one line after the others, with their count, the first failed test and the first function,".
- Line 172, in the `functions` list after `loaders (…)`: add "`failedTests` when the gap is `test-failed` (each selected test file with a failed test: `path`, its `tests`, `from`: `run`, `store` or `parts`, and `loader`: whether it is one of the function's loaders),".

## Decisions the spec did not settle, and my choice

1. **`rule.ts` is unchanged.** The brief's lead was to carry the failed files through `rule.ts:117`. The rule decides the state from a boolean, and the daemon's `crap/judge.ts` calls the same rule with `failed: false` (D11.2). The failed files that decide the gap are every failed selected file (D5.5 is run-wide), so the rule needs no list. The attribution is in the evaluator, which holds the files and each function's loaders.
2. **Added after D8's exceptions**, in `evaluate()`, on the final rows. A CC violation that an exception covers, with test-failed evidence, reads `incomplete` / `test-failed` only after `applyExceptions`; it gets the field too (test "names them on a CC exception's function …").
3. **"Loads the function" is `loaders.expected`**: the selected files that load its source, or may (closure not known). This is the brief's "is among its loaders". It is per source file, not per function.
4. **The field lists every failed file, outside or not.** The brief asks, for each failed test, whether it is a loader. Each entry has `loader`, so a reader filters either way. `tests` and `from` repeat `runs[].failed` and `runs[].from`, so one row reads alone.
5. **The JSON is not bounded per function.** Its size is the number of `test-failed` functions times the failed files and tests. #210 gives 138 × 1 entry. A broken shared helper could fail hundreds of files across hundreds of functions (several MB). The other JSON lists are not bounded either; I did not cap this one. If the coordinator wants a cap, the smallest change is to list only `loader: true` files in full and count the others.
6. **Field and type names**: `failedTests`, `GateFailedTests`. `failed` alone on a function would read as a boolean.
7. **Text words**: "a selected test failed outside its loaders: <file> › <test>". It holds the brief's "failed outside its loaders: <file> › <test>" and keeps today's lead words, so it still says why the function is blocked. The text does not say the origin (stores or parts); the JSON does. The stores' stderr line already counts reused files.
8. **Grouping key**: the same files with the same tests (`path` and `tests`). `from` is per file, so it adds nothing to the key. In one report every function with no failed loader has the same set, so in practice there is one folded line.
9. **The folded line names the first function** (`first: <path>:<line> <name>`), so a reader can find the group in the JSON. The parent's conditions did not ask for it and do not forbid it.
10. **Two new modules**, beside owned files: `src/core/code/gate/failed-tests.ts` (35 lines) and `src/cli/code-gate-text-failed.ts` (69 lines). `evaluate.ts` was already 321 lines and `report.ts` 335; the styleguide splits past about 300. No sibling owns them, so they cannot overlap. `evaluate.ts` grew by 4 lines and `report.ts` by 17 (the type and field).
11. **`test/version-sensitive.txt`** (shared, not owned): the new CLI test runs real `node --test` with V8 coverage, so `test/version-sensitive.test.ts` requires it in the list. Two lines in their own commit, as row 020-44 did (`c59b37487`). The parent was told (progress message).

## Type changes (all additive)

- `src/core/code/gate/report.ts`: new `GateFailedTests` (`path`, `tests`, `from`, `loader`); `GateFunctionReport.failedTests?: readonly GateFailedTests[]`.
- `src/core/code/gate/failed-tests.ts` (new): `failedFiles(files)`, `withFailedTests(fn, failed)`.
- `src/cli/code-gate-text-failed.ts` (new): `outsideWords(f)`, `foldOutside(functions)`.
- `types.ts` and `rule.ts`: unchanged.

## Done-when mapped to tests

| Done-when | Test |
| --- | --- |
| #210's shape reads `test-failed` with the failure named as outside its loaders | `test/code/gate/evaluate-failed-tests.test.ts` "names an unrelated failure as outside the loaders of a passing, fully covered callback (#210)"; end to end over real node:test, `test/cli/code-gate-failed-outside.test.ts` (JSON `loader: false`, text line "a selected test failed outside its loaders: test/b.test.mjs › unrelated base test"); text alone, `test/cli/code-gate-text-failed.test.ts` "says so on the line of the one function it blocks (#210)" |
| A failure in its own loader reads as its own | `evaluate-failed-tests.test.ts` "names a failure in one of its own loaders as its own, beside one outside, by path" (`loader: true`); `code-gate-text-failed.test.ts` "reads as before when one of its own loaders failed, even beside a failure outside" |
| Stored and parts failures name their origin | `evaluate-failed-tests.test.ts` "names the stores and the parts as the origin of a reused failure"; `code-gate-failed-outside.test.ts` second run: `runs[0].from` both `store`, entry `from: "store"` |
| Verdict, exit code and policy version unchanged | `code-gate-failed-outside.test.ts`: exit 3, `verdict: incomplete`, `qualityPolicy: 4` on each run; `evaluate-failed-tests.test.ts`: `QUALITY_POLICY_VERSION` is 4, verdict and counts; the pre-existing state tests (`evaluate-verdict.test.ts` "keeps a CC violation a violation when a test failed", `evaluate-golden.test.ts`, `parity.test.ts`) are unchanged and pass |
| Bounded text, one line per group | `code-gate-text-failed.test.ts` "folds several functions with the same failed tests into one bounded line after the others" and "gives one line per set of failed tests, in the order of each set's first function" |
| No field where it does not apply | `evaluate-failed-tests.test.ts` "adds nothing when no selected test failed, or to a function with another gap or state" (pass, `no-loader`, CC violation) |

The done-when line most likely to be false was "stored failures name their origin": the stores restore a failed file with `from: store` (`gate/stored.ts:evidenceAt`), and a mistake there would only show on a second run. The CLI test runs the gate twice on the same bytes and reads the stored entry.

## Checks run

- `pnpm run lint` (biome check .): exit 0, 3,344 files, no fixes.
- `pnpm run typecheck` (tsrs --fast --noEmit): exit 0, after each source commit.
- `squeal status --wait` on each new test at its revision, red first: `evaluate-failed-tests.test.ts` failed 3 of 4 at revision 2 (no field), passed at revision 4 and with the exception case at revision 6; `code-gate-text-failed.test.ts` failed 3 at revision 7 (no wiring), passed at revision 10; `code-gate-failed-outside.test.ts` passed at revision 12 (a real two-run node:test gate, 5.4 s).
- `test/version-sensitive.test.ts` failed at revision 12: the new CLI test runs node:test and was not in `test/version-sensitive.txt`. Listed (commit 5), it passed at revision 13.
- `squeal code` on the changed sources: every function at CC 8 or under; the new ones at CC 5 or under.
- Affected-test verdict: `squeal status --wait 280000 $(git diff --name-only 029499709..HEAD -- src test)` at revision 15 (commit `e9b7da38e`; the only later change is this notes file): 348 test files selected. 342 pass. 4 tests fail, all bundle drift (`cli/squeal.mjs differs from the build`, seen at revision 14): `test/harness/plugin.test.ts`, `test/harness/codex/packaging/runtime.test.ts`, `test/harness/opencode/package.test.ts`, `test/harness/pi/package.test.ts`. Still pending at 18:48 (local), queued for CPU with the host at 22 of 24 cores in use: `test/cli/code-gate-keep.test.ts`, `test/daemon/drain-wait.test.ts`, and the four bundle tests' rerun. No pending file is reported as passing here.

## Checks not run

- No full suite and no `pnpm run build` (wave rule). The bundles are not rebuilt, so the four bundle tests above fail on drift until the coordinator rebuilds at integration.
- The research probe (`research/probes/issue-210/probe.mjs`) was not rerun: it calls an installed CLI, not this tree. `test/cli/code-gate-failed-outside.test.ts` runs the same shape with this tree's code.
- No test with a real `--parts` failure end to end; the `parts` origin is covered at the evaluator (`evaluate-failed-tests.test.ts`), where it is read from `TestFileEvidence.from` as the stores' is.

## For the coordinator and the next worker

- Row 020-54 adds one field to `report.ts` (`runs[].retried` or similar, in `GateRunReport`). Mine is in `GateFunctionReport` plus a new interface right after it. The two hunks are apart; a merge conflict, if any, is textual.
- The bundles (`plugins/claude-code/dist` and the others) are not rebuilt (wave rule: no build in a worker tree). The bundle tests that compare `cli/squeal.mjs` with the build fail on that drift until the coordinator rebuilds at integration.
- Not done here: #200's recovery hint for a stored failure, and any load attribution (row 020-54).
