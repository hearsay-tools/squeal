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
   left-out group that `--test` named apart, as the new optional field
   `scope.leftOut[].tests`. The pre-run line now reads, for example,
   `browser (manual) is left out: 1 of its 3 test files is named by --test; none of the other 2 loads changed code`.
   Before, it read `none of its 3 test files loads changed code`, although the
   named file loaded changed code. When `--test` named every file of the
   group: `its 1 test file is named by --test`. (Repair R1 changed "runs by"
   to "is named by"; see below.)
3. **Split.** The left-out words (`loadsChangedText`, the new
   `leftOutCountText`, `leftOutText`) moved to the new file
   `src/cli/code-gate-text-left-out.ts`, so `code-gate-text.ts` stays under
   300 lines (it was at 321 with the change). Biome refuses re-exports
   (`noBarrelFile`), so `code-gate-prerun.ts` imports from the new file.

## Decisions

- **Where the edited files come from** (as repaired in R1, B2). The text
  derives them from the report alone: a changed path (`head.paths`) that some
  changed function lists in `loaders.leftOut`. `loaders.leftOut` holds only
  selected files the scope left out, so an edited test that ran in scope and
  an unchanged left-out test are never named. A data-only edit (no changed
  function in the test file) is named. This needs no change to `collect.ts`
  (row 020-59 owns it) and no new field. Remaining limit: an edited left-out
  test file that loads no changed function's source and has no changed
  function of its own is in no `loaders.leftOut`, so it gets no advice; then
  no function is incomplete because of it.
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
  of the group's test files, the ones `--test` named (selected to run); not
  among `selected`; absent when `--test` named none. It does not say a file
  ran: that is in `runs[]` (R1, B3). It is additive. It reaches the
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
> it after the groups, at most three by path, each path quoted for the shell
> when it needs it, for example `To run only the edited test file of them,
> add --test e2e/target.test.ts; the other selected test files in scope still
> run, with their setup.` An edited test file is a changed path of the head,
> whether or not a function in it changed; it did not run when a changed
> function lists it in `loaders.leftOut`. A `--test` file is always selected
> to run (D14.1), and the other selected in-scope files and their setup still
> run. Per left-out group, `scope.leftOut[]` gains `tests`, the group's files
> that `--test` named; they are not among `selected`; absent when `--test`
> named none. `tests` counts what was named, not what ran: a named file that a
> failed `prepare` or the budget stopped still counts, and `runs[]` says
> whether it ran. The pre-run line counts them apart, for example `browser
> (manual) is left out: 1 of its 3 test files is named by --test; none of the
> other 2 loads changed code`. Verdict, exit code and `QUALITY_POLICY_VERSION`
> do not change.

D7, the "Later sections add fields" paragraph, append:

> Added 2026-11-14 (row 020-61, #203; amended by repair R1 of review 0.1.490):
> `scope.leftOut[].tests`, per left-out group the files `--test` named; not
> proof that they ran, which `runs[]` holds (D14.3).

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

## Repair R1 (review 0.1.490 FAIL: B1, B2, B3)

Brief: `tasks/wave-22.5.md`, "## R1". Each blocker, its fix and its test:

| Finding | Fix | Test |
| --- | --- | --- |
| B1: a `--test` path with a space split in the shell | Each path goes through `shellWord` (`src/core/text.ts`), as the gate's other printed commands do | `code-gate-text-left-out.test.ts`, "quotes a path the shell would split ...": paths with a space and a quote go through `bash -c printf` and `parseGateArgs` and come back as the same two paths |
| B2: a data-only edit of a left-out test gave no advice | `editedLeftOut` reads changed paths (`head.paths`) that a changed function lists in `loaders.leftOut`, not changed function rows | Unit: "names a left-out test file edited outside its functions"; "never names an unchanged left-out test, nor an edited test that ran in scope". Integration: `test/cli/code-gate-scope.test.ts`, "names --test for a left-out spec edited outside its functions" (real `squeal code --base`, top-level edit only) |
| B3: `tests` claimed a file ran when its `prepare` failed | The brief's option: the field and its words say "named by --test", not "ran"; type comment, pre-run words and spec text changed; `runs[]` keeps whether it ran | `collect-scope-prepare.test.ts`, "counts a --test file whose prepare failed as named, not as run": prepare fails, the file is `notRun` and not completed, `tests: 1`; `leftOutCountText` and `preRunText` cases expect "is named by --test" / "are named by --test" |

Byte-identical when no edited left-out file: "prints as before when no edited
test file was left out", the moved D14.3 group cases, and the `tests`-absent
counts pass unchanged.

The candidate's shipped command references (`commands.md`), if the
coordinator wrote "ran because --test named them" there, need the same
wording change; they are not on this branch.

R1 checks:

- `pnpm run typecheck`: passed, no diagnostics.
- `pnpm run lint`: "Checked 3418 files in 2s. No fixes applied."
- `squeal status --wait 60000` on the three changed test files: at revision
  17, "no known failures; 3 test files, each with a current result".
- `squeal status --wait 60000` on the changed sources: 16 pass, 0 known
  failures, 349 pending (queued behind a running tier) at the deadline; no
  verdict for those.
- Direct run, because that queue did not finish:
  `pnpm exec vitest run --maxWorkers=2` on `scope`, `collect-scope`,
  `code-gate-prerun`, `code-gate-prerun-text`, `code-gate-text`,
  `collect-prerun`, `evaluate-scope`, `code-gate-text-left-out`,
  `code-gate-scope`, `collect-scope-prepare`: "Test Files 10 passed (10),
  Tests 64 passed (64)" (load average 34.7 of 24 CPUs).
- Not run: build (forbidden in a worker tree), full suite, e2e.

