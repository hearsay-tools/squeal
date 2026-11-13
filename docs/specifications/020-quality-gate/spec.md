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

1. Selection: for every changed path of the diff, after path narrowing, the test files whose import closure loads it (each runner adapter's `affected()`), plus every changed path a runner lists as a test file, plus `--test` files. A path given with `--test` that matches no runner is a usage error. A changed path counts here whether or not a function of it changed: a top-level edit of a test or a source file selects too (amended 2026-11-10, review 0.1.423 B1). Amended 2026-11-12 (row 020-35, #194; the human: match the daemon): selection also takes every test file whose declared `inputs`, read at the base, name a changed path, under the daemon's own rules (`createDeclaredInputs` in `src/core/keys/closure.ts`, spec 001 D3): a map gives each test file the globs of every test glob it matches, and the list form gives every test file the listed globs, so a change to a listed file selects every test file, as it re-runs every test in the daemon. The selection line names test files chosen this way apart. A wrong declaration only adds runs: an unloaded function still reads `no-loader`.
2. Runs: one adapter run per runner (Vitest, node:test), with Squeal's coverage provider, as 015 D8 runs them. Records are mapped before `adapter.close()`. The collector takes the adapter factories as arguments, and the CLI passes them, because nothing under `src/core/code` may import a runner (`test/runners/boundaries.test.ts`, row 016-36). Vitest runs with `cache: false`, so it writes no results cache into the project (amended 2026-11-09, row 020-03).
3. Loaders: from each run's `closure()`, not from a store.
4. Budget: one deadline over all runs, 600 s by default, `--timeout` to change it. At the deadline, the running file is stopped. Every completed file keeps its record. The report names each file that did not finish. The command does not lower a project's own `testTimeout`. Any selected file that did not finish makes the verdict at least `incomplete`: a test in it may have failed or may not have run (amended 2026-11-10, review 0.1.423 B2). Failures a runner already reported for an unfinished file are kept in the report when the adapter gives them; the verdict does not depend on it. Added 2026-11-13 (row 020-43, #196): while the runs go, stderr names once each file still running past its estimate: its stored seconds, and never less than 10 s or a twentieth of the budget, whichever is more; with no stored seconds, that floor. For example `squeal code: node:test is still running n1/slow.test.ts after 10 s (no stored duration); 11 s of the 25 s budget used`. With `--json` it goes to stderr, as every line but the report does (D14.4). A file the early stop did not start (D17.1) is not a file that did not finish: it reads not completed, so it too makes the verdict at least `incomplete`.
5. Nothing is written to the project or a store. Temporary files go under `$TMPDIR` and are removed. Amended 2026-11-11 (D15): Squeal writes nothing to the project; a declared `prepare` writes what it writes. Amended 2026-11-11 (D17.3): the gate writes each completed test file's results to the stores at its key. Amended 2026-11-12 (row 020-40, #197): the log folders of a runner's runs in which a selected file failed or did not finish are kept as one folder per runner, at `<store>/runs/gate-<id>`, named by a finished `runs` row of the main store, so the store's prune removes it as it removes a daemon run's log (spec 001 D8). A run whose files all passed keeps nothing.

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

Later sections add fields, each named there: `exceptions` (D8), `runs[].from` (D11.7, D13.2), `runs[].children` (D12.7), `scope` and `loaders.leftOut` (D14.3), `runs[].prepare` (D15.3), `omitted` (D16.2), `runs[].estimate` (D17.1), `incompleteClosures` (D14.4), `runs[].log` (D3.5; with it, the same inputs give the same report apart from times and kept log paths), `runs[].notStarted` (D3.4, D18), `runs[].overBudget` and `budget.rerun` (D17.1). Added 2026-11-13 (row 020-43): `runs[]` gains `notStarted`, the files of `notFinished` that never started, because the budget ended first or their run stopped before them; absent when every unfinished file started. The text report keeps one line per file that started and was stopped, and gives one count line per runner for those that never started. Added 2026-11-13 (row 020-49, #205): `runs[].refused`, by path, each selected file a part holds that the parts did not give (D13.2): its `part`, the part file as read; its `reason`; `input`, the path that refused it, for `input`, `unread` and `source`; and `detail`, when the reason alone does not say it all. `from` says whether the stores then gave the file or this command ran it. Absent when the parts gave every file they hold, so a report with no refusal is as before. A report whose every file ran here has `refused` and no `from`.

Added 2026-11-13 (row 020-50, #207): for each Vitest file whose worker Vitest timed out terminating (013 V8), stderr gets one line before the report saying whether the file's result counts in this report, from its final evidence: `squeal code: Vitest timed out terminating the worker of test/pass.test.ts; the file completed, so its result counts in this report.`, with `, 1 failed test included` when it failed, or `…; the report lists the file as not finished, so its result does not count.` The line says nothing of storage (D17.3). Verdicts, exit codes, provenance and the JSON report do not change.

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
- An exception needs complete head evidence (D5). An `incomplete` function stays incomplete; no exception covers missing evidence. A D5 subset pass is not complete evidence for an exception: every loading test file needs its record (amended 2026-11-10, review 0.1.424 B1). A loading test file that skipped a test is a gap for an exception too (the coordinator, 2026-11-10, row 020-07a I).
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

### D11. Daemon parity (row 020-07, designed 2026-11-10 from `research/daemon-parity.md`)

1. **One rule, not one report.** A pure `judgeFunction(input, policy)` in `src/core/code/gate/rule.ts` decides one function's state from its evidence. It takes: complexity, whether `coverage.exclude` matches, the loaders expected and measured, the first missing gap, the joined coverage, whether a selected test failed, and whether a loader skipped a test. It gives the gate state and gap, CRAP, and the per-measure outcomes `crap` and `uncovered`. `evaluate()` calls it per function, and its 020-01 golden tests must not change. The daemon's `crap/judge.ts` calls it too: the daemon maps `pass`/`violation` to `pass`/`fail` per measure, and `incomplete` to `unknown` or `pending`. Transitions, the early pass (015-57), the drop (015-75), the pass beside a skip (015-78) and the views stay outside the rule, so deliveries keep 015 D6.
2. **Failed tests stay a gate input.** The daemon passes `failed: false`, because test failures are told as test transitions (the coordinator, 2026-11-10; the survey's Q2.1 (a)).
3. **Skipped tests.** The gate adopts 015 D9: a loader with a skipped test can prove a pass and never a violation. It reads `incomplete` with the gap `skipped`. `TestFileEvidence` gains `skipped`. `QUALITY_POLICY_VERSION` rises by one (Q2.2).
4. **`uncovered`** stays a daemon measure that the same rule computes. The gate report does not show it (Q2.3).
5. **No loader reads unknown.** `fileCondition([], true)` is `unknown`, with the cause `no-loader`, in both paths. A state judged with no loader is dropped once, through a marker of its own in `loaderSet`. Text reads `not measured: no test Squeal runs loads this file`. The delivery wording `NOT_LOADED` is removed, because it can no longer occur. This reverses 015 D9 and resolves #165 for files no runner loads.
6. **Test files are counted in the daemon,** and each test file is its own loader. The 015-52 listing hold is removed. An upgrade starts one `include` recount with one summary line, never one delivery per function. This reverses 015 D1's "test files are never counted".
7. **`--base` reuses the stores.** For each selected test file, it computes the key as a daemon would, with no store write. It reads the results and the coverage record at that key, read-only, and runs only the files with neither. The report marks each test file read from the stores in `runs[].from` (`store`; `parts` for D13.2). Counts are not reused, because counting costs about 3 ms a file. D1's "neither talks to it nor uses its store" changes to "reads its stores, never writes them". Amended 2026-11-11 (D17.3): the gate also writes each test file it completed at that key.

Rows: 020-07a (items 1 to 5), then 020-07b (item 6) and 020-07c (item 7) in parallel.

### D12. Child-process coverage (row 020-10, designed 2026-11-10 from `research/child-coverage.md`)

1. **Key.** `coverage.children` (default `false`) needs `coverage.enabled`. The gate reads it at the base, like D6's other keys.
2. **Vitest.** With the key on, the provider's worker side points `NODE_V8_COVERAGE` at a new `children-<uuid>` directory per test file, and the payload names that directory. It leaves an existing variable alone, with a note. It takes nothing where it takes no coverage today: `isolate: false` and inspector files.
3. **node:test.** The recorder points the variable at `<dir>/children` at the point where it deletes it today, and `coveragePayloads` returns the own file plus every child file.
4. **Record.** The mapper maps each child file with `ownRecord` and merges it with the own record per path when the blobs are equal: an OR of lines and covered lines, and a union of functions. A path with different blobs reads `unread`.
   - A child file that does not parse, or is over 64 MiB, is dropped alone and counted under a new `Drops` cause. This cap is the coordinator's choice; V8's limit is far above it.
   - A known dropped child gives a note, not a gap. Lost children only lower coverage. CRAP then rises, so a pass stays proven, and a lost child cannot cause a false pass.
5. **Keys.** The coverage marker in both runners gains `children: true`. Results from runs where tests could see the variable never share a key with runs where they could not.
6. **Loaders.** In the daemon, with the key on, a test file whose observed set holds a path is also a loader of that path. The gate keeps import-graph selection and `--test`. Amended 2026-11-10 (row 020-10b, measured with a real daemon): no code change is needed. A child inherits `NODE_OPTIONS`, so the runtime-input recorder sees its reads. The observed set is already part of the key closure, so the test file is already a loader of the script. With `observe.runtimeInputs` off, a script that only a child runs reads not measured (`no-loader`). Making every source in a record a loader was rejected: the loader set would change with each run and drop states at each edit (015-75). Amended 2026-11-12 (row 020-36; the human: "Record them"): the node:test recorder now reaches the processes a test starts, as Vitest's does, through `NODE_OPTIONS`; before, it was passed on the command line only, so a node:test child's reads entered no key (`research/issue-194-gaps.md` G6). `NODE_TEST_ADAPTER_VERSION` rises once, so stored node:test results run once again.
7. **Words.** The texts say children are measured, as a lower bound, when the key is on. D7 adds `coverage.children` to `base`, and child counts per run. Bundled children read `unread`; mapping a bundle with several sources is out of scope.
8. **Cost:** +26% CPU per child process, plus about 19 ms per MB mapped. It applies only to projects that opt in.

Rows: 020-10a (items 1 to 5) now, beside wave 2. 020-10b (items 6 and 7) waits for 020-07a and 020-09.

### D13. CI evidence (row 020-08, designed 2026-11-10 from `research/ci-evidence.md`)

1. **Records in parts (020-08a).** `ci record` adds Squeal's coverage provider through `configOverride.coverage` in its `start` wrap.
   - It maps each completed whole file's payload in a worker thread, from what Vite read, and writes the records into a `squeal-ci-part/4` part.
   - It adds nothing when the run's resolved config already has `coverage.enabled`, or when Node lacks `process.getBuiltinModule`. The part names why.
   - It never changes the exit code. An error of its own is recorded as a reason in the part.
   - A file gets no record with `isolate: false`, with a test name filter, inside a batch of several files, when unfinished, or when its closure imports `node:inspector`.
2. **The gate reads parts (020-08b).** `squeal code --base <ref> --parts <dir>...` takes a selected file's evidence from the parts only when the tested input, the blob and the record and provider versions all match, and the part's project environment matches the gate runner's, as `ci export` compares environments (amended 2026-11-10, review 0.1.427 B1). It runs every other file. Each test file in the report says where its evidence came from. Nothing is written to the parts directory.

   A selected file that a part holds and that the parts do not give has its reason in the report (D7, `runs[].refused`; row 020-49, #205). The reasons, in the order the gate checks them:
   - `duplicate`: more than one part holds it. `part` is the first by name; `detail` names the others.
   - `unusable`: its part gives no evidence (another format, coverage versions or collector, no coverage provider, no read evidence, `coverage.children` on at the base). `detail` is the part's reason.
   - `environment`: its part ran its project in another environment than the gate's runner. `detail` is the difference.
   - `closure`: the runner gives no closure of it here.
   - `input`: the part does not certify an input of its closure or of what it read. `input` is the first such path by name. `detail` says how it differs (`its part read other content`, `its part holds no evidence of it`, `its content here is not known`) and how many more inputs do.
   - `record`: it passed, and the part holds no coverage record of it. `detail` is the part's `noRecord`, when it has one.
   - `unread`: its record could not read a changed path, the first by name.
   - `source`: its record holds other bytes of a source, the first by name.

   After the verdict, stderr gives one line per runner and per-file reason (`duplicate`, `closure`, `input`, `record`, `unread`, `source`): how many files it refused, how many of those ran here and how many the stores gave, and up to three of them, each with its `input`; the others are counted. `unusable` and `environment` add no line: the gate tells them once per part as it reads the parts. Nothing about certification changes.

3. **Compatibility.**
   - Exports (`squeal-results/1`), keys and `KEY_FORMAT_VERSION` do not change. Every published export stays importable. Imported files keep no coverage; records travel in parts only.
   - Format 4 part readers accept format 3, and a gate given format 3 parts runs every selected file.
   - The runtime asset and the tag clone both hold `dist/coverage/provider.mjs` and `dist/cli/coverage-map.mjs`.
4. **Export of `node:inspector` files** (decided by 018's coordinator 3739e45a, 2026-11-10; a coordinator decision for 018, not the human's; amended 2026-11-12, D19.6): when a shard ran with any coverage provider, the project's or Squeal's, `ci export` leaves out a test file whose closure imports `node:inspector`. D10 of 018 lets an imported pass cross a coverage difference. A test that uses `node:inspector` itself is the one case where the provider can change the outcome. Such files are rare.
5. **Kept from 018-23:** the read-time evidence rules in `vitest-ci.cjs`, `descriptors.cjs` and `children.cjs` stay as they are, for example "a foreign `SQUEAL_CI_RECORD` child withholds every path".
6. **Spec 018 changes** (approved through row 020-08 by the human, 2026-11-10): D8's "No coverage provider is added" and the non-goal "Squeal's coverage provider in CI" are reversed. `ci record --help` says when the provider is added and when it is not. D10's coverage tolerance stays.
7. **Cost:** +22% CPU on 30 short files at load 24 to 35, against 015's +8%. A real shard measurement is row 020-08c, a cezar proposal that needs the human's approval.

Rows: 020-08a, then 020-08b after 020-07c, because both use the gate's known-evidence seam. 020-08c is the cezar proof, a proposal for the human.

### D14. Scope by check group (row 020-15, designed 2026-11-11 from `research/selection.md`)

The human, 2026-11-11: "should squeal guess what quality checks the project wants? This could make a good default but should be configurable after all."

1. **Scope.** The gate runs a selected test file only when its check group (spec 019 D1), resolved from `checks` at the merge base, is in scope. By default every test group whose moment is not `manual` is in scope. A project sets its own scope with `gate.groups`, a list of group names read at the base like D6's keys (the default groups `tests` and `slow` count). `gate.groups` replaces the default. An unknown name or a lint group in it is a policy problem on stderr and is dropped. `--group <name>...` adds groups for one run, `manual` ones included. On the command line, an unknown name or a lint group is a usage error (exit 2). `--test` files always run. A repository with no `checks` and no `gate.groups` behaves as before: `tests` and `slow` are never `manual`.
2. **Left out.** A selected file outside the scope does not run. Its `closure()` is still read, with no setup, so each function knows its left-out loaders.
   - A function whose in-scope evidence is complete and passes reads `pass`. Its row lists the left-out loaders in `loaders.leftOut`.
   - A CRAP over the limit with a left-out loader reads `incomplete` with the gap `left-out`, because more coverage could lower it. A CC over the limit stays a `violation`.
   - A changed test file in a left-out group does not run. Its functions read `left-out`, or `skipped` when `coverage.exclude` matches them.
   - D8: an exception needs complete in-scope evidence. A left-out loader is outside the project's declared scope and does not block it.
3. **Report.** D7 gains `scope`: the groups in scope and where each came from (default, `gate.groups`, `--group`), and per left-out group its moment, its file count, how many of them load changed code, and the command that adds it. `base` gains `gate.groups`. The text verdict line names what did not run, for example `browser (manual) did not run: 100 test files load changed code; add --group browser to run them`. It never says "all tests".
4. **Before the run** (row 020-15b, which also carries 020-16a). After selection, after stored and parts evidence is resolved (amended 2026-11-11, review 0.1.432 B2), and before the first run or `prepare`, stderr gets: one line per runner with its file count by group; one line per left-out group; the projects whose global setup will run, only for files that will run, the root's when a Vitest run remains; and each changed path that no runner can load, with the ways out (give it to a runner, with `prepare` when it needs a build, or name it in `coverage.exclude` at the base). With `--json`, stdout holds exactly one JSON object and nothing else: every write to standard output during collection, by Squeal's process, by a test setup or by any process they start that inherits standard output, goes to stderr (the human, 2026-11-11, #182: "Yes, fold it in"). Amended 2026-11-12 (row 020-31, #193): after those lines and before the D17.1 estimate, one line per node:test project that has test files whose static closure is incomplete: how many of them are in this check, the first three by path, what that means for the others, and that the JSON lists them all, for example "node-test project \"unit\": 4 of 5 test files with an incomplete static closure are in this check: ... The gate selects test files by their static imports, so the other one does not run for a changed path it loads only through a computed import() or require(). The --json report lists all 5 in incompleteClosures." In the gate it replaces the adapter's own closure note. Amended 2026-11-12 (row 020-34; #194): the line naming a changed path that no runner can load is printed also when `coverage.children` is on, if no selected test file runs; when some run, a weaker line says a child process of one of them may still load it. The report gains `incompleteClosures`, after `runs`: per such project `{ runner: "node-test", project, files }`, every file with `{ path, reasons, selected }`, `selected` true when this check ran it or read its evidence from the stores or parts; absent when no project has such a file. The node:test hints name the top-level `inputs` key of `squeal.config.json`. Verdict, exit code and `QUALITY_POLICY_VERSION` do not change.
5. **Not chosen:** `--project`, a mode that replaces automatic selection, and leaving out a browser-mode project before Vitest opens it.
6. The daemon has no scope: it never sees `left-out`.

### D15. A `prepare` command for node:test entries (row 020-16, designed 2026-11-11 from `research/build-wrapper.md`)

Approved by the human, 2026-11-11 ("#174 prepare: Yes").

1. **Key.** `nodeTest[].prepare: { command: string[], timeoutSeconds?: number }`. `command` is an argument list, never a shell string.
2. **Read at the base.** The gate runs the `prepare` of the base's entry with the same name, so a branch cannot add a command and run it in the same change. When a head entry has a `prepare` the base lacks, its files do not run and read `incomplete` with the gap `not-prepared`, and a note says to land the declaration first. The entry's other keys stay read at the head, as D1 says.
3. **Run.** Once, before the entry's first selected file, in the entry's directory, inside D3.4's one budget; `timeoutSeconds` caps it too. When the gate is stopped (SIGINT, SIGTERM), it stops the command's whole process group first (amended 2026-11-11, review 0.1.432 B1). It does not run when no file of the entry is selected. A failure or a timeout means no file of the entry runs, and they read `not-prepared`. Its exit code and duration go in `runs[].prepare` (D7). Its output goes to stderr.
4. **Evidence.** Outcomes come from Squeal's own node:test run and coverage from Squeal's record. The `prepare` command's own success is never evidence.
5. **D3.5** becomes: "Squeal writes nothing to the project; a declared `prepare` writes what it writes."
6. **The daemon** does not open an entry that has `prepare` and notes this once; only `squeal code --base` runs it. Explicit daemon runs of such an entry are a later row (020-16c), not approved.
7. Spec 011's "It never runs arbitrary commands" gains this one exception (the human, 2026-11-11).

The gaps `left-out` (D14) and `not-prepared` (D15) are new rules: `QUALITY_POLICY_VERSION` is 4 with both.

### D16. Functions left out (row 020-18, #177; the human, 2026-11-11, "Count and list")

D2.3's selection stays as it is: moved, renamed and reindented functions, and test callbacks whose own text did not change, are not judged. The report now says so.

1. A head function is **left out** when the diff's changed lines touch it and D2 does not judge it. Its reason is `unchanged` (its body hash equals that of the same identity at the base, for example a new test title or a reindent) or `moved` (its body hash exists at another identity of a changed path at the base, for example a moved, renamed or copied body).
2. D7 gains `omitted`: per left-out function, the path, the qualified name, the reason and, for `moved`, the base path and name it matches. It is sorted by path and name.
3. The text verdict line ends with the count, for example `7 left out as moved or unchanged; --json lists them`. With none, it says nothing.
4. No rule changes, so `QUALITY_POLICY_VERSION` stays. The JSON format keeps `squeal-code-gate/1`, because the field is additive.
5. Not decided here: whether a copied body at a new identity should be judged. It is the one case where a real edit can be left out (the "keeps" callback of `research/issue-177.md`). That needs its own decision.

### D17. Wide selections (row 020-17, #175; designed 2026-11-11 from `research/wide-import.md`; the human, 2026-11-11: "Build both", "Keep result: Yes")

When to call evidence complete does not change: an unfinished loader still rules out a pass (D3.4, D5).

1. **Estimate (020-17a).** After selection and the stored lookup, before the first run, stderr gets one line per runner: the estimated seconds, how many files have a known duration, and the width. Estimate = per parallel group, the larger of the longest file and the summed durations divided by the width; plus the sum of each sequential group. A file with no stored duration counts at the median. With no store, the line says the estimate is unknown and gives the file count. When a runner's estimate is over what is left of the budget, its line gives the ways out (`--timeout`, path arguments, `--group`/`gate.groups`, `--parts`). Amended 2026-11-13 (rows 020-45, 020-46; #196, #198; the human: "Build all three", "Stop early"). The whole run's estimate is the larger runner estimate, as the runners run at once (D18.5); a runner with no stored duration counts at the median of every runner's stored durations (D18.2). When it is over what is left of the budget, one more stderr line gives it and one rerun command: the call's own arguments with `--timeout N`, N being the seconds spent before the estimate plus twice the estimate, rounded up to a whole minute (a summed estimate over 20 or more files is more than 2x wrong in about 2.5% of stored runs, `research/gate-budget.md` Q2). For example `squeal code: about 700 s in all, over the 590 s left of the budget. A rerun that fits: squeal code --base main --timeout 1440`. D7's `budget` gains `rerun: { seconds, command }`, and the text report names the command before the JSON line (`A rerun that fits the estimate: <command>`). When the estimate is at least twice what is left, from at least 20 files with a stored duration, the runs start with only the selected files that may load a changed function: those whose closure loads the path of a changed function or is unknown, `--test` files, and files only their declared `inputs` chose (D3.1). The others do not start and go to no `prepare`: each reads not completed, its closure read with no record, so the verdict is at least `incomplete` (D3.4), and no function's state reads it (D5); `budget.timedOut` stays `false` when only the early stop left files unrun. The stderr line says how many run and names the first three that do not, for example `squeal code: about 1400 s in all, at least twice the 590 s left of the budget, so the gate stops early: it runs the 2 test files that may load a changed function, and not the 4 that load none (test/c1.test.ts, test/c2.test.ts, test/c3.test.ts and 1 more; the report lists them all). A rerun that runs them all: squeal code --base main --timeout 2820`. D7's `runs[]` gains `overBudget`, their paths, apart from `notFinished` and `notStarted`, and the text report counts them per runner. Otherwise the run starts whole. The estimate does not change the verdict, the exit code, a gap or `QUALITY_POLICY_VERSION`. D7 gains `estimate`. It does not change the verdict.
2. **Order (020-17b).** The collector reads each selected file's closure before the run, and hands each runner its files in loader order: changed paths in ascending order of their loaders' summed stored duration (the loader count when unknown), each path's loaders not yet given, then the rest. Files whose closure is unknown go last. The functions of one path complete together, so this completes small paths first; a path that every file loads comes last. `runs[].selected` stays sorted in the report.
3. **The gate keeps its results (020-17c).** The gate writes each test file it ran to completion, with its results and coverage record, at the key a daemon gives it (D11.7), through the same store write path and lock the daemon uses. A file that did not finish, was left out, did not run because of `prepare`, or came from parts is not written. A file whose keyed inputs changed or were touched during its run is not written, as the daemon's completion barrier rules; each opened runner keeps its own pending state (amended 2026-11-11, review 0.1.433 B1, B2). A second run on the same bytes then reads them (D11.7) and runs only what is missing. A daemon can read them too, because the key means the same run. This reverses D3.5's "nothing is written to a store" and D11.7's "never writes them". Amended 2026-11-12 (rows 011-319, 011-320; the human, "B: move, then checks 2-4" and "Folder case: Add to the running row"): a file is written only when its run evidence's store decision is "store at the key it ran under" (`src/core/run-evidence/`). What bars a keep: the file did not complete, or has no coverage record; an input changed, or was written and ended as it was, during the run; the run read a path its key lacks, or one first seen during the run; it loaded an environment file its key lacks; its runtime identity moved between the lookup and the run's end, or the policy's runtime rules on disk select other runtime files for it than at the lookup; a merge holds a path its key names (011 C9), read at the decision and again before every write try; a file, an editor's scratch file among them (row 011-117), was added to or removed from a directory its key lists, at any depth, through a followed symlinked directory too: by the files the lookup's keys held there against those git and the watcher's link scope show there at the run's end, and, where a daemon serves, by its revisions during the run, as its own record reads them. Once the report is out, stderr gets one line per kind of reason: the count, the reason, at most three of the paths behind it and three of the test files, each in path order, then how many more (formats in `../011-core/tasks/011-320/notes.md`). Verdict, report and exit code do not change; `QUALITY_POLICY_VERSION` does not change. Amended 2026-11-13 (row 020-39; research `research/no-daemon-reuse.md`), and row 020-48 (#206): the keeper also stores a file at the key with what its run read. The runs' reads are merged first into the shared observed rows (`observed.`, `observedDirect.`, `observedModules.`), as the daemon's record merges them: by the keeper, in one transaction of its own, where no daemon serves the worktree; by the serving daemon, in its retried path, where one does (one `keep` request of kind `seen`, in parts of at most 4 MiB, before the files' writes). A daemon before row 020-48 refuses the reads: each file kept at the key with its reads is then not kept, with the line "read paths its key lacks", and the others are written. The bar "the run read a path its key lacks" becomes "the run read a path first seen during the run, or one that moved before the write". A git-ignored read is kept one run later.
4. `QUALITY_POLICY_VERSION` does not change: no state rule changes.
5. **Writes under a busy store (row 020-28, #192; the human, 2026-11-12: "Fix it").** The keeper writes after the report is printed, so a busy store never delays the verdict. It keeps D1's short transactions and sliced retry (`busy.ts`), with a bound of 30 s from the first busy write instead of 10 s per runner run. Before it waits, stderr names the files it is saving and the processes holding the write lock (spec 021 D5, `lockHolders`/`describeHolders`; "unknown" where the platform cannot tell). On exhaustion the note says how many completed files were not kept, names the holders, and says the next run will run those files again. The verdict, the report and the exit code do not change; a `--json` child that ends on a signal exits 3, also after its report (review 0.1.444 B1). Each queued file's keyed inputs are checked again after every busy pause and before its write; a changed file is not kept and is counted with the files to run again (review 0.1.444 B2). When a daemon serves the worktree the note stays as today; row 021-20 later sends those writes to the daemon. Exception (row 020-40): the run row of a kept log (D3.5) is written before the report, waiting at most 2 s for a busy store, and only when a selected file failed or did not finish; past the wait the log is not kept, with a note.

### D18. Order across runners (row 020-19, #187; amended by row 020-44, #196)

1. The gate runs its runners at once, as the daemon's lanes run: first each node:test entry's `prepare` (D15.3), then every runner's run starts under the one deadline (D3.4). Vitest runs with its own workers. The node:test entries share one pool of `runner.tierSize` processes: a file takes a slot before its process starts and gives it back when the process exits, so while one entry's slow file runs, the free slots go to the files of the other entries. The gate never stops a running file to make room; only the deadline stops one. Before, the runners ran one after another, and a runner that held the budget left every later runner's files unrun (#196).
2. The runners keep their order by D17.1 estimate, the smaller first. A runner with an unknown estimate counts by its file count at the median known duration; with no store at all, the runner with fewer files comes first. Ties keep Vitest, then node:test entries in config order. It is the order the pre-run print lists them in, the order the `prepare` commands run in, and the order in which the node:test entries first ask the pool for processes; the pool gives them in the order asked.
3. Each runner's own files keep D17.2's order. Running at once changes no verdict and no rule: `QUALITY_POLICY_VERSION` stays.
4. The pre-run print lists the runners in that order.
5. Since the runners run at once, the whole run's estimate is the larger runner estimate (D17.1), not their sum, and each runner's estimate line is over the budget when its own estimate is over what is left.
6. A runner's `runs[].durationMs` is the time any of its runs ran, so node:test entries that run at once count once.

### D19. Records beside the project's coverage (row 020-26, #189; designed 2026-11-12 from `research/ci-coverage-both.md`; the human, 2026-11-12: "Build it", proof "Yes, after release")

1. **Wrap, do not replace.** When the run's resolved config has `coverage.enabled` with `provider: "v8"`, `ci record` adds no provider. It wraps the project provider's `onAfterSuiteRun` once the provider exists, calls the original first and returns its result, and maps each batch with today's `coverage.cjs`. An error of Squeal's is a note in the part, never the run's. The project's report, reporters, thresholds and exit code stay the project's own.
2. **Tested versions only.** Squeal records from the project's provider only on the Vitest minors it has tested: 4.1 and 5.0 today. On any other Vitest version, and with an Istanbul, custom or browser-mode provider, `ci record` yields as before (D13.1), and the part names why. Adding a version is one tested change.
3. **Rules kept and added.** Kept: whole file, no name filter, finished, no `node:inspector` closure (D13.1). Added: no record from an `isolate: false` project, and none from a payload with child-process entries (`isExtendedContext`).
4. **The part header** names which collector made the records: `squeal` (Squeal's provider), `v8` (the project's provider), or none with the yield reason. `ci record --help` says when each applies.
5. **Readers.** The gate (`--parts`) reuses records collected by `squeal`, by `v8`, or with no collector named (a part of an older Squeal) under the same rule as today: same record and provider versions, same environment (D13.2). Records from any other collector give no evidence, with a named reason. `ci export` carries no records (D13.3) and does not refuse a part for its collector; the collector matters to it only through D19.6 (amended 2026-11-12, row 020-26ab).
6. **D13.4 amended.** `ci export` leaves out a test file whose closure imports `node:inspector` whenever the shard ran with any coverage provider, the project's or Squeal's (spec 018's coordinator 3739e45a, 2026-11-12).
7. **Not decided here:** browser-mode V8 coverage, a batch of several files in one worker, and the tolerance between two reports of the same run. The Cezar proof (020-26c) runs a second provider-only run as the control.

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
