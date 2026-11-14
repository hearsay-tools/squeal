# Row 020-61 notes: the left-out line names `--test <file>` (#203)

Worker 344bc830, 2026-11-14. Shape: slice. Brief: `tasks/wave-22.md`, "## 020-61".

## What changed

1. **Verdict line.** After the per-group `--group` words, the verdict line adds the
   `--test` command for each edited test file the scope left out. Example:

   ```text
   ... browser (manual) did not run: 100 test files load changed code; add --group browser to run them. To run only the edited test file of them, add --test e2e/target.test.ts; the other selected test files in scope still run, with their setup.
   ```

   It names at most three files, sorted by path; the rest read
   `(N more edited test files: --json lists them under loaders.leftOut)`.
   With no edited test file left out, the line is as before.
2. **Pre-run count after `--test`.** The scope tally counts a file of a
   left-out group that ran because `--test` named it apart, as the new
   optional field `scope.leftOut[].tests`. The pre-run line now reads, for
   example, `browser (manual) is left out: 1 of its 3 test files runs by --test; none of the other 2 loads changed code`.
   Before, it read `none of its 3 test files loads changed code`, although the
   named file loaded changed code and ran. When `--test` named every file of the
   group: `its 1 test file runs by --test`.
3. **Split.** The left-out words (`loadsChangedText`, the new
   `leftOutCountText`, `leftOutText`) moved to the new file
   `src/cli/code-gate-text-left-out.ts`, so `code-gate-text.ts` stays under
   300 lines (it was at 321 with the change). Biome refuses re-exports
   (`noBarrelFile`), so `code-gate-prerun.ts` imports from the new file.

## Decisions

- **Where the edited files come from.** The text derives them from the report
  alone: a changed function whose `loaders.leftOut` holds its own path is in an
  edited test file the scope left out (D14.2, `leftOutLoaders` lists a changed
  test file as its own loader). This needs no change to `collect.ts` (row
  020-59 owns it) and no new field. Limit: an edited test file with no changed
  function, or whose functions `coverage.exclude` matches (they read
  `skipped`, with no `loaders.leftOut`), gets no `--test` advice. Both cases
  leave no function incomplete because of that file.
- **One sentence, not one per group.** The report does not map a left-out
  file to its group, so the `--test` advice is one sentence after the group
  sentences, not inside each group's sentence. A per-group form would need the
  group of each file in the report (for example `scope.leftOut[].edited`),
  which needs the changed paths in the tally (`collect.ts`).
- **What still runs.** The advice says the other selected in-scope files still
  run, with their setup, as the board's 020-61 row asks: `--test` adds a
  file; it is not an exclusive selection (research `issue-203.md`, findings 1
  and 2).
- **Ownership (asked, request b546ea95; the parent replied "the first
  option").** The wrong count is in the pre-run line, built in
  `src/cli/code-gate-prerun.ts:leftOutLine`, outside this row's ownership.
  The parent agreed to: the optional `tests` field in `scope.ts`, the count
  words in the text module, and the edit in `code-gate-prerun.ts` in its own
  commit. The meaning of `files` does not change. The parent said "export
  leftOutCountText from code-gate-text.ts"; it is exported from the split-off
  `code-gate-text-left-out.ts` instead (see "Split" above).

## Type changes

- `LeftOutGroup` (`src/core/code/gate/scope.ts`) gains `readonly tests?: number`:
  of the group's test files, the ones that ran because `--test` named them;
  not among `selected`; absent when none did. It is additive. It reaches the
  gate's JSON report as `scope.leftOut[].tests` (D7) through `GateReport.scope`.
  It is a gate report field, not a `RunReport` field, so `report-merge.ts`
  needs no rule.
- New exports: `leftOutCountText(group)` and `leftOutText(report)` in
  `src/cli/code-gate-text-left-out.ts`; `loadsChangedText` moved there from
  `code-gate-text.ts`.

## Proposed spec text

D14.3, append:

> Amended 2026-11-14 (row 020-61, #203): when a left-out group holds an edited
> test file that did not run, the verdict line adds the `--test` command for
> it after the groups, at most three by path, for example `To run only the
> edited test file of them, add --test e2e/target.test.ts; the other selected
> test files in scope still run, with their setup.` A `--test` file always
> runs (D14.1), and the other selected in-scope files and their setup still
> run. Per left-out group, `scope.leftOut[]` gains `tests`, the group's files
> that ran because `--test` named them; they are not among `selected`; absent
> when none did. The pre-run line counts them apart, for example `browser
> (manual) is left out: 1 of its 3 test files runs by --test; none of the
> other 2 loads changed code`. Verdict, exit code and `QUALITY_POLICY_VERSION`
> do not change.

D7, the "Later sections add fields" paragraph, append:

> Added 2026-11-14 (row 020-61, #203): `scope.leftOut[].tests` (D14.3).

## Done-when mapped to tests

| Done-when | Test |
| --- | --- |
| An edited spec in a left-out group prints the `--test` command for it | `test/cli/code-gate-text-left-out.test.ts`, "names --test for the edited spec beside --group, and what still runs"; "names each edited test file once, by path, and at most three" |
| After `--test` the count line is right | `test/code/gate/scope.test.ts`, "counts a --test file of a left-out group apart from the files it left out"; `test/code/gate/collect-scope.test.ts`, "runs it, setup included, with --group browser or with --test" (expects `tests: 1`); `test/cli/code-gate-text-left-out.test.ts`, "after --test, says which files ran and counts only the others" and "counts what was left out, not the file --test ran" (through `preRunText`) |
| Groups with no edited test file print as today | `test/cli/code-gate-text-left-out.test.ts`, "prints as before when no edited test file was left out", "names each left-out group ..." and "names none ..." (moved from `code-gate-text.test.ts`); `leftOutCountText` "counts the selected files it left out, as before"; `test/code/gate/scope.test.ts`, "gives no tests count when no --test file is in the group"; the unchanged expectation in `test/cli/code-gate-prerun.test.ts:77` |

The D14.3 block of `test/cli/code-gate-text.test.ts` moved to the new test
file; it is not duplicated.

## Checks

Run:

- `pnpm run typecheck`: passed (no output from `tsrs --fast --noEmit`).
- `pnpm run lint`: passed after removing a re-export (`noBarrelFile`):
  "Checked 3424 files ... No fixes applied."
- `squeal status --wait 60000` on the seven named test files
  (`code-gate-text-left-out`, `code-gate-text`, `scope`, `collect-scope`,
  `code-gate-prerun`, `code-gate-prerun-text`, `code-gate-scope`): at revision
  9, "no known failures; 7 test files, each with a current result".
- `squeal status --wait 60000` on the four changed source files, four
  times, last at revision 12: 22 pass, 0 known failures, 343 queued "waiting
  for CPU" (the host had 22–23 of 24 cores in use; load average 53/44/29).
  These 343 files have no verdict from this worker; CI runs them.
- Because the queue did not move, a direct run of the other gate tests that
  assert scope words or counts:
  `pnpm exec vitest run --maxWorkers=2 test/code/gate/collect-prerun.test.ts test/code/gate/collect-scope-prepare.test.ts test/code/gate/evaluate-scope.test.ts test/code/gate/lanes-retry.test.ts test/code/gate/plan.test.ts test/code/gate/setup-selection.test.ts test/cli/code-gate-args.test.ts`:
  "Test Files 7 passed (7), Tests 78 passed (78)".

Not run: `pnpm run build` (the wave header forbids it in a worker tree;
`plugins/claude-code/dist` is not this row's), a full suite (process rule),
e2e tests (`test/e2e/**`; none touches this text).

## For the next worker

- Commit 901dad514 alone does not typecheck: it moves `loadsChangedText`, and
  `code-gate-prerun.ts` imports it until 96a4c8d51. Land the two together.
- `commands.md` (shipped skill reference) already says "`--test` files run
  whatever their group"; no text change is needed there for this row.
- A per-group `--test` advice, and `--test` in the JSON `add`, need the changed
  paths in `tallyScope` (`collect.ts:select`, row 020-59's file).
