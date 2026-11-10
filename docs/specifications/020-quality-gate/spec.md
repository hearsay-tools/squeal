# 020 One quality gate: `squeal code --base`, a one-shot check of changed functions

Stage: approved by the human 2026-11-09 (first slice; name `squeal code --base <ref>`; unmeasurable code through `coverage.exclude`). Issue [#167](https://github.com/hearsay-tools/squeal/issues/167). Research: `../015-coverage-complexity/research/quality-gate.md` (row 015-126) and `research/issue-167.md`.

## Problem

Cezar has its own pre-PR quality check. It has its own complexity counter, coverage matcher and CRAP score, separate from Squeal's. It refuses several kinds of change that it cannot measure. In 13 runs, agents lost about 9.8 hours to it (hearsay-tools/cezarion#3096). Squeal already counts complexity and measures coverage per function (spec 015). But it has no command that gives a pass/fail verdict. `squeal code` reads only what the daemon stored, and it judges against the agent session. It also needs a daemon.

The human accepted these product rules in #167:

- Changed JS/TS functions against the PR target are checked, nested functions and test callbacks included.
- CC ≤ 20 and CRAP ≤ 30; equality passes. Unchanged debt stays outside the gate.
- Unknown, stale, missing or partial evidence never passes. Failed tests block.
- The default budget is 600 s in total, with an override.
- Exceptions are verified, and they keep the measured scores.

The human also accepted that one engine and one evaluator serve the daemon, a local pre-PR command and CI. The architecture was left to this repository's design process.

## Goals

First slice (this spec's rows 020-01 to 020-05):

1. `squeal code --base <ref>` runs with no daemon, no agent session and no store. It measures every JS/TS function that changed between the merge base of `<ref>` and `HEAD` and the working tree, and exits with one verdict: pass, violations or incomplete (D1, D6).
2. A moved function with the same body is not a change. A test callback whose position number moved because a same-named function was added before it is not a change (D2).
3. Changed functions in test files are measured, and so are nested functions (D2).
4. The command selects test files from the import graph and from `--test <file>...`. It runs them under Vitest and node:test with Squeal's coverage provider, inside one total budget, 600 s by default. It keeps every completed file's record when the budget ends and names the files that did not finish (D3).
5. A changed function in a file that no test loads reads `incomplete` (no test loads it), never a CRAP score from 0% coverage. A failed test makes the verdict `incomplete` (D5).
6. The three arrow shapes that do not join today are joined: `x => (expr as T).field`, the inner arrow of a curried call chain, and the innermost of three arrow stages. The daemon's coverage states use the same join (D4).
7. The JSON report is versioned. It carries the engine, counter, coverage and policy versions, the base and head commits, each file's blob, each function's identity, body hash, measures, evidence and gaps, and the verdict (D7).
8. The same inputs give the same report, apart from times. A golden test proves it (D5, Testing).

## Non-goals

These are later slices of this spec. Each one needs the human's approval before its rows start (the research's slice table):

- The daemon calling the evaluator, and the gate reusing the daemon's current records (slice 2, 3 rows). Until then the daemon keeps 015's rules: test files are not counted, and a file with no loader reads from 0%. Spec 015 D1 and D9 are unchanged outside `--base`.
- CI evidence: `ci record` adding Squeal's provider and the gate reading its parts (slice 3, 4 rows). This reverses 018's non-goal "Squeal's coverage provider in CI" and D8.
- Exceptions: inherited debt and owner-approved growth (slice 4, 2 rows).
- Coverage from child processes (slice 5, 2 rows; reverses 015's non-goal). Browser-mode coverage (not researched).
- A documented pinned runtime for CI (slice 6, 1 row). The tag clone and the runtime asset checked by SHA-256 already work (research Q7).
- Python. Line-level test selection.
- Any change in cezar. Cezar's own checks stay until cezar replaces them (hearsay-tools/cezarion#3096).

## Design

### D1. The command

```
squeal code --base <ref> [<path>...] [--test <file>...] [--timeout <seconds>] [--json]
```

The human chose this name on 2026-11-09, over a separate `squeal quality`. `squeal code` already lists functions with their complexity, coverage and CRAP, so the gate is the same list with another scope and a verdict.

- `<ref>` is the PR target, for example `origin/main`. The base is `git merge-base <ref> HEAD`. The head is the working tree. The report records `HEAD` and whether the tree was dirty, as 018's export does. Paths narrow the changed functions to those files or directories.
- `--base` cannot be combined with `--changed` or `--told`, because they choose functions in other ways. Using them together is a usage error.
- Without `--base`, `squeal code` is unchanged: it reads the stores and runs nothing. With `--base`, it can run tests for up to the budget (D3). The help text says so on the first line of its entry.
- It needs neither `complexity.enabled` nor `coverage.enabled`, because it is an explicit command. It reads the runner settings from `squeal.config.json` in the usual way.
- It starts no daemon. If a daemon runs, the command neither talks to it nor uses its store (that is slice 2).
- Exit codes, as `squeal run <group> --wait` uses them: `0` pass, `1` violations, `3` incomplete, `2` usage or setup error. A CI step can therefore tell "fix the code" apart from "evidence is missing".
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
5. A changed path the counter cannot count is listed in `uncounted` with its reason: `too-large`, `parse-error`, or `unsupported` (not a regular file at the head). A `parse-error` path is also in `counted`, with all its head functions, so the join sees them. Its changed functions that overlap an error range are in `inErrors`. Every head function of each counted path is in `counted`, changed or not, because a function's own lines leave out the functions nested in it (amended 2026-11-09, rows 020-01 and 020-02).

### D3. Collection

1. Selection: for every changed path of the diff, after path narrowing, the test files whose import closure loads it (each runner adapter's `affected()`), plus every changed path a runner lists as a test file, plus `--test` files. A path given with `--test` that matches no runner is a usage error. A changed path counts here whether or not a function of it changed: a top-level edit of a test or a source file selects too (amended 2026-11-10, review 0.1.423 B1).
2. Runs: one adapter run per runner (Vitest, node:test), with Squeal's coverage provider, as 015 D8 runs them. Records are mapped before `adapter.close()`. The collector takes the adapter factories as arguments, and the CLI passes them, because nothing under `src/core/code` may import a runner (`test/runners/boundaries.test.ts`, row 016-36). Vitest runs with `cache: false`, so it writes no results cache into the project (amended 2026-11-09, row 020-03).
3. Loaders: from each run's `closure()`, not from a store.
4. Budget: one deadline over all runs, 600 s by default, `--timeout` to change it. At the deadline, the running file is stopped. Every completed file keeps its record. The report names each file that did not finish. The command does not lower a project's own `testTimeout`. Any selected file that did not finish makes the verdict at least `incomplete`: a test in it may have failed or may not have run (amended 2026-11-10, review 0.1.423 B2). Failures a runner already reported for an unfinished file are kept in the report when the adapter gives them; the verdict does not depend on it.
5. Nothing is written to the project or a store. Temporary files go under `$TMPDIR` and are removed.

### D4. The join repair

`src/core/code/crap/join.ts` matched V8 function ranges to counted functions by their end column, with a 2-column slack. It missed every arrow whose last token is longer than the slack. The cause is not the cast: `coverage/map.ts` maps a V8 function's end to the start of the source-map segment that holds its last character, so the record's end is the start of the last token (amended 2026-11-10, row 020-04; the research had read it as the cast). `r => r.consumer`, a string or template tail, and `(x as Box).field` all missed. Curried arrows that end at one column joined only the outer one, and that outer one often took the inner arrow's V8 function.

The repair, in `src/core/code/crap/match.ts` (row 020-04):

- **End rule:** among V8 functions with the same end, one that does not start after the function's start wins.
- **Parent's V8 function:** a nested function never takes a V8 function of its parent that a removed type cut short.
- **Start rule:** a function the end rule leaves unjoined joins the one V8 function left that starts on its line or the line before, not after its start, and ends inside it. It joins only when no other function fits that V8 function, and the step repeats until nothing more joins.
- Every other case stays `ran: null` (unknown). It is never matched to a wrong range.

On this repository's code store (37,948 records), 168,646 joins were gained, 424k results went from unknown to known, and 780 results flipped, all of them fixes of wrong old joins. Join time did not change. The daemon uses the same join. It does not judge a file again on upgrade: a file's states change at its next judgement, and a state that leaves `unknown` is told silently, as a count (`judge.ts` `kindOf`, `delivery/code-delta.ts` `toldKind`). So the upgrade sends no message per function. Files nobody edits keep their old unknown states until a test of theirs runs again.

### D5. The evaluator

`evaluate(functions, evidence, policy) → report` is a pure function in `src/core/code/gate/`. It has no I/O.

A changed function's evidence is **complete** when all of these are true:

1. It was counted (D2.2).
2. At least one selected test file loads its source, and each loading file's closure is known.
3. Each loading test file completed whole, with a record at the current provider and record versions and the source at the head bytes.
4. The join resolved it.
5. No selected test failed.

Then:

- **skipped**: the function's file matches `coverage.exclude` (D6) and its CC ≤ max. It needs no coverage evidence, gets no CRAP, and is named in the report. It is never counted as pass, and it does not block the verdict.
- **pass**: complete, CC ≤ max, CRAP ≤ max. A pass may also be proven from a subset of the loading files, by 015 D9's bound: the CRAP from the records in hand is an upper bound. Only loading files that **completed** may be left out of that subset, for example one that completed with no record. A loading file that did not finish rules out a pass, and the function reads `incomplete` with the gap `not-finished` (amended 2026-11-10, review 0.1.423 B2). It is still not a pass while a selected test failed.
- **violation**: complete, and CC > max or CRAP > max. CC alone needs only the count. A function over the CC limit is a violation whatever its coverage.
- **incomplete**: every other case. Each one names its gap: `not-counted`, `no-loader`, `not-finished`, `no-record`, `not-joined`, `test-failed`.

Every `uncounted` path is a report row with the gap `not-counted`, and it makes the verdict at least `incomplete`, even when no function of it is named (amended 2026-11-09). So is a failed test.

The verdict is `violations` when any function is a violation. Otherwise it is `incomplete` when any function or path is incomplete or a test failed, and `pass` when every function is pass or skipped. Equality passes. Measured rows are kept in every case.

### D6. Policy

The gate uses 015's keys in `squeal.config.json`, so the daemon and the gate share one policy:

- `complexity.threshold` (default 20) and `crap.threshold` (default 30). Equality passes.
- `complexity.include`, `complexity.exclude` and `complexity.maxFileBytes`. The gate counts test files (D2), unlike the daemon.
- `coverage.exclude`, the project's skip list (the human, 2026-11-09). It names files that Squeal cannot measure yet, such as scripts that tests only start as a separate process, or browser specs. A matched file keeps its CC check and gets no coverage or CRAP: its functions read `skipped` (D5). This is the key's 015 meaning. A project that sets `test/**` there, as this repository does, exempts its test callbacks from CRAP in the gate too.

All of these are read **at the base commit**, so a branch cannot loosen its own gate. The `enabled` keys are not read (D1). The 95% CRAP cutoff and 015's own-line coverage are fixed. `QUALITY_POLICY_VERSION = 1` names these rules, and any change of their meaning raises it.

### D7. The report

`--json` with `--base` writes one object, `format: "squeal-code-gate/1"`. The JSON of `squeal code` without `--base` is unchanged.

- `versions`: the Squeal version, `COUNTER_VERSION`, `COVERAGE_PROVIDER_VERSION`, `COVERAGE_RECORD_VERSION`, `QUALITY_POLICY_VERSION`.
- `base`: the ref, the merge-base commit and the policy values read there: both thresholds, `coverage.exclude`, and the counting keys `complexity.include`, `complexity.exclude` and `complexity.maxFileBytes`. `head`: the commit, whether the tree was dirty, and each changed path with its blob hash, uncounted regular files included (amended 2026-11-10, review 0.1.423 S1).
- `functions`: per changed function, the identity, the body hash, the change kind (`edited`/`added`), CC, own-line coverage, CRAP, the state (`pass`, `violation`, `incomplete`, `skipped`), the gap, and the loading test files expected and measured.
- `runs`: per runner, the test files selected, completed and not finished, and the failed tests.
- `verdict` and the counts of each state.

The report contains no times other than `createdAt` and run durations, so the golden test can compare everything else.

### D8. Exceptions (slice 4, row 020-09; approved by the human 2026-11-10)

`squeal code --base <ref> --exceptions <file>` reads one JSON file, `format: "squeal-code-exceptions/1"`, whose `entries` each name:

- `path`, `qualifiedName`, `bodyHash`: the head function;
- `measure`: `complexity` or `crap`;
- `kind`: `inherited` or `approved`;
- `value`: the highest accepted value of that measure;
- `issue`: a URL;
- `approver`: who accepted it, as the consumer verified;
- `baseCommit`: the base it was accepted against.

**Trust is the consumer's.** Squeal does not decide who may approve. The consumer, for example cezar's CI running trusted base-commit code, builds the file from evidence it verified, never from a file or label on the candidate branch alone, and passes it. Squeal applies the rules:

- An entry applies only when its `path`, `qualifiedName` and `bodyHash` match a changed function at the head, and its `baseCommit` is the run's merge base. Any other entry is reported as `unused`, with why. It never applies to another function.
- `inherited`: the function was already over at the base, and the change did not make it worse. Squeal counts the base itself. For `complexity`, the base CC must be over the limit, and the head CC ≤ the base CC ≤ `value`. For `crap`, the head CRAP must be ≤ `value`, and the head CC ≤ the base CC. Squeal does not run the base's tests in this slice, so the base CRAP is the consumer's recorded `value`.
- `approved`: covers a new or worse finding. The head value must be ≤ `value`.
- An exception needs complete head evidence (D5). An `incomplete` function stays incomplete; no exception covers missing evidence.
- A covered violation reads `accepted`, with the measured scores and the entry. It does not block. A function over an entry's `value` stays a `violation` and names the entry.

The verdict counts `accepted` beside `pass`. A file that does not parse, or has an unknown format, is a usage error (exit 2). `QUALITY_POLICY_VERSION` rises to 2.

### D9. A pinned runtime for CI (slice 6, row 020-11)

The README gains a section, "The quality check in CI". It covers:

- installing a pinned Squeal with no harness, from the release's runtime asset (`squeal-codex-runtime.json.gz`, checked against its published SHA-256) or from the tag clone checked against its commit;
- a cache key that holds the version and the SHA-256, so a stale or wrong cache is never used;
- a minimal GitHub Actions job running `squeal code --base origin/<target> --json` with its exit codes;
- what each verdict means, and how to recover from `incomplete` with no agent session.

If no supported command can start the CLI from the runtime asset without a harness, the row adds the smallest one, `squeal-runtime/bin` or an equivalent, and says so.

### D10. Daemon parity (slice 2, row 020-07), CI evidence (slice 3, row 020-08) and child-process coverage (slice 5, row 020-10)

Each is designed from a design survey run first (`tasks/wave-2.md`, "Surveys for wave 3"; findings `research/daemon-parity.md`, `research/ci-evidence.md`, `research/child-coverage.md`), then written here before its build rows start. The fixed points:

- **020-07:** the daemon's code states and `--base` use one evaluator. A file with no loader reads unknown, never 0% (this reverses 015 D9 and overlaps #165). The gate reuses current daemon records and counts, and runs only what is missing. Deliveries keep 015 D6's rules: no burst per function.
- **020-08:** `ci record` adds Squeal's coverage provider and writes coverage records into its parts, and `--base` reads parts instead of running tests. This reverses 018 D8 and its non-goal "Squeal's coverage provider in CI". A project's own `--coverage` report cannot share that Vitest run.
- **020-10:** with `coverage.children: true` (default off), coverage of child processes is collected and mapped, for the gate and the daemon. This reverses 015's non-goal. Tests can see `NODE_V8_COVERAGE`, which is why it is opt-in.

## Testing

- Evaluator golden tests (020-01): limits and equality for CC and CRAP, CC over limit with no coverage, a skipped function under and over the CC limit, pass from a subset, violation that needs every loader, every gap, a failed test, verdict precedence. The same input twice gives the same report.
- Inventory (020-02): fixture repositories under `test/` with edited, added, moved, shifted, moved-and-edited and removed functions, test callbacks, and a file over `maxFileBytes`.
- Collection (020-03): fixture projects for `vi.mock` factories, node:test `.ts`, mixed Vitest and node:test, a file no test loads, and a short-budget fixture where one file finishes and one does not (a deterministic sleep, not host load).
- Join (020-04): the three arrow shapes from the research's `cases.mts`, plus regressions that every function joined today still joins to the same range.
- CLI (020-05): an end-to-end run in a temporary git repository for each exit code, with no daemon, `HOME` and `TMPDIR` set to a temporary directory. A branch that raises `crap.threshold` in its own config is still judged by the base value. `squeal code` without `--base` gives the same output as before.

## Open questions

1. Decided 2026-11-09 (the human, "Project skip list"): code Squeal cannot measure yet goes in `coverage.exclude` and reads `skipped` (D5, D6).
2. **Slice 2 timing** (the coordinator, after slice 1's dogfood): whether the daemon's `squeal code` moves to the evaluator at once or keeps 015's session view beside it.

## References

- #167; hearsay-tools/cezarion#3096; related #125, #144, #149, #165.
- Research: `../015-coverage-complexity/research/quality-gate.md`, `issue-167.md`.
- Spec 015 D1, D2, D3, D8, D9; spec 018 D8, D10 and its Non-goals.
