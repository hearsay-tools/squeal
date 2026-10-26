# 011-243 notes: a named wait with no verdict names what its passes cover and the next step

Row 011-243 (gh-99, the human's option A+, 2026-10-26). Wave 49 W2, brief `tasks/wave-49.md`, baseline `89f458320`. Worker 3c663d30.

## Cause

A named wait that ended without a verdict listed its selected files under `Current (9): 9 pass`, then said `Named test files have no verdict: ... the runner has not listed the test files of revision 7 yet` (#99). The line did not say which revision the passes ran at, nor what the agent should do. Nothing reports a later pass, and a failure arrives only with a later tool call, so the agent ran the files by hand. The same happened with the daemon's pass not stored (#99's second report, the gh-88 shape): 12 passes, then `results are as of revision 42`.

Two parts of the text also decided again what `selectionResult` decides (`quality/2026-10-26-a.md` slice 1): `timeoutText` called `unsyncedText`, which restated `unsynced`, and `namedLine`'s settled case read `verdictCode(verdict) === 3` beside `noVerdictText`, which is `null` exactly then.

## What changed

- Slice 1. `timeoutText` branches on `result.reason === "unsynced"`, as it does on `lapsed`; `unsyncedText` picks only the words; the settled case reads `noVerdictText(verdict)`. `verdictCode` keeps its callers in `namedClassLines` and `run.ts`.
- The clause names what the current selected files passed at, before what they may not cover. Unlisted: the last revision the runner listed (`refinedRevision`), then `revision N is not listed yet (Q)`, Q the worktree's running and queued test files (`testFilesByPhase`). Unsynced: the results' revision, then the pass not stored, or the pass at a later revision, or the sync not answered. With no current file, the old words stay. Pass, fail and skip are counted apart (`coverText`, `filesCounted` in `named-file-lines.ts`).
- The verdict line ends with the next step (`waitAgainText`): for a lapsed heartbeat, an unstored pass, an unlisted revision or a pending file, `A later pass is not reported. A failure arrives with a later tool call. For the verdict, wait again: <command>`; a snapshot says `wait`. With no daemon: `For the verdict, wait again once a daemon runs: <command>`, and nothing about a later tool call, since nothing arrives without a daemon. A hold, a pause, a focused answer, a stale or unknown file nothing queues, an unmatched or not-run path: no new sentence, as their line names its own step.
- The command (`waitAgainCommand`) repeats the wait: its own deadline (`NamedWait.timeoutMs`, new, optional, not in `--json`), 60000 for a snapshot, the paths from the directory they were given in, shell-quoted, `<same paths>` past three (C15's three-path rule), and the `--check` texts.
- The clause moved from `status-wait-lines.ts` (504 lines, now 465) to `src/cli/no-verdict-lines.ts` (new).
- `commands.md` (claude-code, codex, pi): the line's new parts, and "After exit 3, run the same wait again before you report a result." The snapshot sentence quotes the pass words without the revision clause, which now differs with current files.
- `--json`: unchanged. Exit codes and `selectionResult`: unchanged.

## The row's example and the deviations

The row's example: `9 test files passed at revision 6, before your branch switch. Revision 7 is not listed yet (677 test files queued), so these results may not cover it. No verdict yet.` / `A later pass is not reported. A failure arrives with a later tool call. For the verdict, wait again: squeal status --wait 300000 <same paths>`.

#99's case now prints (test `test/cli/wait-again.test.ts`, first case):

```text
Named test files have no verdict: the deadline passed after 61.2 s: 9 test files passed at revision 6; revision 7 is not listed yet (677 test files queued), so these results may not cover it. Worktree: known failures 0; not current: 677 of 1026 test files (677 queued); revision 7 is not listed yet, so test files it adds are not counted. A later pass is not reported. A failure arrives with a later tool call. For the verdict, wait again: `squeal status --wait 60000 <same paths>`
```

The coordinator accepted three deviations (request 6bf6ec9c):

- (a) The head `Named test files have no verdict` stays and the step ends the same line. The evals parser, `commands.md` and 16 test files read the head, and `tail -1` keeps both the verdict and the command (row 011-27's rule). The example's `No verdict yet.` is the head.
- (b) `--wait 60000`, not 300000. The wait holds no durations of the queued files, so Squeal has no figure for a longer deadline; the command repeats the agent's own deadline (decision 827ac3ce, which also put `timeoutMs` on the wait's result, in W1's `status-wait-paths.ts` by agreement). A longer deadline from real figures would be a later row.
- (c) No `before your branch switch`. The wait knows only the current revision's commit, and Squeal cannot tell a branch switch from a commit or a reset (decision e9fe60c9). The revision numbers carry the fact.

## The evals parser

`test/evals/no-verdict-evidence.test.ts` reads each changed line from `printNamed`, plain and `--json`, as text and in a Claude Code hook's JSON: no selected file credited, verdict `unknown`, the work counted pending, or no daemon validating. In the plain form the revision is the wait's.

A pre-existing misread, fixed by this row (decision 2f6f3b77): a snapshot whose daemon did not answer its sync, with a clear worktree, read as pending 0 and verdict `pass` in `squealEvidence`, with the old words and the new. The line exits 3. `evals/lib/squeal-text.mjs` now counts `did not answer its sync` as pending, as it counts `has not stored its pass`.

Seen, not changed: in the `--json` form the lines name no `Revision:` line, so the parser takes the first `at revision N`. For #99's line that is the passes' revision 6, where before it found none (`null`). Every such step is still pending with no file credited, so no grade changes.

## Evidence

All at revision 34 (`54b9c04f`), host load about 16 on 24 CPUs, through `env -u PLUGIN_ROOT -u PLUGIN_DATA squeal` (the installed CLI, 0.1.333/0.1.334, so its own lines are the old words):

- `npm run lint`: no fixes applied, 2227 files. `npm run typecheck`: clean.
- `squeal status --wait 60000` on the 8 changed test files: `Named test files at revision 34: no known failures; 8 test files, each with a current result`, exit 0.
- `squeal status --wait` on the changed source paths and the three `commands.md`: the selection read 330, then 201, then 128 readers (row 011-233's known miss of a source path's selection). The last read: `Named test files at revision 34: 4 known failures: 4 tests; 128 test files, each with a current result`, exit 1. The four failures are the bundle-drift checks (`cli/squeal.mjs differs from the build`: `test/harness/plugin.test.ts`, `codex/plugin.test.ts`, `opencode/package.test.ts`, `pi/package.test.ts`), expected because the CLI source changed and this row does not run `npm run build`.
- Every test file that imports a changed module or reads `commands.md` by name (119 files): `no known failures; 119 test files, each with a current result`, exit 0.
- Run directly before the commits, with `--maxWorkers=4`: the 35 files that read the named lines (821 tests, one expectation updated after the run, then 27 of 27 in that file), and the evals regrade files that read stored results (`a8-load-hold`, `atomic-compare`, `atomic-pilot`, `atomic-regrade`, `atomic-trend`, `judge-coverage`, `regrade`, `regrade-cells`, `regrade-expectations`, `reference`: 179 tests passed). The parser change meets the phrase in six stored results files, in the skill text the agents read; those regrades did not change.

## Commits

- `4f75d6aea` feat(011-243): a named wait keeps its deadline for its next step (request 827ac3ce; W1's `status-wait-paths.ts` by agreement).
- `ab0db0e8c` feat(011-243): a named wait with no verdict names what its passes cover and the next step (gh-99; request 6bf6ec9c).
- `54b9c04f5` fix(011-243): the evals parser reads a snapshot's unanswered sync as pending (request 2f6f3b77).

## For the next worker

- Not done: a deadline longer than the agent's own. It needs figures the wait does not carry, such as the queued files' last durations; the coordinator calls it a later row if wanted.
- `namedLine` is still at cyclomatic complexity 26, over 20 before this row; this row adds a call and no branch.
- The class lines (`Current (9): 9 pass`) are unchanged; the verdict line now says what revision those passes cover.
