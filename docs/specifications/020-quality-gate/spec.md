# 020 One quality gate: a one-shot check of changed functions

Stage: draft, for the human's review (2026-11-09). Issue [#167](https://github.com/hearsay-tools/squeal/issues/167). Research: `../015-coverage-complexity/research/quality-gate.md` (row 015-126) and `research/issue-167.md`.

## Problem

Cezar has its own pre-PR quality check. It has its own complexity counter, coverage matcher and CRAP score, separate from Squeal's. It refuses several kinds of change that it cannot measure. In 13 runs, agents lost about 9.8 hours to it (hearsay-tools/cezarion#3096). Squeal already counts complexity and measures coverage per function (spec 015). But it has no command that gives a pass/fail verdict. `squeal code` reads only what the daemon stored, judges against the agent session and needs a daemon.

The human accepted these product rules in #167:

- Changed JS/TS functions against the PR target are checked, nested functions and test callbacks included.
- CC ≤ 20 and CRAP ≤ 30; equality passes. Unchanged debt stays outside the gate.
- Unknown, stale, missing or partial evidence never passes. Failed tests block.
- The default budget is 600 s in total, with an override.
- Exceptions are verified, and they keep the measured scores.

The human also accepted that one engine and one evaluator serve the daemon, a local pre-PR command and CI. The architecture was left to this repository's design process.

## Goals

First slice (this spec's rows 020-01 to 020-05):

1. `squeal quality --base <ref>` runs with no daemon, no agent session and no store. It measures every JS/TS function that changed between the merge base of `<ref>` and `HEAD` and the working tree, and exits with one verdict: pass, violations or incomplete (D1, D6).
2. A moved function with the same body is not a change. A test callback whose position number moved because a same-named function was added before it is not a change (D2).
3. Changed functions in test files are measured, and so are nested functions (D2).
4. The command selects test files from the import graph and from `--test <file>...`. It runs them under Vitest and node:test with Squeal's coverage provider, inside one total budget, 600 s by default. It keeps every completed file's record when the budget ends and names the files that did not finish (D3).
5. A changed function in a file that no test loads reads `incomplete` (no test loads it), never a CRAP score from 0% coverage. A failed test makes the verdict `incomplete` (D5).
6. The three arrow shapes that do not join today are joined: `x => (expr as T).field`, the inner arrow of a curried call chain, and the innermost of three arrow stages. The daemon's coverage states use the same join (D4).
7. The JSON report is versioned. It carries the engine, counter, coverage and policy versions, the base and head commits, each file's blob, each function's identity, body hash, measures, evidence and gaps, and the verdict (D7).
8. The same inputs give the same report, apart from times. A golden test proves it (D5, Testing).

## Non-goals

These are later slices of this spec. Each one needs the human's approval before its rows start (the research's slice table):

- The daemon calling the evaluator, and the gate reusing the daemon's current records (slice 2, 3 rows). Until then the daemon keeps 015's rules: test files are not counted, and a file with no loader reads from 0%. Spec 015 D1 and D9 are unchanged outside this command.
- CI evidence: `ci record` adding Squeal's provider and the gate reading its parts (slice 3, 4 rows). This reverses 018's non-goal "Squeal's coverage provider in CI" and D8.
- Exceptions: inherited debt and owner-approved growth (slice 4, 2 rows).
- Coverage from child processes (slice 5, 2 rows; reverses 015's non-goal). Browser-mode coverage (not researched).
- A documented pinned runtime for CI (slice 6, 1 row). The tag clone and the runtime asset checked by SHA-256 already work (research Q7).
- Python. Line-level test selection.
- Any change in cezar. Cezar's own checks stay until cezar replaces them (hearsay-tools/cezarion#3096).

## Design

### D1. The command

```
squeal quality --base <ref> [--test <file>...] [--timeout <seconds>] [--json]
```

- `<ref>` is the PR target, for example `origin/main`. The base is `git merge-base <ref> HEAD`. The head is the working tree; the report records `HEAD` and whether the tree was dirty (as 018's export does).
- It needs neither `complexity.enabled` nor `coverage.enabled`, because it is an explicit command. It reads the runner settings from `squeal.config.json` in the usual way.
- It starts no daemon. If a daemon runs, the command neither talks to it nor uses its store (that is slice 2).
- Exit codes: `0` pass, `1` violations, `3` incomplete, `2` usage or setup error. A CI step can therefore tell "fix the code" apart from "evidence is missing".
- Without `--json` it prints the verdict line, then the functions that are not pass, one per line with their gap or measure, then the command for the JSON report.

### D2. Changed functions

1. Paths: `git diff --name-only <base>` against the working tree, plus untracked files that are not ignored. Only JS/TS files that 015's counter supports.
2. Each path is counted at the base blob and at the head bytes, with 015's counter (D3 of 015), test files included. The counter skips a file over `maxFileBytes` and code inside a parse error. A changed function that falls there reads `incomplete` ("not counted").
3. Identities are 015 D2's `(path, qualified name, occurrence)` with the body hash.
   - Unchanged: the same identity and the same body hash at the base.
   - Moved: a head function whose body hash is at the base in any path of the diff. It is not a change.
   - Shifted: inside one `(path, qualified name)` group, a head function whose body hash equals a base function of that group. It is not a change.
   - Every other head function is changed (edited or added). Moved and edited reads as added and is measured. That is the safe side.
4. Removed functions are not checked.

### D3. Collection

1. Selection: for each changed source, the test files whose import closure loads it (each runner adapter's `affected()`), plus every changed test file, plus `--test` files. A path given with `--test` that matches no runner is a usage error.
2. Runs: one adapter run per runner (Vitest, node:test), with Squeal's coverage provider, as 015 D8 runs them. Records are mapped before `adapter.close()`.
3. Loaders: from each run's `closure()`, not from a store.
4. Budget: one deadline over all runs, 600 s by default, `--timeout` to change it. At the deadline, the running file is stopped. Every completed file keeps its record. The report names each file that did not finish. The command does not lower a project's own `testTimeout`.
5. Nothing is written to the project or a store. Temporary files go under `$TMPDIR` and are removed.

### D4. The join repair

`src/core/code/crap/join.ts` matches V8 function ranges to counted functions by their end column, with a 2-column slack. Three shapes fail (research Q5):

- A cast: V8 sees the cast in the end column, and the counter does not (end 47 against 52).
- Two or three nested arrows that end at the same column: only the outer one joins.

The repair matches nested functions that share an end by nesting depth and start. A cast-expression arrow matches by its start. A function the repair cannot match stays `ran: null` (unknown), as today. It is never matched to a wrong range. The daemon uses the same join, so some functions that read unknown today get a measure. That is the only daemon change in this slice.

### D5. The evaluator

`evaluate(functions, evidence, policy) → report` is a pure function in `src/core/quality/`. It has no I/O.

A changed function's evidence is **complete** when all of these are true:

1. It was counted (D2.2).
2. At least one selected test file loads its source, and each loading file's closure is known.
3. Each loading test file completed whole, with a record at the current provider and record versions and the source at the head bytes.
4. The join resolved it.
5. No selected test failed.

Then:

- **pass**: complete, CC ≤ max, CRAP ≤ max. A pass may also be proven from a subset of the loading files, by 015 D9's bound: the CRAP from the records in hand is an upper bound. It is still not a pass while a selected test failed.
- **violation**: complete, and CC > max or CRAP > max. CC alone needs only the count. A function over the CC limit is a violation whatever its coverage.
- **incomplete**: every other case. Each one names its gap: `not-counted`, `no-loader`, `not-finished`, `no-record`, `not-joined`, `test-failed`.

The verdict is `violations` when any function is a violation. Otherwise it is `incomplete` when any function is incomplete, and `pass` when all pass. Equality passes. Measured rows are kept in every case.

### D6. Policy

The limits are `quality.maxComplexity` (default 20) and `quality.maxCrap` (default 30) in `squeal.config.json`. They are read **at the base commit**, so a branch cannot loosen its own gate. The 95% CRAP cutoff and 015's own-line coverage are fixed. `QUALITY_POLICY_VERSION = 1` names these rules, and any change of their meaning raises it.

### D7. The report

`--json` writes one object, `format: "squeal-quality/1"`:

- `versions`: the Squeal version, `COUNTER_VERSION`, `COVERAGE_PROVIDER_VERSION`, `COVERAGE_RECORD_VERSION`, `QUALITY_POLICY_VERSION`.
- `base`: the ref, the merge-base commit and the policy values read there. `head`: the commit, whether the tree was dirty, and each changed path with its blob hash.
- `functions`: per changed function, the identity, the body hash, the change kind (`edited`/`added`), CC, own-line coverage, CRAP, the state, the gap, and the loading test files expected and measured.
- `runs`: per runner, the test files selected, completed and not finished, and the failed tests.
- `verdict` and the counts of each state.

The report contains no times other than `createdAt` and run durations, so the golden test can compare everything else.

## Testing

- Evaluator golden tests (020-01): limits and equality for CC and CRAP, CC over limit with no coverage, pass from a subset, violation that needs every loader, every gap, a failed test, verdict precedence. The same input twice gives the same report.
- Inventory (020-02): fixture repositories under `test/` with edited, added, moved, shifted, moved-and-edited and removed functions, test callbacks, and a file over `maxFileBytes`.
- Collection (020-03): fixture projects for `vi.mock` factories, node:test `.ts`, mixed Vitest and node:test, a file no test loads, and a short-budget fixture where one file finishes and one does not (a deterministic sleep, not host load).
- Join (020-04): the three arrow shapes from the research's `cases.mts`, plus regressions that every function joined today still joins to the same range.
- CLI (020-05): an end-to-end run in a temporary git repository for each exit code, with no daemon, `HOME` and `TMPDIR` set to a temporary directory.

## Open questions

1. **Functions Squeal cannot measure in slice 1** (the human). Examples are code that tests reach only through a child process (cezar: 14 of 314 changed functions in its last 10 PRs, in 2 PRs), and browser-mode test specs (20 of 314). Under D5 these read `incomplete` and block the verdict until slice 5 or later. The alternative is a project-level list in `squeal.config.json`, read at the base, of paths the gate does not measure. The report would name those paths, and they would never count as pass.
2. **Slice 2 timing** (the coordinator, after slice 1's dogfood): whether the daemon's `squeal code` moves to the evaluator at once or keeps 015's session view beside it.

## References

- #167; hearsay-tools/cezarion#3096; related #125, #144, #149, #165.
- Research: `../015-coverage-complexity/research/quality-gate.md`, `issue-167.md`.
- Spec 015 D1, D2, D3, D8, D9; spec 018 D8, D10 and its Non-goals.
