# 019-28 the commit report counts only the commit's own work (P1, P4)

Worker 5ca2b4c1, 2026-11-04. Brief `tasks/wave-5.md`, 019-28; the problems and done-when are `lessons.md` Round 1, P1 and P4. Base `68c033886` (cand/0.1.399 plus the wave 5 briefs). No build: the bundles are the candidate's (coordinator, 2026-11-04).

## What changed

| Problem | Where | Change |
| --- | --- | --- |
| P1 running | `commit/compute.ts` `testTally` | A queued or running file at the committed key counts as running only when a commit asked for it there (`TallySide.asked`, from `askedTestFile`). A file held for a commit no commit asked for stays unknown (019-22). Any other queued file is left out: it is in `files` only. |
| P1 waiting | `scheduler/head-move.ts` `commitReport` | `waiting.tests` is the running files, so only asked files. |
| P1 update | `scheduler/commit-moment.ts` `testWaitEnded` | A file still holds the update while it is pending at its key and asked, or while a run of it at its key is in flight. A queued file no commit asked for, as an older daemon's stored report may name, no longer holds it. |
| P4 lint scope | `commit/lint.ts` `lintTally` | Only the checks of files the commit changed (`CommitSide.changed`) and holds count. `changed` is `git diff --name-only <from> <commit>`, or every committed file when no `HEAD` was looked at before. |
| P4 update | `commit/report.ts`, `head-move.ts` | The report stores `from` (the `HEAD` it moved from). The update makes `changed` again from it, so the update counts the same files. A report without `from` (older daemon) counts every committed file at its update. |
| P4 whole-program | `commit/lint.ts` `LintView.segmentHolds` | A whole-program check is not determined only when a differing path is one whose bytes its keys hold: `holdsBlob(path, extensions)`, with the extensions the tool's program recorded (module extensions, `.json` included, and the files the tool lints). |
| P4 text | `commit/compute.ts`, `commit/text.ts` | `CommitTestCounts.untracked`: the not-determined files that differ only through files the commit does not hold. The line says "(unstaged changes)" for the others and "(untracked files)" for these. |

## Decisions the spec did not settle

- **Other queued files: left out, not named by their moment.** The brief allowed either. Left out is the smaller change, and the edit and Stop lines already name those files.
- **A held `commit` group file stays unknown.** It has no result at the committed key and nothing runs it, so it is not "left out" like a file that runs at its own moment.
- **Whole-program checks by bytes (option ii).** The coordinator chose it, 2026-11-04. Strictly, a whole-program key also holds every listed path's name (`programSegment` in `lint/pass/keys.ts`), so by key semantics every untracked file is read. The report ignores names: an untracked `notes.md` or `run.log` changes nothing; an untracked `.ts`, `.js` or `.json` file still makes the commit's whole-program checks not determined. The cost: committed code that imports an untracked file of another extension (a stylesheet, for example) can read as determined.
- **c3 caveat.** The stray gh-134 file in c3 is a `.json` file, a module extension. So in cezarion (oxlint with its import plugin, whole-program) that file still makes the commit's own lint check "not determined". Only the gh-134 fix removes that case.
- **The words "(untracked files)".** They name the cause, as "(unstaged changes)" does. A test file that reads an untracked file usually means a `git add` was missed.

## Type changes

- `testTally(view, side)` and `testCounts(view, side)` take one `TallySide` object (`differing`, optional `untracked`, `deleted`, `asked`, `held`) in place of positional arguments.
- `CommitTestCounts.untracked?: number` (additive, absent when 0). `CountedCommitReport.from?: string` (additive). Both parse from stored rows; older rows read without them.
- `CommitSide.changed` (required) and `LintView.segmentHolds` (required). `commitLint` takes `changed` from `side`, not as its own parameter.
- New export `askedTestFile` in `scheduler/commit-moment.ts`.

## Tests

| Test | What it holds | Old code |
| --- | --- | --- |
| `test/scheduler/commit-lint.test.ts` "a commit while an edit's tests run …" | P1 done-when in a repository with only a lint group at commit: the line never says "test files still running", and the update comes once lint ends while the test run is still held | Fails |
| `test/scheduler/commit-lint.test.ts` "a commit beside an untracked file …" | P4 done-when with a real lint pass and a whole-program check: untracked `notes.md` and `run.log` leave the line as "lint 1 finding"; an untracked `src/z.js` makes it not determined | Fails ("lint 0 findings, 2 files not determined") |
| `test/commit/compute.test.ts`, `lint.test.ts`, `text.test.ts`, `store.test.ts` | The tally rules, the text, the stored fields | The new cases fail |
| `test/scheduler/commit-report.test.ts` | Updated: the lint part counts the changed file only; an untracked closure file reads "(untracked files)"; a rebase's queued file is left out | Fails |
| `test/e2e/run-triggers.test.ts` | Part A commits before Stop again, while the e2e files wait: lines exactly `… lint 0 findings, 1 file still running` then `… lint 1 finding`; the e2e files still pending after the update | Not run here |

Not covered by a test: `testWaitEnded` for a stored report from an older daemon that names a queued file of another moment. In the fixtures a `stop` group's file runs at once (no agent in a turn reads as paused), and a held runner makes the file running, which holds the wait on both old and new code.

## Checks that wait for the build

`test/e2e/run-triggers.test.ts` runs the committed plugin bundles (`copyPlugin` copies `git ls-files plugins/`), so it shows this row only on a built candidate. Not run here. `lessons.md` (P1) records what this ordering gave on 0.1.398: `2 test files still running`, and no update in 90 s. On a candidate built with this row: `pnpm exec vitest run test/e2e/run-triggers.test.ts` (both plugins, about 4 min each). Squeal does not cover `test/e2e/**`.
