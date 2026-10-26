# 015-64 notes: switches for the coverage checks, an exclude, and the code features on by default

Worker d211a86b, 2026-10-26. Brief: `tasks/wave-12.md` W1. Shape: slice. Starts from main at `1ddf0eaf4`. Two agreements with the coordinator: `5f3cdd7e` (the store's `removeMeasure` takes optional paths) and `a3056400` (option (a): this row adds the delivery's summary line itself).

## What changed

- **Policy** (`src/core/types/policy.ts`, `src/core/daemon/policy-code.ts`). New keys `coverage.untested` (default `true`), `coverage.exclude` (default `[]`) and `crap.enabled` (default `true`). `complexity.enabled` and `coverage.enabled` default to `true`. The loader checks the new keys as it checks the others. Nothing new goes into a key: the switches and the exclude act only where the coverage step judges, so `user_version` and every result key stay as they are. As before, `coverage.enabled` changes the Vitest keys, so a project with no config re-keys its Vitest checks once when it upgrades.
- **The checks** (`src/core/code/crap/checks.ts`). `coverageChecks(policy)` gives the measures judged (`crap` with `crap.enabled`, `uncovered` with `coverage.untested`) and the `coverage.exclude` matcher. `applyChecks` runs at the start of each step, against what the summary was judged with:
  - The summary keeps `checks` (absent means both, as an older Squeal wrote it) and `exclude` (absent means `[]`).
  - A check switched off loses every state of its measure. A file newly excluded loses its `crap` and `uncovered` states and its evidence, and keeps its complexity state with its edit mark. This uses `removeMeasure(worktreeId, measure, paths)`, agreement `5f3cdd7e`. No transition is recorded, so view rows go quietly.
  - When states went, the step writes the code meta record `coverageChange:<worktreeId>` = `{ revision, at, off, excluded }`. `deleteSummary` deletes it with the rest.
  - The summary is written at once, with the checks it kept, so a later step removes nothing again.
  - A check switched on, or a file no longer excluded, makes the step seed and judge as a recount does: a pending state for each function that has no state of that measure, and each file stays quiet until it is judged. So the first judgement tells nothing. `checks` and `exclude` reach the summary only when the step that judges after the seed writes it. Until then, each step sees the change and seeds again. The seed is the one in the cache, so the work is not done twice.
  - With both checks off, the step removes every D9 state and evidence, writes the summary with `checks: []` and `files: {}`, and judges nothing. Coverage records are still taken while `coverage.enabled` holds (see Residue).
- **The seed, the walk, the judgement.** `Seed` takes the checks: `known` is read per measure, only the measures on are seeded, and an excluded file is never seeded, also when a function moves into it. `judgeFiles` judges only `JudgeContext.measures`. The step lists files without the excluded ones. `thresholdAfter` records no CRAP recount while `crap.enabled` is off.
- **The code pass** (`src/core/code/pass/index.ts`). `checksOf(policy)` keeps the checks of the last policy it saw. When they change, the pass steps at once, with no new result needed, and drops a seed it had begun. This is a separate closure, so `coverageStep` stays at complexity 20.
- **Delivery**, agreement `a3056400`, standalone commit `d6a629b17`. `CodeNews.coverageChange` is optional. `codeStep` tells it once, beside the recount and the CRAP recount, through the new `summaryNews`, and seeds the view again by count. The text is `Coverage checks changed: CRAP off (crap.enabled); untested off (coverage.untested); 12 files no longer checked (coverage.exclude).`, with only the parts that apply. `coverageChangeLine` is one more spread in `codeLines`. Nothing else in `src/core/delivery/**` changed. `codeStep` went from complexity 20 to 9.
- **Status** (`src/core/status/code-status.ts`, `src/core/code/crap/status.ts`). The coverage line names only the checks that are on and says `untested`. Examples: `Coverage: 1 function over CRAP 30, 1 untested; ...`, `Coverage: 1 function untested; ...`, and `Coverage: no check is on: crap.enabled and coverage.untested are false.` with both off. `CodeCoverageStatus.checks` is optional and absent when both checks are on. While coverage is off, `CodeStatus.withoutCoverage` names the keys of the checks that `squeal.config.json` sets to `true`, and status shows one line: `Coverage is off (coverage.enabled is false), so crap.enabled and coverage.untested do nothing.`
- **`squeal code`** (`src/cli/code-coverage.ts`). It says `untested: no test runs it in its own process` where it said `NOT_REACHED`. An excluded file's functions end with `; coverage not checked (coverage.exclude)`. A check that is off is not shown. The head without paths is `CRAP: 2 functions over 30; 1 function untested; ...`, or `Coverage: ...` when CRAP is off. The CLI no longer imports `NOT_REACHED` from the delivery, so W2 can change it or remove it. The off message is now `Complexity is off: complexity.enabled is false in squeal.config.json.`
- **This repository** (`squeal.config.json`). `coverage.exclude` is `["test/**"]`.
- **Docs.** The skill's `references/policy.md`, three identical copies: `complexity.enabled` defaults to `true`, and a Coverage section lists the five keys.

## Decisions the spec did not settle

1. **"Set" while coverage is off.** Both sub-checks default to `true`, so status names a key only when `squeal.config.json` itself sets it to `true`. It reads the file for that. A key left unset, or set to `false`, is not named. Without this rule, every project that turns coverage off would see the line all the time.
2. **The status line names the sub-checks only while complexity is on.** With `complexity.enabled` false, status has no code part, so goal 1's "status is the one before" holds.
3. **A second change before the first is told** writes over the record, as the CRAP recount does. A session told late sees only the latest change.
4. **`squeal code --json` type change, not additive.** `CodeReportCoverageOf.crap` and `.uncovered` are optional now: each is absent while its check is off. `excluded?: true` is new. Nothing in this repository reads that JSON. Every other type change is additive: `CoverageStepInput.checks?`, `JudgeContext.measures?`, `CoverageSummary.checks?` and `.exclude?`, `CodeNews.coverageChange?`, `CodeStatus.withoutCoverage?`, `CodeCoverageStatus.checks?`, `CodeReportCoverage.checks?`, and `removeMeasure`'s optional `paths`.
5. **The excluded globs come from the summary in `squeal code`**, not from the policy, so the command shows what the store judged.
6. **Test helpers** (the coordinator's choice). `test/helpers/policy.ts` holds `CODE_OFF`, `POLICY_CODE_OFF` and `codeOff(root)`.
   - `policyOn()` and `ON` keep coverage off. The crap rig's `COVERED` spreads the full coverage defaults.
   - `runMissingConfig` adds `CODE_OFF` unless its text names `complexity` or `coverage`.
   - `createFixtureRepo` commits a `CODE_OFF` config unless the test gives its own.
   - The harness `policy()` writer merges `CODE_OFF` unless the policy names those keys.
   - `fakeRepo` and `squealRepo` write no config, since many tests are about a repository that is not set up. The tests among them that assert a whole status or registration call `codeOff(root)`.

## Residue for whoever continues

- **Older Squeal versions.** Until a release has this row, a Squeal from before it reads `coverage.exclude` in this repository's `squeal.config.json` as an unknown key. Status shows `Config problem: squeal.config.json: unknown key "coverage.exclude"`, and the daemon notes it. The key is then ignored, and coverage stays on. The coordinator may land the config line after the release.
- **Both checks off.** With both checks off and `coverage.enabled` true, Vitest runs still take coverage and store records, because `coverageOn` (the key path) does not read the sub-checks. Switching that off would need a validity case, since it changes keys.
- **Pruning.** `coverageChange:<worktreeId>`, like `crapRecount:<worktreeId>`, is not pruned for a dead worktree: `COVERAGE_META_OF_DEAD` matches `coverage:%` only. It is one small row per worktree.
- **"Chunked as the other path filters are."** The code store's path filters pass one `json_each` parameter, so they have no chunk boundary. The store test uses 40,000 paths, past SQLite's 32,766 bound parameters.
- **Checks still unknown at the time of this report.** These tests read the policy defaults through a config they write themselves, or start real daemons, and may still show the flip. Squeal had about 800 queued test files after the policy edit.

## Repair R14: review 0.1.337 B1

**Defect.** With `coverage.exclude` unchanged, `applyChecks` returns early, and `states.move` carries every measure and its views. So a function an edit moved into a file the exclude already matched kept its `crap` and `uncovered` states, and the step never judged that file again to remove them.

**Owner of the rule: the move.** A new `moveChecks(store, worktreeId, moves, excluded)` in `src/core/code/crap/checks.ts` makes an edit's moves. Both edit passes call it: `editEnd` (`pass/edit.ts`) and `stagedEditEnd` (`pass/stage-edit.ts`). After the moves, it removes the `crap` and `uncovered` states of each destination that `coverage.exclude` matches, through `removeMeasure(worktreeId, measure, paths)`. The pass gets the matcher in the new optional `PassContext.coverageExcluded`. The daemon's code pass sets it from the checks it already keeps (`checksOf(policy).excluded`).

Why the move and not the step:
- The move is the only way a coverage state enters a file. The seed skips excluded files, and the judgement lists only files that are not excluded.
- The move runs in the edit pass's one transaction, so no reader sees coverage states in an excluded file, also between the pass and the next coverage step.
- The step finds changed files by comparing them with its summary, and an excluded file is not in the summary. For the step to see an excluded file change, it would have to keep blobs for excluded files (a store change) or list the states of every excluded file at each step (a scan). The move touches only the destination paths of that edit's moves.

What stays and what goes:
- The complexity state stays, with its identity: the moved row, its `changedAt` and its complexity history. Its edit mark also stays.
- The coverage history the move carried stays as history, as at an exclude change. No transition is added.
- The delivery drops the coverage views quietly at its next delivery, because their states are gone and their last transition is older than what the session was told.
- No change record is written and no summary line is told: the exclude did not change.
- No store, schema, key or text change.

**Tests.**
- `test/code/crap/excluded-move.test.ts`: the review's probe through the rig, through the edit pass and the staged edit pass (`partFiles: 1`). `made` is over complexity 20 and added by an edit after the first count, so it has real complexity, `crap` and `uncovered` transitions and views before the move. After the move the test asserts:
  - only the complexity state at the destination;
  - no coverage transition beyond the history the move carried;
  - only the complexity view;
  - nothing told, and no change record;
  - a complexity state and history equal to those of the same move with no exclude, and the source's `changedAt`.

  The rig's `edit` now takes `PassContext` options.
- `test/code/crap/pass.test.ts`: the same move through the daemon's code pass with the policy's exclude. It fails when the daemon does not give the pass the matcher.

**Residue.**
- If `coverage.exclude` changes in the same pass that moves a function into a newly excluded file, the move removes that file's coverage states first. The change line's "N files no longer checked" can then count that file out.
- A function moved out of an excluded file into a checked one has no coverage state. I expect the step to judge it as a function an edit added, so a failing one is told. No test covers this case.
