# Issue 198: a sequencer imported by the root Vitest config selects every Vitest file

## Verdict

Not reproduced live, because the one-minute host load was 37.89, 40.82 and 42.96 on 24 online CPUs at three checks (13:20 to 13:21 UTC, 2026-11-12). The triage brief requires skipping live work above the CPU count. No probe ran and no `research/probes/issue-198/` fixture was written.

From source on main `c23ca67aa` (Squeal 0.1.449, installed runtime `squeal --version` 0.1.449; the report names 0.1.447), every behaviour the issue reports is the designed behaviour:

1. A file in the root config's `configFileDependencies` selects every test file of each project. Read in source.
2. The same file is a key input of every test file, so stored results from before the edit cannot serve. Read in source.
3. All changed functions can read `pass` while the verdict is `incomplete`, because any unfinished selected file makes the verdict at least `incomplete`. Read in source and spec.
4. The over-budget estimate is advice; the run starts anyway. Read in source and spec.
5. With a daemon in the worktree, the gate keeps none of its completed files. Read in source; row 021-20 part two is the open change for this.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Does a helper imported only by the root Vitest config broaden selection? | Yes: to every test file of every project that reads the root config. | read in source code, 0.1.449 |
| 2 | Can complete changed-function evidence coexist with unfinished selected tests? | Yes: function states can all be `pass` and the verdict is `incomplete`. | read in source code and spec, 0.1.449 |
| 3 | Does D17 start a run that is over budget? | Yes, by design: "the run always starts". | read in source code and spec, 0.1.449 |
| 4 | Does the gate keep completed files when a daemon runs in the worktree? | No: it keeps none and prints the note seen in the issue. | read in source code, 0.1.449 |
| 5 | Same behaviour live on a tiny fixture? | Not determined, because host load exceeded the CPU count at every check. | none |

## Findings

**Q1. Selection.** `src/runners/vitest/project.ts` `projectConfigFiles` collects the root config and the project's config with their `configFileDependencies` (Vite's list of files the config imports). `isProjectInput` returns true for any of them. `src/runners/vitest/affected.ts` `affectedTestFiles` then adds every spec of the project, marked `environment`:

```ts
if (changed.some((p) => isProjectInput(inputs, p))) {
  for (const spec of projectSpecs) add(spec, "environment");
}
```

The comment cites spec 001 D4: Squeal adds "all test files of a project when a setup file, its closure, `globalSetup`, or the config changed". A sequencer module imported by `vitest.config.ts` is in `configFileDependencies`, so it selects all files. Spec 020 D3.1 takes selection from each adapter's `affected()`, so the gate inherits this rule. The adapter cannot tell which config option a dependency feeds (here `sequence.sequencer`), so it cannot tell a sequencer from a plugin or a `define` that changes every transform. Tag: read in source code.

**Q1a. Store reuse.** `src/runners/vitest/environment.ts` hashes "the contents of the config file and its `configFileDependencies`" into each test file's environment key (spec 001 D3). The edit re-keys all 1,665 files. D11.7 reads the stores only at the head key, so only files already run at the head bytes can serve. That fits the issue's "10 read from the stores". Tag: read in source code; the 10 is the issue's count, not checked.

**Q2. Verdict with complete function evidence.** `src/core/code/gate/report.ts` `verdictOf` returns `incomplete` when `runs.unfinished`, and `evaluate.ts` sets `unfinished: evidence.testFiles.some((f) => !f.completed)`. A function's state reads only its own loaders (D5); the verdict reads every selected file (D3.4: "Any selected file that did not finish makes the verdict at least `incomplete`: a test in it may have failed or may not have run"). So `counts.pass: 77, incomplete: 0` with `verdict: "incomplete"` and exit 3 is the designed result. Tag: read in source code and spec 020 D3.4, D5.

**Q3. Over-budget start.** `src/core/code/gate/estimate.ts`: "It is advice: the run always starts, and the verdict does not read it." `src/cli/code-gate-text.ts:227` prints the issue's line, ending "The run starts anyway." Spec D17.1 and status 2026-11-11 record this as the coordinator's call from `research/wide-import.md` open question 2. Tag: read in source code and spec.

**Q4. Retention with a daemon.** `src/core/code/gate/keep.ts` `#write` takes the worktree's daemon lock; when `acquireDaemonLock` returns `null` it prints "`N` completed test files were not kept in the stores: a daemon runs in this worktree, and it keeps its own" and writes nothing. The daemon keeps only what it runs itself, so the 327 gate-completed files are lost for a retry. D17.5 keeps this note "as today" and names row 021-20; board row 021-20 part two (the gate keeper through the daemon) is in repair R2 on `cand/0.1.450`. Tag: read in source code and `docs/board.md` at `c23ca67aa`.

## Limits

- No live run. Load 37.89/26.66/33.85, then 40.82/28.25/34.19, then 42.96/30.32/34.67; `getconf _NPROCESSORS_ONLN` 24.
- No external replay of the 1,665-file selection; the issue's counts are taken as reported.
- Source read on 0.1.449, not 0.1.447. `git log --oneline squeal--v0.1.447..HEAD --` over the eight source files listed under Sources printed nothing, so they are unchanged since the reported version.
- Not read: whether the sequencer file itself had a direct test loader. The issue says every function had matching expected and measured loaders.

## For the human decision

The issue asks two separable things. Neither is a defect against the current spec.

- **Narrower selection for config dependencies.** This changes spec 001 D4's environment rule (and the key rule of 001 D3 if reuse should cross the edit). The adapter knows only that a file is a config dependency, not what it feeds. Any narrowing risks a false pass for a config change that does affect tests. It needs research before a design.
- **Early over-budget outcome.** This reverses D17.1's "the run always starts", a coordinator call, not the human's. Retention across the retry when a daemon serves is already row 021-20 part two.

Incomplete semantics stay as they are: an unfinished selected file keeps the verdict `incomplete`. This file proposes no implementation.

## Sources

- Issue: https://github.com/hearsay-tools/squeal/issues/198 (read with `gh issue view 198 -R hearsay-tools/squeal --json title,body,comments,state,createdAt`, 2026-11-12 13:20 UTC).
- `src/runners/vitest/project.ts` (`projectConfigFiles`, `isProjectInput`), `src/runners/vitest/affected.ts`, `src/runners/vitest/environment.ts`, `src/core/code/gate/report.ts` (`verdictOf`), `src/core/code/gate/evaluate.ts`, `src/core/code/gate/estimate.ts`, `src/core/code/gate/keep.ts` (`#write`), `src/cli/code-gate-text.ts`, all at `c23ca67aa`.
- Spec 020 D3, D5, D7, D11.7, D13, D17 and `status.md`; `docs/board.md` rows 021-20 and 020-28.
- Commands: `cat /proc/loadavg`, `getconf _NPROCESSORS_ONLN`, `squeal --version`, `grep`/`sed` over the files above.
